/** HTTP contract between the extension and the backend. */
export const API_ROUTES = {
  health: "/api/health",
  analyze: "/api/analyze",
  draft: "/api/draft",
  fixtures: "/api/fixtures",
} as const;

export const DEFAULT_BACKEND_URL = "http://127.0.0.1:8787";
export const DEFAULT_PORT = 8787;

/**
 * Progressive analysis over a runtime Port (content script / popup <-> service worker): the
 * page connects with this name, sends one AnalyzePortStart, and receives AnalysisEvents
 * (progress…, then result or error) until the worker disconnects.
 */
export const ANALYZE_PORT_NAME = "kavannah:analyze";
export type AnalyzePortStart = {
  type: "kavannah:analyze:start";
  payload: { post: import("./schemas").PostContext; options?: import("./schemas").AnalyzeOptions };
};

/**
 * Extension messaging.
 * - content script / popup -> service worker: everything that reaches the backend, the settings
 *   and the options page (the worker owns `fetch`, so pages never talk to the server directly).
 * - popup -> content script (via `tabs.sendMessage`): the two page-side requests at the bottom.
 */
export type ExtensionMessage =
  | { type: "kavannah:analyze"; payload: { post: import("./schemas").PostContext; options?: import("./schemas").AnalyzeOptions } }
  | { type: "kavannah:draft"; payload: import("./schemas").DraftRequest }
  | { type: "kavannah:health" }
  | { type: "kavannah:fixtures" }
  | { type: "kavannah:getSettings" }
  | { type: "kavannah:setSettings"; payload: Partial<import("./settings").Settings> }
  | { type: "kavannah:openOptions" }
  /** popup -> content script: the post on the current page (the main post on /status/<id> pages), or null */
  | { type: "kavannah:getCurrentPost" }
  /** popup -> content script: run the "Request a Community Note" flow on the current post, filling X's form with `explanation` */
  | { type: "kavannah:requestCommunityNote"; payload?: { explanation?: string; sourceUrl?: string } };

export type ExtensionResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
