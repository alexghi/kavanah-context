import { useSyncExternalStore } from "react";
import type { PostContext } from "@kavannah/shared";
import type { AnalysisClient } from "@/lib/api";
import type { PanelStore } from "@/lib/panelStore";
import type { CommunityNoteMenuStatus } from "@/lib/x/communityNoteMenu";
import { KavannahPanel, type NoteExplanation } from "./KavannahPanel";

export interface PanelHostProps {
  store: PanelStore;
  client: AnalysisClient;
  onOpenSettings: () => void;
  onRequestCommunityNote: (post: PostContext, explanation?: NoteExplanation) => Promise<CommunityNoteMenuStatus>;
}

/** Bridges the content script's panel store to the single drawer instance. */
export function PanelHost({ store, client, onOpenSettings, onRequestCommunityNote }: PanelHostProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return (
    <KavannahPanel
      variant="drawer"
      open={state.open}
      post={state.post}
      theme={state.theme}
      notice={state.notice}
      onDismissNotice={() => store.setNotice(null)}
      onClose={store.close}
      client={client}
      onOpenSettings={onOpenSettings}
      onRequestCommunityNote={onRequestCommunityNote}
    />
  );
}
