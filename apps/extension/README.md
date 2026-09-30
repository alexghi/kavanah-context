# @kavannah/extension

Chrome extension (WXT 0.21 + React 19 + Tailwind v4). On x.com every post gets a **K** button in its
action bar; clicking it opens the Kavannah panel with the analysis from the Kavannah backend (local or hosted) and
the two independent recommendations. Nothing is ever posted or submitted; the extension holds no AI API key, only the
person's access key for a hosted server.

## Commands

```sh
npm run build -w @kavannah/extension      # -> .output/chrome-mv3 (load this folder as "unpacked")
npm run typecheck -w @kavannah/extension  # wxt prepare + tsc
npm test -w @kavannah/extension           # vitest + jsdom (DOM extraction, injection, menu flow, router, ...)
npm run icons -w @kavannah/extension      # regenerates public/icon/*.png (pure Node, no deps)
```

Load in Chrome: `chrome://extensions` -> Developer mode -> Load unpacked -> `apps/extension/.output/chrome-mv3`.
The backend URL, access key (hosted servers), demo mode, trusted sources and language live in the options page
(toolbar icon -> gear). `WXT_BACKEND_URL=https://… npm run build` bakes a hosted server's URL in as the default.

## Layout

| Path | Role |
|---|---|
| `entrypoints/background.ts` | Service worker: the only place that calls the backend (`lib/background/router.ts`) |
| `entrypoints/kavannah.content/` | Content script for x.com/twitter.com: K buttons, the Shadow-DOM panel, popup messages |
| `entrypoints/popup/`, `entrypoints/options/` | Toolbar popup (same panel, embedded) and the settings page |
| `lib/x/extractPost.ts` | Pure DOM -> `PostContext` (tested against `test/fixtures/x-timeline.html`) |
| `lib/x/inject.ts` | Idempotent, MutationObserver-driven K-button injection |
| `lib/x/communityNoteMenu.ts` | Opens the post's ••• menu, opens X's "Request Community Note" form and fills it with the note draft (sends it only if the setting is on); otherwise highlights the item |
| `components/` | `KavannahPanel` and its cards; `components/ui/*` are hand-written shadcn-style primitives |
| `hooks/useAnalysis.ts` | idle -> loading -> result / error state machine with retry and draft generation |

Messages between the pages and the worker are the `ExtensionMessage` union from `@kavannah/shared`.
