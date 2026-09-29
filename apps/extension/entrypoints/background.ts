import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { createRouter, isBackgroundMessage } from "@/lib/background/router";
import { getSettings, setSettings } from "@/lib/settings";

/**
 * Service worker: the only place that talks to the Kavannah backend. Content scripts and the
 * popup send ExtensionMessages; the router fetches, validates with the shared Zod schemas and
 * answers with ExtensionResponse<T>. No API key, no prompts live here.
 */
export default defineBackground(() => {
  const router = createRouter({
    fetch: (input, init) => fetch(input, init),
    getSettings,
    setSettings,
    openOptionsPage: () => browser.runtime.openOptionsPage(),
    // Any extension API call resets the MV3 idle timer while a long analysis is pending.
    keepAlive: () => browser.runtime.getPlatformInfo(),
  });

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isBackgroundMessage(message)) return undefined;
    void router.handle(message).then(sendResponse);
    return true; // keep the channel open for the async response
  });
});
