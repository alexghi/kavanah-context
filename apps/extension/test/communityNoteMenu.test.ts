import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCommunityNoteHighlight,
  findCommunityNoteMenuItem,
  HIGHLIGHT_CLASS,
  MENU_HINT_ID,
  MENU_HINT_TEXT,
  requestCommunityNote,
} from "@/lib/x/communityNoteMenu";
import { wait } from "./helpers/dom";

interface SetupOptions {
  withCaret?: boolean;
  withMenu?: boolean;
  itemLabel?: string | null;
}

function setup({ withCaret = true, withMenu = true, itemLabel = "Request Community Note" }: SetupOptions = {}) {
  document.body.innerHTML = `
    <article data-testid="tweet">
      ${withCaret ? '<button data-testid="caret" aria-label="More">…</button>' : ""}
      <div data-testid="tweetText">Post</div>
    </article>
    <div id="layers"></div>`;
  const article = document.querySelector("article")!;
  const caret = article.querySelector<HTMLButtonElement>('[data-testid="caret"]');
  const itemClick = vi.fn();
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
      menu.querySelector("#note-item")?.addEventListener("click", itemClick);
    }, 20);
  });
  return { article, caret, itemClick };
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

  it("findCommunityNoteMenuItem prefers the request item and matches loosely", () => {
    const menu = document.createElement("div");
    menu.innerHTML = '<div role="menuitem">Write a Community Note</div><div role="menuitem">  Request   Community Note </div>';
    expect(findCommunityNoteMenuItem(menu)?.item).toBe("write");
    menu.innerHTML = '<div role="menuitem">Mute</div>';
    expect(findCommunityNoteMenuItem(menu)).toBeNull();
  });
});
