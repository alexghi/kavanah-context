import type { PostContext } from "@kavannah/shared";
import type { HostTheme } from "./theme";

/** Tiny external store for the single in-page panel (read by React via useSyncExternalStore). */

export interface PanelState {
  open: boolean;
  post: PostContext | null;
  /** The article element the current post was extracted from (for the Community Note flow). */
  article: HTMLElement | null;
  /** Inline toast text (e.g. extraction failures). */
  notice: string | null;
  theme: HostTheme | null;
}

export interface PanelStore {
  getState(): PanelState;
  subscribe(listener: () => void): () => void;
  open(post: PostContext, article: HTMLElement | null): void;
  close(): void;
  setNotice(notice: string | null): void;
  setTheme(theme: HostTheme | null): void;
}

export function createPanelStore(initial: Partial<PanelState> = {}): PanelStore {
  let state: PanelState = { open: false, post: null, article: null, notice: null, theme: null, ...initial };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<PanelState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open(post, article) {
      set({ open: true, post, article, notice: null });
    },
    close() {
      set({ open: false });
    },
    setNotice(notice) {
      set(notice ? { notice, open: true } : { notice });
    },
    setTheme(theme) {
      if (theme !== state.theme) set({ theme });
    },
  };
}
