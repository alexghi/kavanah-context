import { X_MENU_ITEMS } from "@kavannah/shared";
import { isInsideQuote } from "./extractPost";

/**
 * "Request a Community Note": open the post's ••• menu and point at X's own menu item.
 * Kavannah never clicks the item and never submits anything.
 */

export type CommunityNoteMenuItem = "request" | "write";

export type CommunityNoteMenuStatus =
  | { status: "highlighted"; item: CommunityNoteMenuItem; label: string }
  | { status: "not_offered"; reason: "no_article" | "no_caret" | "no_menu" | "no_item" };

export const MENU_HINT_ID = "kavannah-menu-hint";
export const MENU_HINT_TEXT = "Kavannah: choose this to continue";
export const HIGHLIGHT_CLASS = "kavannah-menu-highlight";
const ACCENT = "#4f46e5";

export interface RequestCommunityNoteOptions {
  /** How long to wait for X's menu. @default 1500 */
  timeoutMs?: number;
  /** Remove the highlight after this delay even if the menu stays open. @default 15000 */
  highlightMs?: number;
}

export function findCommunityNoteMenuItem(
  menu: ParentNode,
): { element: HTMLElement; item: CommunityNoteMenuItem; label: string } | null {
  const wanted: Array<[CommunityNoteMenuItem, string]> = [
    ["request", X_MENU_ITEMS.request.toLowerCase()],
    ["write", X_MENU_ITEMS.write.toLowerCase()],
  ];
  for (const element of Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))) {
    const label = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    const lower = label.toLowerCase();
    for (const [item, needle] of wanted) {
      if (lower.includes(needle)) return { element, item, label };
    }
  }
  return null;
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
 * Scroll the article into view, click its ••• caret, wait (<= timeoutMs) for X's menu, and
 * highlight the "Request Community Note" / "Write a Community Note" item. The item is never clicked.
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
  const found = await waitFor(doc, () => findCommunityNoteMenuItem(menu), remaining);
  if (!found) return { status: "not_offered", reason: "no_item" };

  highlight(found.element, doc, options.highlightMs ?? 15_000);
  scrollTo(found.element, "nearest");
  return { status: "highlighted", item: found.item, label: found.label };
}
