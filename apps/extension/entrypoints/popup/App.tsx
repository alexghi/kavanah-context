import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, LoaderCircle, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { browser } from "wxt/browser";
import type { FixturesResponse, PostContext } from "@kavannah/shared";
import { KavannahPanel } from "@/components/KavannahPanel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { client, getCurrentPostFromTab, requestCommunityNoteInTab, withMock } from "@/lib/api";
import { humanize } from "@/lib/labels";
import type { CommunityNoteMenuStatus } from "@/lib/x/communityNoteMenu";

type FixtureSummary = FixturesResponse["fixtures"][number];

type TabState =
  | { status: "detecting" }
  | { status: "post"; post: PostContext; tabId: number | null; demo: boolean }
  | { status: "none" };

type FixturesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; fixtures: FixtureSummary[] }
  | { status: "error"; message: string };

const X_URL = /^https:\/\/(?:x|twitter)\.com\//;

/** The post on the active tab, when it is an X post page with our content script running. */
async function detectCurrentPost(): Promise<TabState> {
  try {
    const [active] = await browser.tabs.query({ active: true, currentWindow: true });
    if (active?.id !== undefined && active.url && X_URL.test(active.url)) {
      const response = await getCurrentPostFromTab(active.id);
      if (response.ok && response.data) return { status: "post", post: response.data, tabId: active.id, demo: false };
    }
  } catch {
    /* no tab access: fall through to the empty state */
  }
  return { status: "none" };
}

function Shell({ onOpenSettings, children }: { onOpenSettings: () => void; children: ReactNode }) {
  return (
    <div className="kavannah-root flex h-full flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border bg-card px-4 py-3">
        <span
          aria-hidden="true"
          className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-[15px] font-bold leading-none text-primary-foreground"
        >
          K
        </span>
        <span className="text-[15px] font-semibold tracking-tight">Kavannah</span>
        <div className="ml-auto">
          <Button variant="ghost" size="icon" aria-label="Open Kavannah settings" title="Settings" onClick={onOpenSettings}>
            <SettingsIcon aria-hidden="true" />
          </Button>
        </div>
      </header>
      <div className="kavannah-scroll min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

export function App() {
  const [tab, setTab] = useState<TabState>({ status: "detecting" });
  const [fixtures, setFixtures] = useState<FixturesState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;
    void detectCurrentPost().then((found) => {
      if (!cancelled) setTab(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadFixtures = useCallback(async () => {
    setFixtures({ status: "loading" });
    const response = await client.fixtures();
    setFixtures(
      response.ok
        ? { status: "ready", fixtures: response.data.fixtures }
        : { status: "error", message: response.error.message },
    );
  }, []);

  useEffect(() => {
    if (tab.status === "none") void loadFixtures();
  }, [tab.status, loadFixtures]);

  const openSettings = () => {
    void browser.runtime.openOptionsPage();
  };

  if (tab.status === "detecting") {
    return (
      <Shell onOpenSettings={openSettings}>
        <div className="flex items-center gap-2 p-4 text-[13px] text-muted-foreground" role="status">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Looking for a post on this tab…
        </div>
      </Shell>
    );
  }

  if (tab.status === "post") {
    const { post, tabId, demo } = tab;
    const requestNote = async (): Promise<CommunityNoteMenuStatus> => {
      if (tabId === null) return { status: "not_offered", reason: "no_article" };
      const response = await requestCommunityNoteInTab(tabId);
      if (!response.ok) throw new Error(response.error.message);
      return response.data;
    };
    return (
      <div className="kavannah-root flex h-full flex-col bg-background text-foreground">
        {demo && (
          <button
            type="button"
            className="flex shrink-0 cursor-pointer items-center gap-1.5 border-b border-border bg-muted px-4 py-1.5 text-left text-[12px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => setTab({ status: "none" })}
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            All demo posts
          </button>
        )}
        <div className="min-h-0 flex-1">
          <KavannahPanel
            variant="embedded"
            post={post}
            client={demo ? withMock(client) : client}
            demo={demo}
            onOpenSettings={openSettings}
            onRequestCommunityNote={requestNote}
          />
        </div>
      </div>
    );
  }

  return (
    <Shell onOpenSettings={openSettings}>
      <div className="space-y-4 p-4">
        <p className="text-[13px] leading-5 text-muted-foreground">
          Open a post on X and click the{" "}
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-accent align-middle text-[12px] font-bold text-accent-foreground" aria-label="K">
            K
          </span>{" "}
          button in its action bar, or pick a demo post:
        </p>

        {fixtures.status === "loading" && (
          <div className="space-y-2" aria-busy="true" aria-label="Loading demo posts">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg border border-border p-3">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="mt-2 h-3 w-1/3" />
                <Skeleton className="mt-2 h-3 w-full" />
              </div>
            ))}
          </div>
        )}

        {fixtures.status === "error" && (
          <div className="space-y-2">
            <Alert variant="destructive">
              <AlertDescription>{fixtures.message}</AlertDescription>
            </Alert>
            <Button size="sm" variant="outline" onClick={() => void loadFixtures()}>
              <RefreshCw aria-hidden="true" />
              Retry
            </Button>
          </div>
        )}

        {fixtures.status === "ready" && (
          <ul className="space-y-2" aria-label="Demo posts">
            {fixtures.fixtures.map((fixture) => (
              <li key={fixture.id}>
                <button
                  type="button"
                  className="w-full cursor-pointer rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  onClick={() => setTab({ status: "post", post: fixture.post, tabId: null, demo: true })}
                >
                  <span className="block text-[13px] font-medium text-foreground">{fixture.title}</span>
                  <span className="block text-[11.5px] text-muted-foreground">{humanize(fixture.scenario)}</span>
                  <span className="mt-1 line-clamp-2 block text-[12px] leading-4 text-foreground/80">{fixture.post.text}</span>
                </button>
              </li>
            ))}
            {fixtures.fixtures.length === 0 && (
              <li className="text-[12.5px] text-muted-foreground">The server has no demo posts configured.</li>
            )}
          </ul>
        )}
      </div>
    </Shell>
  );
}
