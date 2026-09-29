import { fakeBrowser } from "wxt/testing/fake-browser";

// `wxt/browser` picks `globalThis.browser`/`globalThis.chrome` at import time. Setup files run
// before test modules are imported, so every test sees the in-memory fake extension API.
(globalThis as unknown as { chrome: unknown }).chrome = fakeBrowser;
(globalThis as unknown as { browser: unknown }).browser = fakeBrowser;
