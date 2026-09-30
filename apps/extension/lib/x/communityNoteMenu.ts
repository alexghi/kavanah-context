import { X_MENU_ITEMS, X_NOTE_REQUEST_FORM } from "@kavannah/shared";
import { isInsideQuote } from "./extractPost";

/**
 * "Request a Community Note": open the post's ••• menu and find X's own menu item.
 * - With a drafted note: click "Request Community Note", wait for X's request form and put the
 *   draft in its "Explain?" field. The request is only sent when the user turned on
 *   "Send the request automatically" in the settings; otherwise they press X's button themselves.
 * - Without one (or for a contributor's "Write a Community Note"): highlight the item, click nothing.
 */

export type CommunityNoteMenuItem = "request" | "write";

export type CommunityNoteMenuStatus =
  | { status: "highlighted"; item: CommunityNoteMenuItem; label: string }
  /** X's request form is open with the explanation filled in; `submitted` says whether X's button was pressed too. */
  | { status: "filled"; submitted: boolean; truncated: boolean }
  | { status: "not_offered"; reason: "no_article" | "no_caret" | "no_menu" | "no_item" | "no_form" };

export interface CommunityNoteFill {
  /** Text for the form's "Explain?" field (the drafted Community Note). */
  explanation: string;
  /** Also press X's "Agree & Request a note" button. @default false */
  submit?: boolean;
}

export const MENU_HINT_ID = "kavannah-menu-hint";
export const MENU_HINT_TEXT = "Kavannah: choose this to continue";
export const HIGHLIGHT_CLASS = "kavannah-menu-highlight";
const ACCENT = "#4f46e5";

export interface RequestCommunityNoteOptions {
  /** How long to wait for X's menu. @default 1500 */
  timeoutMs?: number;
  /** Remove the highlight after this delay even if the menu stays open. @default 15000 */
  highlightMs?: number;
  /** Open X's request form and fill it instead of only highlighting the menu item. */
  fill?: CommunityNoteFill;
  /** How long to wait for X's request form after clicking the menu item. @default 6000 */
  formTimeoutMs?: number;
}

/** The first Community Note item in the menu; with `prefer`, that kind wins wherever it sits. */
export function findCommunityNoteMenuItem(
  menu: ParentNode,
  prefer?: CommunityNoteMenuItem,
): { element: HTMLElement; item: CommunityNoteMenuItem; label: string } | null {
  const wanted: Array<[CommunityNoteMenuItem, string]> = [
    ["request", X_MENU_ITEMS.request.toLowerCase()],
    ["write", X_MENU_ITEMS.write.toLowerCase()],
  ];
  let first: { element: HTMLElement; item: CommunityNoteMenuItem; label: string } | null = null;
  for (const element of Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))) {
    const label = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    const lower = label.toLowerCase();
    for (const [item, needle] of wanted) {
      if (!lower.includes(needle)) continue;
      if (!prefer || item === prefer) return { element, item, label };
      first ??= { element, item, label };
    }
  }
  return first;
}

/** Set a field's value the way typing would, so X's React form state picks it up. */
export function setFieldValue(field: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const view = field.ownerDocument.defaultView ?? window;
  const proto = field.tagName === "TEXTAREA" ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(field, value);
  else field.value = value;
  field.dispatchEvent(new view.Event("input", { bubbles: true }));
  field.dispatchEvent(new view.Event("change", { bubbles: true }));
}

function findExplanationField(doc: Document): HTMLTextAreaElement | null {
  return doc.querySelector<HTMLTextAreaElement>(`textarea[name="${X_NOTE_REQUEST_FORM.explanationField}"]`);
}

/** X's "Agree & Request a note" button in the same dialog as the explanation field. */
export function findRequestSubmitButton(field: HTMLElement): HTMLElement | null {
  const scope = field.closest('[role="dialog"]') ?? field.ownerDocument;
  const needle = X_NOTE_REQUEST_FORM.submitLabel.toLowerCase();
  return (
    Array.from(scope.querySelectorAll<HTMLElement>('button, [role="button"]')).find((button) =>
      (button.textContent ?? "").replace(/\s+/g, " ").toLowerCase().includes(needle),
    ) ?? null
  );
}

/** Wait for X's request form, fill its "Explain?" field and, if asked, press X's submit button. */
async function fillRequestForm(doc: Document, fill: CommunityNoteFill, timeoutMs: number): Promise<CommunityNoteMenuStatus> {
  const field = await waitFor(doc, () => findExplanationField(doc), timeoutMs);
  if (!field) return { status: "not_offered", reason: "no_form" };

  const max = field.maxLength > 0 ? field.maxLength : Infinity;
  const text = fill.explanation.trim();
  const truncated = text.length > max;
  setFieldValue(field, truncated ? text.slice(0, max) : text);
  field.focus({ preventScroll: true });
  if (!fill.submit) return { status: "filled", submitted: false, truncated };

  const button = findRequestSubmitButton(field);
  if (!button || (button as HTMLButtonElement).disabled || button.getAttribute("aria-disabled") === "true") {
    return { status: "filled", submitted: false, truncated };
  }
  button.click();
  // X closes the form once the request is accepted; if it stays, the user finishes by hand.
  const closed = await waitFor(doc, () => (doc.contains(field) ? null : true), timeoutMs);
  return { status: "filled", submitted: closed === true, truncated };
}

function waitFor<T>(doc: Document, probe: () => T | null, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const immediate = probe();
    if (immediate) {
      resolve(immediate);
      return;
    }
    let done = false;
    let observer: MutationObserver | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const finish = (value: T | null) => {
      if (done) return;
      done = true;
      observer?.disconnect();
      if (timer !== undefined) clearTimeout(timer);
      if (poll !== undefined) clearInterval(poll);
      resolve(value);
    };
    const check = () => {
      const value = probe();
      if (value) finish(value);
    };
    observer = new MutationObserver(check);
    observer.observe(doc.documentElement ?? doc, { childList: true, subtree: true });
    poll = setInterval(check, 100);
    timer = setTimeout(() => finish(probe()), timeoutMs);
  });
}

function scrollTo(el: Element, block: ScrollLogicalPosition): void {
  try {
    if (typeof (el as HTMLElement).scrollIntoView === "function") el.scrollIntoView({ block, behavior: "smooth" });
  } catch {
    /* jsdom or unusual layouts */
  }
}

let activeCleanup: (() => void) | undefined;

/** Removes any highlight/hint left by a previous call. */
export function clearCommunityNoteHighlight(): void {
  activeCleanup?.();
  activeCleanup = undefined;
}

function highlight(item: HTMLElement, doc: Document, highlightMs: number): void {
  clearCommunityNoteHighlight();
  const previous = {
    outline: item.style.outline,
    outlineOffset: item.style.outlineOffset,
    borderRadius: item.style.borderRadius,
    boxShadow: item.style.boxShadow,
  };
  item.classList.add(HIGHLIGHT_CLASS);
  item.style.outline = `2px solid ${ACCENT}`;
  item.style.outlineOffset = "-2px";
  item.style.borderRadius = "8px";
  item.style.boxShadow = "0 0 0 4px rgba(79, 70, 229, 0.18)";

  const hint = doc.createElement("div");
  hint.id = MENU_HINT_ID;
  hint.setAttribute("role", "status");
  hint.textContent = MENU_HINT_TEXT;
  Object.assign(hint.style, {
    position: "fixed",
    zIndex: "2147483001",
    background: ACCENT,
    color: "#ffffff",
    font: "600 12px/1.2 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    padding: "5px 9px",
    borderRadius: "6px",
    boxShadow: "0 4px 14px rgba(0, 0, 0, 0.18)",
    pointerEvents: "none",
    whiteSpace: "nowrap",
  } satisfies Partial<CSSStyleDeclaration>);
  const place = () => {
    const rect = item.getBoundingClientRect();
    const viewportHeight = doc.defaultView?.innerHeight ?? 0;
    const above = rect.top > 40;
    hint.style.left = `${Math.max(8, rect.left + 8)}px`;
    hint.style.top = above ? `${rect.top - 30}px` : `${Math.min(rect.bottom + 6, Math.max(0, viewportHeight - 40))}px`;
  };
  place();
  doc.body.appendChild(hint);

  const observer = new MutationObserver(() => {
    if (!doc.contains(item)) cleanup();
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") cleanup();
  };
  doc.addEventListener("keydown", onKey, true);
  const timer = setTimeout(() => cleanup(), highlightMs);

  const cleanup = () => {
    observer.disconnect();
    clearTimeout(timer);
    doc.removeEventListener("keydown", onKey, true);
    hint.remove();
    item.classList.remove(HIGHLIGHT_CLASS);
    item.style.outline = previous.outline;
    item.style.outlineOffset = previous.outlineOffset;
    item.style.borderRadius = previous.borderRadius;
    item.style.boxShadow = previous.boxShadow;
    if (activeCleanup === cleanup) activeCleanup = undefined;
  };
  activeCleanup = cleanup;
}

/**
 * Scroll the article into view, click its ••• caret and wait (<= timeoutMs) for X's menu. With
 * `options.fill` and a "Request Community Note" item: click it and fill X's request form.
 * Otherwise highlight the "Request Community Note" / "Write a Community Note" item without clicking it.
 */
export async function requestCommunityNote(
  article: Element | null | undefined,
  options: RequestCommunityNoteOptions = {},
): Promise<CommunityNoteMenuStatus> {
  if (!article) return { status: "not_offered", reason: "no_article" };
  const doc = article.ownerDocument;
  const timeoutMs = options.timeoutMs ?? 1500;
  clearCommunityNoteHighlight();
  scrollTo(article, "center");

  const caret =
    Array.from(article.querySelectorAll<HTMLElement>('[data-testid="caret"]')).find((el) => !isInsideQuote(el, article)) ??
    null;
  if (!caret) return { status: "not_offered", reason: "no_caret" };
  caret.click();

  const started = Date.now();
  const menu = await waitFor(
    doc,
    () => {
      const candidate = doc.querySelector<HTMLElement>('[role="menu"]');
      return candidate && candidate.querySelector('[role="menuitem"]') ? candidate : null;
    },
    timeoutMs,
  );
  if (!menu) return { status: "not_offered", reason: "no_menu" };

  // Items can render a beat after the container; use whatever budget is left (at least 250 ms).
  const remaining = Math.max(250, timeoutMs - (Date.now() - started));
  const fill = options.fill?.explanation.trim() ? options.fill : undefined;
  const found = await waitFor(doc, () => findCommunityNoteMenuItem(menu, fill ? "request" : undefined), remaining);
  if (!found) return { status: "not_offered", reason: "no_item" };

  if (fill && found.item === "request") {
    found.element.click();
    return fillRequestForm(doc, fill, options.formTimeoutMs ?? 6000);
  }

  highlight(found.element, doc, options.highlightMs ?? 15_000);
  scrollTo(found.element, "nearest");
  return { status: "highlighted", item: found.item, label: found.label };
}
