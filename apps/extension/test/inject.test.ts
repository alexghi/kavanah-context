import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureKButtonStyles,
  findActionBar,
  K_BUTTON_CLASS,
  K_BUTTON_LABEL,
  K_WRAPPER_CLASS,
  KAVANNAH_STYLE_ID,
  PROCESSED_ATTR,
  scanArticles,
  startInjection,
} from "@/lib/x/inject";
import { articles, loadFixture, wait } from "./helpers/dom";

const K = `.${K_BUTTON_CLASS}`;

describe("K button injection", () => {
  beforeEach(() => {
    loadFixture();
    document.head.innerHTML = "";
  });

  it("adds exactly one K button per post as the last item of the action bar", () => {
    const onClick = vi.fn();
    expect(scanArticles(document.body, onClick)).toBe(3);
    for (const article of articles()) {
      const buttons = article.querySelectorAll<HTMLButtonElement>(K);
      expect(buttons).toHaveLength(1);
      const button = buttons[0]!;
      expect(button.type).toBe("button");
      expect(button.title).toBe(K_BUTTON_LABEL);
      expect(button.getAttribute("aria-label")).toBe(K_BUTTON_LABEL);
      expect(button.textContent).toBe("K");
      const bar = findActionBar(article);
      expect(bar).not.toBeNull();
      expect(bar!.lastElementChild?.classList.contains(K_WRAPPER_CLASS)).toBe(true);
      expect(article.getAttribute(PROCESSED_ATTR)).toBe("1");
    }
  });

  it("is idempotent across repeated scans", () => {
    const onClick = vi.fn();
    scanArticles(document.body, onClick);
    expect(scanArticles(document.body, onClick)).toBe(0);
    expect(scanArticles(document.body, onClick)).toBe(0);
    expect(document.querySelectorAll(K)).toHaveLength(3);
  });

  it("re-adds the button when X re-renders an action bar", () => {
    const onClick = vi.fn();
    scanArticles(document.body, onClick);
    const article = articles()[0]!;
    article.querySelector(`.${K_WRAPPER_CLASS}`)!.remove();
    expect(article.querySelector(K)).toBeNull();
    expect(scanArticles(document.body, onClick)).toBe(1);
    expect(article.querySelectorAll(K)).toHaveLength(1);
    expect(document.querySelectorAll(K)).toHaveLength(3);
  });

  it("calls onClick with the article and stops the click from reaching X", () => {
    const onClick = vi.fn();
    scanArticles(document.body, onClick);
    const article = articles()[1]!;
    const articleClick = vi.fn();
    article.addEventListener("click", articleClick);
    const documentClick = vi.fn();
    document.addEventListener("click", documentClick);
    const button = article.querySelector<HTMLButtonElement>(K)!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(article, button);
    expect(articleClick).not.toHaveBeenCalled();
    expect(documentClick).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    document.removeEventListener("click", documentClick);
  });

  it("skips articles without an action bar and leaves them unmarked for a later retry", () => {
    const article = document.createElement("article");
    article.setAttribute("data-testid", "tweet");
    article.innerHTML = '<div data-testid="tweetText">Rendering…</div>';
    document.body.appendChild(article);
    expect(scanArticles(document.body, vi.fn())).toBe(3);
    expect(article.querySelector(K)).toBeNull();
    expect(article.hasAttribute(PROCESSED_ATTR)).toBe(false);
  });

  it("does not use a quoted post's group as the action bar", () => {
    const article = articles()[1]!;
    const quote = article.querySelector('div[role="link"]')!;
    const fakeGroup = document.createElement("div");
    fakeGroup.setAttribute("role", "group");
    fakeGroup.innerHTML = '<button data-testid="reply"></button><button data-testid="like"></button>';
    quote.prepend(fakeGroup);
    const bar = findActionBar(article)!;
    expect(bar).not.toBe(fakeGroup);
    expect(bar.getAttribute("aria-label")).toContain("12 replies");
  });

  it("injects the light-DOM style tag once", () => {
    const first = ensureKButtonStyles(document);
    const second = ensureKButtonStyles(document);
    expect(second).toBe(first);
    expect(document.querySelectorAll(`#${KAVANNAH_STYLE_ID}`)).toHaveLength(1);
    expect(first.textContent).toContain(`.${K_BUTTON_CLASS}`);
    expect(first.textContent).toContain("rgb(113, 118, 123)");
    expect(first.textContent).toContain("#4f46e5");
  });

  it("observes posts added later (SPA navigation / infinite scroll) and stops on demand", async () => {
    const onClick = vi.fn();
    const controller = startInjection(document.body, { onClick, debounceMs: 10 });
    expect(document.querySelectorAll(K)).toHaveLength(3);

    const later = articles()[0]!.cloneNode(true) as HTMLElement;
    later.removeAttribute(PROCESSED_ATTR);
    later.querySelector(`.${K_WRAPPER_CLASS}`)?.remove();
    document.body.appendChild(later);
    await wait(60);
    expect(later.querySelectorAll(K)).toHaveLength(1);
    expect(document.querySelectorAll(K)).toHaveLength(4);

    // X re-renders an action bar: the button comes back.
    later.querySelector(`.${K_WRAPPER_CLASS}`)!.remove();
    await wait(60);
    expect(later.querySelectorAll(K)).toHaveLength(1);

    controller.stop();
    const afterStop = articles()[2]!.cloneNode(true) as HTMLElement;
    afterStop.removeAttribute(PROCESSED_ATTR);
    afterStop.querySelector(`.${K_WRAPPER_CLASS}`)?.remove();
    document.body.appendChild(afterStop);
    await wait(60);
    expect(afterStop.querySelector(K)).toBeNull();
  });
});
