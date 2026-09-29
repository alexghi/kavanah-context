/**
 * K-button injection into x.com post action bars. Pure DOM (no extension imports), idempotent,
 * and resilient to X's SPA re-renders: a MutationObserver re-scans (debounced) and re-adds the
 * button when X rebuilds an action bar.
 */

export const KAVANNAH_STYLE_ID = "kavannah-k-style";
export const K_BUTTON_CLASS = "kavannah-k-btn";
export const K_WRAPPER_CLASS = "kavannah-k-wrap";
export const K_GLYPH_CLASS = "kavannah-k-glyph";
export const PROCESSED_ATTR = "data-kavannah";
export const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
export const K_BUTTON_LABEL = "Analyze with Kavannah";
export const ACCENT = "#4f46e5";

export type KButtonClickHandler = (article: HTMLElement, button: HTMLButtonElement) => void;

/** Light-DOM styles for the K button (unique class names, no Tailwind). */
export const K_BUTTON_CSS = `
.${K_WRAPPER_CLASS} {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin-left: 4px;
}
.${K_BUTTON_CLASS} {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 9999px;
  cursor: pointer;
  color: rgb(113, 118, 123);
  -webkit-user-select: none;
  user-select: none;
  transition: color 0.15s ease, background-color 0.15s ease;
}
.${K_BUTTON_CLASS}:hover,
.${K_BUTTON_CLASS}:focus-visible {
  color: ${ACCENT};
  background-color: rgba(79, 70, 229, 0.12);
}
.${K_BUTTON_CLASS}:focus-visible {
  outline: 2px solid ${ACCENT};
  outline-offset: 1px;
}
.${K_GLYPH_CLASS} {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 20px;
  line-height: 1;
  font-weight: 700;
  letter-spacing: -0.5px;
  transform: translateY(-0.5px);
}
`;

/** Adds the <style id="kavannah-k-style"> to document.head once. */
export function ensureKButtonStyles(doc: Document): HTMLStyleElement {
  const existing = doc.getElementById(KAVANNAH_STYLE_ID);
  if (existing && existing.tagName === "STYLE") return existing as HTMLStyleElement;
  const style = doc.createElement("style");
  style.id = KAVANNAH_STYLE_ID;
  style.textContent = K_BUTTON_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
  return style;
}

function insideQuotedPost(el: Element, article: Element): boolean {
  let node = el.parentElement;
  while (node && node !== article) {
    if (node.tagName === "DIV" && node.getAttribute("role") === "link") return true;
    node = node.parentElement;
  }
  return false;
}

/** The action bar: the div[role=group] holding reply / retweet / like (outside any quoted post). */
export function findActionBar(article: Element): HTMLElement | null {
  for (const group of Array.from(article.querySelectorAll<HTMLElement>('div[role="group"]'))) {
    if (insideQuotedPost(group, article)) continue;
    const hasReply = group.querySelector('[data-testid="reply"]');
    const hasOther = group.querySelector('[data-testid="retweet"], [data-testid="like"]');
    if (hasReply && hasOther) return group;
  }
  return null;
}

export function createKButton(doc: Document): { wrapper: HTMLDivElement; button: HTMLButtonElement } {
  const wrapper = doc.createElement("div");
  wrapper.className = K_WRAPPER_CLASS;
  const button = doc.createElement("button");
  button.type = "button";
  button.className = K_BUTTON_CLASS;
  button.title = K_BUTTON_LABEL;
  button.setAttribute("aria-label", K_BUTTON_LABEL);
  const glyph = doc.createElement("span");
  glyph.className = K_GLYPH_CLASS;
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = "K";
  button.appendChild(glyph);
  wrapper.appendChild(button);
  return { wrapper, button };
}

const SWALLOWED_EVENTS = ["mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend", "keydown", "keyup"] as const;

/** Appends a K button to the article's action bar. Returns the existing one when already present. */
export function injectKButton(article: HTMLElement, onClick: KButtonClickHandler): HTMLButtonElement | null {
  const existing = article.querySelector<HTMLButtonElement>(`.${K_BUTTON_CLASS}`);
  if (existing) {
    article.setAttribute(PROCESSED_ATTR, "1");
    return existing;
  }
  const bar = findActionBar(article);
  if (!bar) return null; // X may render the bar later; the observer will retry.

  const { wrapper, button } = createKButton(article.ownerDocument);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick(article, button);
  });
  // X navigates to the post on clicks/keys that bubble up from the article: keep ours to ourselves.
  for (const type of SWALLOWED_EVENTS) button.addEventListener(type, (event) => event.stopPropagation());

  bar.appendChild(wrapper);
  article.setAttribute(PROCESSED_ATTR, "1");
  return button;
}

/** Injects into every un-processed article under `root`. Returns the number of buttons added. */
export function scanArticles(root: ParentNode, onClick: KButtonClickHandler): number {
  let injected = 0;
  for (const article of Array.from(root.querySelectorAll<HTMLElement>(ARTICLE_SELECTOR))) {
    if (article.getAttribute(PROCESSED_ATTR) === "1" && article.querySelector(`.${K_BUTTON_CLASS}`)) continue;
    const hadButton = article.querySelector(`.${K_BUTTON_CLASS}`) !== null;
    if (injectKButton(article, onClick) && !hadButton) injected += 1;
  }
  return injected;
}

export interface InjectionController {
  /** Scan now (cancels any pending debounced scan). */
  scan(): number;
  stop(): void;
}

export interface InjectionOptions {
  onClick: KButtonClickHandler;
  /** @default 100 */
  debounceMs?: number;
}

/** Observes `root` for new/re-rendered posts and keeps every action bar equipped with a K button. */
export function startInjection(root: HTMLElement, options: InjectionOptions): InjectionController {
  const debounceMs = options.debounceMs ?? 100;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const runScan = (): number => {
    timer = undefined;
    if (stopped) return 0;
    return scanArticles(root, options.onClick);
  };
  const schedule = (): void => {
    if (stopped || timer !== undefined) return;
    timer = setTimeout(runScan, debounceMs);
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "childList" && (record.addedNodes.length > 0 || record.removedNodes.length > 0)) {
        schedule();
        return;
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  runScan();

  return {
    scan() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      return runScan();
    },
    stop() {
      stopped = true;
      observer.disconnect();
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}
