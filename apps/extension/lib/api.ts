import { browser } from "wxt/browser";
import type {
  AnalyzeOptions,
  AnalyzePostResponse,
  DraftRequest,
  DraftResponse,
  ExtensionMessage,
  ExtensionResponse,
  FixturesResponse,
  HealthResponse,
  PostContext,
  Settings,
} from "@kavannah/shared";
import type { CommunityNoteMenuStatus } from "./x/communityNoteMenu";
import { describeError } from "./utils";

export class KavannahApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KavannahApiError";
  }
}

type Failure = { ok: false; error: { code: string; message: string } };

function messagingFailure(err: unknown): Failure {
  const text = describeError(err);
  const reloaded = /context invalidated|Receiving end does not exist|message port closed|Could not establish connection/i.test(
    text,
  );
  return {
    ok: false,
    error: reloaded
      ? { code: "EXTENSION_RELOADED", message: "Kavannah was updated or reloaded. Reload this page and try again." }
      : { code: "MESSAGING", message: text },
  };
}

function coerce<T>(value: unknown): ExtensionResponse<T> {
  if (value && typeof value === "object" && "ok" in value) return value as ExtensionResponse<T>;
  return {
    ok: false,
    error: { code: "NO_RESPONSE", message: "Kavannah's background worker didn't answer. Reload the page and try again." },
  };
}

/** content script / popup -> service worker */
export async function sendToBackground<T>(message: ExtensionMessage): Promise<ExtensionResponse<T>> {
  try {
    return coerce<T>(await browser.runtime.sendMessage(message));
  } catch (err) {
    return messagingFailure(err);
  }
}

/** popup -> content script of a tab */
export async function sendToTab<T>(tabId: number, message: ExtensionMessage): Promise<ExtensionResponse<T>> {
  try {
    return coerce<T>(await browser.tabs.sendMessage(tabId, message));
  } catch (err) {
    return messagingFailure(err);
  }
}

/** What the panel needs: the two model-backed calls. Injected so the UI is testable without a browser. */
export interface AnalysisClient {
  analyze(post: PostContext, options?: AnalyzeOptions): Promise<ExtensionResponse<AnalyzePostResponse>>;
  draft(request: DraftRequest): Promise<ExtensionResponse<DraftResponse>>;
}

export interface KavannahClient extends AnalysisClient {
  health(): Promise<ExtensionResponse<HealthResponse>>;
  fixtures(): Promise<ExtensionResponse<FixturesResponse>>;
  getSettings(): Promise<ExtensionResponse<Settings>>;
  setSettings(patch: Partial<Settings>): Promise<ExtensionResponse<Settings>>;
  openOptions(): Promise<ExtensionResponse<null>>;
}

export const client: KavannahClient = {
  analyze: (post, options) =>
    sendToBackground({ type: "kavannah:analyze", payload: options ? { post, options } : { post } }),
  draft: (request) => sendToBackground({ type: "kavannah:draft", payload: request }),
  health: () => sendToBackground({ type: "kavannah:health" }),
  fixtures: () => sendToBackground({ type: "kavannah:fixtures" }),
  getSettings: () => sendToBackground({ type: "kavannah:getSettings" }),
  setSettings: (patch) => sendToBackground({ type: "kavannah:setSettings", payload: patch }),
  openOptions: () => sendToBackground({ type: "kavannah:openOptions" }),
};

/** Same client, but every call is answered from the demo fixtures (popup demo picker). */
export function withMock(base: AnalysisClient): AnalysisClient {
  return {
    analyze: (post, options) => base.analyze(post, { ...options, mock: true }),
    draft: (request) => base.draft({ ...request, options: { ...request.options, mock: true } }),
  };
}

/** Ask the content script of `tabId` for the post on its page (null when there is none). */
export function getCurrentPostFromTab(tabId: number): Promise<ExtensionResponse<PostContext | null>> {
  return sendToTab<PostContext | null>(tabId, { type: "kavannah:getCurrentPost" });
}

/** Ask the content script of `tabId` to open X's ••• menu and highlight the Community Note item. */
export function requestCommunityNoteInTab(tabId: number): Promise<ExtensionResponse<CommunityNoteMenuStatus>> {
  return sendToTab<CommunityNoteMenuStatus>(tabId, { type: "kavannah:requestCommunityNote" });
}

export function unwrap<T>(response: ExtensionResponse<T>): T {
  if (response.ok) return response.data;
  throw new KavannahApiError(response.error.code, response.error.message);
}
