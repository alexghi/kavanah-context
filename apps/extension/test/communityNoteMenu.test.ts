import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCommunityNoteHighlight,
  findCommunityNoteMenuItem,
  findRequestSubmitButton,
  FORM_HINT_ID,
  FORM_HINT_TEXT,
  HIGHLIGHT_CLASS,
  MENU_HINT_ID,
  MENU_HINT_TEXT,
  NoteDraftUnavailableError,
  requestCommunityNote,
} from "@/lib/x/communityNoteMenu";
import { wait } from "./helpers/dom";

interface SetupOptions {
  withCaret?: boolean;
  withMenu?: boolean;
  itemLabel?: string | null;
  /** Clicking the Community Note item opens an imitation of X's request form. */
  withForm?: boolean;
  /** The form stays open after "Agree & Request a note" (X rejected the request). */
  formStays?: boolean;
  maxLength?: number;
}

function setup({
  withCaret = true,
  withMenu = true,
  itemLabel = "Request Community Note",
  withForm = false,
  formStays = false,
  maxLength = 2000,
}: SetupOptions = {}) {
  document.body.innerHTML = `
    <article data-testid="tweet">
      ${withCaret ? '<button data-testid="caret" aria-label="More">…</button>' : ""}
      <div data-testid="tweetText">Post</div>
    </article>
    <div id="layers"></div>`;
  const article = document.querySelector("article")!;
  const caret = article.querySelector<HTMLButtonElement>('[data-testid="caret"]');
  const itemClick = vi.fn();
  const submit = vi.fn();
  const inputs: string[] = [];
  const openForm = () => {
    const layer = document.getElementById("layers")!;
    layer.querySelector('[role="menu"]')?.remove();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.innerHTML = `
      <label><span>Link to an X post</span><input type="text" name="NoteRequestFormTextInput"></label>
      <label><span>Explanation</span><textarea name="NoteRequestExplanationFormTextInput" maxlength="${maxLength}"></textarea></label>
      <button type="button"><span>Agree &amp; Request a note</span></button>`;
    const textarea = dialog.querySelector("textarea")!;
    textarea.addEventListener("input", () => inputs.push(textarea.value));
    dialog.querySelector("button")!.addEventListener("click", () => {
      submit(textarea.value);
      if (!formStays) setTimeout(() => dialog.remove(), 10);
    });
    layer.appendChild(dialog);
  };
  caret?.addEventListener("click", () => {
    if (!withMenu) return;
    setTimeout(() => {
      const layer = document.getElementById("layers")!;
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `
        <div role="menuitem"><span>Not interested in this post</span></div>
        ${itemLabel ? `<div role="menuitem" id="note-item"><span>${itemLabel}</span></div>` : ""}
        <div role="menuitem"><span>Report post</span></div>`;
      layer.appendChild(menu);
      menu.querySelector("#note-item")?.addEventListener("click", () => {
        itemClick();
        if (withForm) setTimeout(openForm, 20);
      });
    }, 20);
  });
  return { article, caret, itemClick, submit, inputs };
}

describe("requestCommunityNote", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    clearCommunityNoteHighlight();
  });

  it("opens the ••• menu and highlights the Request item without clicking it", async () => {
    const { article, itemClick } = setup();
    const status = await requestCommunityNote(article, { timeoutMs: 500 });
    expect(status).toEqual({ status: "highlighted", item: "request", label: "Request Community Note" });

    const item = document.getElementById("note-item")!;
    expect(item.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(item.style.outline).toContain("2px");
    expect(item.style.outline).toContain("#4f46e5");
    const hint = document.getElementById(MENU_HINT_ID)!;
    expect(hint.textContent).toBe(MENU_HINT_TEXT);
    expect(hint.style.position).toBe("fixed");
    expect(itemClick).not.toHaveBeenCalled();

    // The highlight goes away when X closes the menu.
    document.querySelector('[role="menu"]')!.remove();
    await wait(10);
    expect(document.getElementById(MENU_HINT_ID)).toBeNull();
    expect(item.classList.contains(HIGHLIGHT_CLASS)).toBe(false);
  });

  it("finds the contributor's 'Write a Community Note' item too (case-insensitive)", async () => {
    const { article } = setup({ itemLabel: "write a community note" });
    const status = await requestCommunityNote(article, { timeoutMs: 500 });
    expect(status).toEqual({ status: "highlighted", item: "write", label: "write a community note" });
  });

  it("reports when X offers no Community Note option", async () => {
    const { article, itemClick } = setup({ itemLabel: null });
    const status = await requestCommunityNote(article, { timeoutMs: 300 });
    expect(status).toEqual({ status: "not_offered", reason: "no_item" });
    expect(itemClick).not.toHaveBeenCalled();
    expect(document.getElementById(MENU_HINT_ID)).toBeNull();
  });

  it("reports when the menu never opens or the caret is missing", async () => {
    const noMenu = setup({ withMenu: false });
    expect(await requestCommunityNote(noMenu.article, { timeoutMs: 100 })).toEqual({ status: "not_offered", reason: "no_menu" });
    const noCaret = setup({ withCaret: false });
    expect(await requestCommunityNote(noCaret.article, { timeoutMs: 100 })).toEqual({ status: "not_offered", reason: "no_caret" });
    expect(await requestCommunityNote(null)).toEqual({ status: "not_offered", reason: "no_article" });
  });

  it("with a draft: clicks the Request item, fills X's form and leaves sending to the user", async () => {
    const { article, itemClick, submit, inputs } = setup({ withForm: true });
    const status = await requestCommunityNote(article, {
      timeoutMs: 500,
      formTimeoutMs: 500,
      fill: { explanation: "  The Fed is not family-owned. https://example.org  ", sourceUrl: "https://x.com/u/status/1" },
    });
    expect(status).toEqual({ status: "filled", submitted: false, truncated: false });
    expect(itemClick).toHaveBeenCalledTimes(1);
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[name="NoteRequestExplanationFormTextInput"]')!;
    expect(textarea.value).toBe("The Fed is not family-owned. https://example.org");
    expect(inputs).toEqual(["The Fed is not family-owned. https://example.org"]); // an input event fired, as typing would
    expect(document.querySelector<HTMLInputElement>('input[name="NoteRequestFormTextInput"]')!.value).toBe("https://x.com/u/status/1");
    expect(document.getElementById(FORM_HINT_ID)).toBeNull(); // the draft was ready: no "writing…" marker
    expect(submit).not.toHaveBeenCalled();
    expect(document.getElementById(MENU_HINT_ID)).toBeNull();
  });

  it("with a draft and auto-send: presses X's button and reports whether the form closed", async () => {
    const sent = setup({ withForm: true });
    expect(await requestCommunityNote(sent.article, { timeoutMs: 500, formTimeoutMs: 500, fill: { explanation: "Context.", submit: true } })).toEqual({
      status: "filled",
      submitted: true,
      truncated: false,
    });
    expect(sent.submit).toHaveBeenCalledExactlyOnceWith("Context.");

    const stuck = setup({ withForm: true, formStays: true });
    expect(await requestCommunityNote(stuck.article, { timeoutMs: 500, formTimeoutMs: 200, fill: { explanation: "Context.", submit: true } })).toEqual({
      status: "filled",
      submitted: false,
      truncated: false,
    });
  });

  it("draft still being written: opens X's form at once with a 'writing…' marker, then fills it", async () => {
    const { article, submit } = setup({ withForm: true });
    let deliver!: (text: string | null) => void;
    const explanation = new Promise<string | null>((resolve) => (deliver = resolve));
    const pending = requestCommunityNote(article, { timeoutMs: 500, formTimeoutMs: 500, fill: { explanation, sourceUrl: "https://x.com/u/status/1" } });

    await wait(120);
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(textarea.value).toBe("");
    expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("https://x.com/u/status/1"); // the link doesn't wait for the draft
    const hint = document.getElementById(FORM_HINT_ID)!;
    expect(hint.textContent).toBe(FORM_HINT_TEXT);
    expect(hint.getAttribute("role")).toBe("status");

    deliver("Written meanwhile.");
    expect(await pending).toEqual({ status: "filled", submitted: false, truncated: false });
    expect(textarea.value).toBe("Written meanwhile.");
    expect(document.getElementById(FORM_HINT_ID)).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it("draft fails or the user closes X's form while it is being written: nothing is filled or sent", async () => {
    const failed = setup({ withForm: true });
    await expect(
      requestCommunityNote(failed.article, { timeoutMs: 500, formTimeoutMs: 500, fill: { explanation: Promise.resolve(null), submit: true } }),
    ).rejects.toBeInstanceOf(NoteDraftUnavailableError);
    expect(document.getElementById(FORM_HINT_ID)).toBeNull();
    expect(failed.submit).not.toHaveBeenCalled();

    const closed = setup({ withForm: true });
    let deliver!: (text: string | null) => void;
    const pending = requestCommunityNote(closed.article, {
      timeoutMs: 500,
      formTimeoutMs: 500,
      fill: { explanation: new Promise<string | null>((resolve) => (deliver = resolve)), submit: true },
    });
    await wait(120);
    document.querySelector('[role="dialog"]')!.remove();
    deliver("Too late.");
    expect(await pending).toEqual({ status: "not_offered", reason: "no_form" });
    expect(closed.submit).not.toHaveBeenCalled();
  });

  it("cuts the draft to X's limit and says so", async () => {
    const { article } = setup({ withForm: true, maxLength: 10 });
    const status = await requestCommunityNote(article, { timeoutMs: 500, formTimeoutMs: 500, fill: { explanation: "0123456789abcdef" } });
    expect(status).toEqual({ status: "filled", submitted: false, truncated: true });
    expect(document.querySelector("textarea")!.value).toBe("0123456789");
  });

  it("reports when X's form never opens, and only highlights without a draft or for 'Write a Community Note'", async () => {
    const noForm = setup();
    expect(await requestCommunityNote(noForm.article, { timeoutMs: 500, formTimeoutMs: 150, fill: { explanation: "Context." } })).toEqual({
      status: "not_offered",
      reason: "no_form",
    });

    const blank = setup({ withForm: true });
    expect((await requestCommunityNote(blank.article, { timeoutMs: 500, fill: { explanation: "   " } })).status).toBe("highlighted");
    expect(blank.itemClick).not.toHaveBeenCalled();

    const writer = setup({ withForm: true, itemLabel: "Write a Community Note" });
    expect((await requestCommunityNote(writer.article, { timeoutMs: 500, fill: { explanation: "Context.", submit: true } })).status).toBe("highlighted");
    expect(writer.itemClick).not.toHaveBeenCalled();
    expect(writer.submit).not.toHaveBeenCalled();
  });

  it("finds X's submit button inside the form's dialog only", () => {
    document.body.innerHTML = `<button>Request a note elsewhere</button><div role="dialog"><textarea id="t"></textarea><button id="ok">Agree &amp; Request a note</button></div>`;
    expect(findRequestSubmitButton(document.getElementById("t")!)?.id).toBe("ok");
  });

  it("findCommunityNoteMenuItem prefers the request item and matches loosely", () => {
    const menu = document.createElement("div");
    menu.innerHTML = '<div role="menuitem">Write a Community Note</div><div role="menuitem">  Request   Community Note </div>';
    expect(findCommunityNoteMenuItem(menu)?.item).toBe("write");
    expect(findCommunityNoteMenuItem(menu, "request")?.item).toBe("request");
    menu.innerHTML = '<div role="menuitem">Mute</div>';
    expect(findCommunityNoteMenuItem(menu)).toBeNull();
  });
});
