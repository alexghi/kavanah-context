import "./style.css";
import { createRoot, type Root } from "react-dom/client";
import { browser } from "wxt/browser";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { defineContentScript } from "wxt/utils/define-content-script";
import type { ExtensionResponse, PostContext } from "@kavannah/shared";
import { PanelHost } from "@/components/PanelHost";
import { PANEL_Z_INDEX } from "@/components/KavannahPanel";
import { client } from "@/lib/api";
import { isExtensionMessage } from "@/lib/background/router";
import { createPanelStore } from "@/lib/panelStore";
import { detectHostTheme } from "@/lib/theme";
import { describeError } from "@/lib/utils";
import { requestCommunityNote, type CommunityNoteMenuStatus } from "@/lib/x/communityNoteMenu";
import { extractPost, findMainPostArticle, PostExtractionError } from "@/lib/x/extractPost";
import { ensureKButtonStyles, startInjection } from "@/lib/x/inject";

export default defineContentScript({
  matches: ["https://x.com/*", "https://twitter.com/*"],
  cssInjectionMode: "ui",
  runAt: "document_idle",
  async main(ctx) {
    const store = createPanelStore();
    ensureKButtonStyles(document);

    const openSettings = () => {
      void client.openOptions();
    };

    /** The article behind the open panel, else the page's main post (on /status/ pages). */
    const currentArticle = (): HTMLElement | null => {
      const { article } = store.getState();
      if (article && document.contains(article)) return article;
      return findMainPostArticle(document, location.href);
    };

    const requestForCurrent = (): Promise<CommunityNoteMenuStatus> => requestCommunityNote(currentArticle());

    // One panel instance for the whole page, rendered once inside a shadow root. WXT moves the
    // Tailwind `@property` rules into document.head itself (splitShadowRootCss), so rings, shadows
    // and transforms work inside the shadow tree.
    const ui = await createShadowRootUi<Root>(ctx, {
      name: "kavannah-panel",
      position: "overlay",
      anchor: "body",
      zIndex: PANEL_Z_INDEX,
      isolateEvents: true, // keyboard events stay inside the panel (X has single-key shortcuts)
      onMount(container) {
        const root = createRoot(container);
        root.render(
          <PanelHost
            store={store}
            client={client}
            onOpenSettings={openSettings}
            onRequestCommunityNote={requestForCurrent}
          />,
        );
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();

    const openForArticle = (article: HTMLElement) => {
      store.setTheme(detectHostTheme(document));
      try {
        store.open(extractPost(article, { locationHref: location.href }), article);
      } catch (err) {
        store.setNotice(
          err instanceof PostExtractionError ? err.message : `Couldn't read this post: ${describeError(err)}`,
        );
      }
    };

    const injector = startInjection(document.body, { onClick: openForArticle });
    ctx.onInvalidated(() => injector.stop());
    ctx.addEventListener(window, "wxt:locationchange", () => {
      injector.scan();
    });
    // Esc pressed on the page (outside the shadow root) also closes the drawer.
    ctx.addEventListener(
      document,
      "keydown",
      (event) => {
        if (event.key === "Escape" && store.getState().open) store.close();
      },
      { capture: true },
    );

    const getCurrentPost = (): ExtensionResponse<PostContext | null> => {
      const article = findMainPostArticle(document, location.href);
      if (!article) return { ok: true, data: null };
      try {
        return { ok: true, data: extractPost(article, { locationHref: location.href }) };
      } catch {
        return { ok: true, data: null };
      }
    };

    const onMessage = (
      message: unknown,
      _sender: unknown,
      sendResponse: (response?: unknown) => void,
    ): true | undefined => {
      if (!isExtensionMessage(message)) return undefined;
      if (message.type === "kavannah:getCurrentPost") {
        sendResponse(getCurrentPost());
        return undefined;
      }
      if (message.type === "kavannah:requestCommunityNote") {
        requestForCurrent().then(
          (status) => sendResponse({ ok: true, data: status } satisfies ExtensionResponse<CommunityNoteMenuStatus>),
          (err: unknown) => sendResponse({ ok: false, error: { code: "MENU_FLOW", message: describeError(err) } }),
        );
        return true;
      }
      return undefined;
    };
    browser.runtime.onMessage.addListener(onMessage);
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(onMessage));
  },
});
