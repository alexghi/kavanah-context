# Kavannah

A Chrome extension for X that helps you decide what to do about a post that may be misleading or antisemitic.
Click the **K** in a post's action bar and Kavannah shows what is potentially problematic, how the post persuades
(the manipulation techniques it uses, quoted from its own words), the evidence, and two **independent** recommendations:

- **Should I engage?** — engage / don't engage / uncertain, with a rationale and an editable reply draft.
- **Should I add a Community Note?** — recommended / not recommended / uncertain, with a rationale, an editable
  note draft that follows X's own [Community Notes guidance](https://communitynotes.x.com/guide/en/contributing/examples),
  and a shortcut to X's "Request Community Note" menu item.

Kavannah never posts, submits or contacts anyone. You copy what you decide to publish.

## Quick start

Requirements: Node 22+, Google Chrome, an Anthropic API key.

```bash
npm install
cp .env.example .env            # put ANTHROPIC_API_KEY in .env (never committed)
npm run dev                     # backend on http://127.0.0.1:8787 + extension dev build
```

`npm run dev` starts the API and `wxt` in dev mode, which opens a separate Chrome profile with the extension
loaded (log in to X there). To use your normal Chrome instead:

```bash
npm run build                                   # writes apps/extension/.output/chrome-mv3
# chrome://extensions → Developer mode → Load unpacked → select that folder
npm run dev:server                              # keep the backend running
```

Then open [x.com](https://x.com), find a post, and click the **K** at the end of its action bar.
The toolbar icon works too when a post page is open.

### Demo mode (no API key, no quota)

- Set `KAVANNAH_MOCK=1` in `.env`, or turn on **Demo mode** in the extension's settings page.
- Ten built-in posts cover the scenarios from the brief (misleading claim, antisemitic claim, antisemitic content
  without a claim, political opinion, benign fact, insufficient evidence, "don't engage but add a note",
  "neither", mention-not-use, misleading framing). The toolbar popup offers them as a picker when no X tab is open.
- The backend also falls back to demo mode automatically when no key is configured.

### Command line

```bash
npm run analyze -- --fixture no-engage-note-recommended --mock        # the key demo scenario, offline
npm run analyze -- --fixture benign-factual                           # live analysis of a built-in post
npm run analyze -- --text "..." --url https://x.com/u/status/1 --json # live analysis of any text
npm run analyze -- --fixture misleading-claim --draft community_note  # generate a note draft
```

(Use `npm run --silent analyze -- ...` when piping `--json` output.)

### Hosted server (share it with judges and teammates)

The same server runs behind a public URL, protected by one access key per person and rate limits.
Anything that calls the model needs a key; a live server on a public interface refuses to start without one.

```bash
npm run keys -- add judge-1          # one key per person, stored in .env, printed once
npm run serve:public                 # today: this laptop + an ngrok tunnel (URL printed by ngrok)
deploy/cloudrun.sh all               # production: Google Cloud Run (see docs/DEPLOY.md)
npm run package:testers              # zip with the extension (production URL baked in) + tester guide
```

Each person pastes their key in **Settings → Access key** (and the URL in **Backend URL** unless it was baked into
the build) and presses **Test connection**. Details, costs and operations: [docs/DEPLOY.md](docs/DEPLOY.md).

## Environment variables (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required for live analysis. Missing key → demo mode. |
| `ANTHROPIC_BASE_URL` | — | Optional custom endpoint. |
| `KAVANNAH_MODEL` | `claude-opus-5-5` | Judge tier: classification, evidence verdicts, the IHRA review, both recommendations, drafts. |
| `KAVANNAH_MODEL_FAST` | — | Fast tier: claim extraction and the web-search research calls (Haiku). Unset = judge model. |
| `KAVANNAH_SEARCH_MODEL` | — | Research calls on another backend; an OpenRouter id (`vendor/model`) uses OpenRouter's web plugin. |
| `KAVANNAH_OPENROUTER_KEY` | — | Enables OpenRouter: `vendor/model` ids run there, and Anthropic rate limits, overloads and timeouts fail over to the same Claude model on OpenRouter. |
| `KAVANNAH_OPENROUTER_FAILOVER` | `1` | `0` = no failover (the key is used for direct routing only). |
| `KAVANNAH_EFFORT` | `medium` | `low` / `medium` / `high` reasoning effort of the judge stages; extraction, research and the recommendations run `low`. |
| `KAVANNAH_PORT` | `8787` | Backend port (the extension's default backend URL matches). |
| `KAVANNAH_MOCK` | `0` | `1` = never call the model; answer from fixtures. |
| `KAVANNAH_WEB_SEARCH` | `1` | `0` = no live source retrieval; evidence is reported as unavailable. |
| `KAVANNAH_ACCESS_KEYS` | — | `name:key` pairs (comma-separated) managed by `npm run keys`. When set, analyses and drafts need a bearer key. |
| `KAVANNAH_HOST` | `127.0.0.1` | `0.0.0.0` to accept outside connections (the Dockerfile sets it). Requires keys in live mode. |
| `KAVANNAH_RATE_LIMIT` | `30` | Live analyses + drafts per key (or per IP) per hour; `0` = unlimited. |
| `KAVANNAH_MAX_CONCURRENT` | `4` | Live analyses in flight at once; `0` = unlimited. |
| `KAVANNAH_TRUST_PROXY` | auto | Trust `X-Forwarded-*` from Cloud Run / ngrok (on whenever the host is not loopback). |

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Backend + extension dev build (opens a Chrome profile with the extension). |
| `npm run dev:server` / `npm run dev:extension` | Either side alone. |
| `npm run build` | Production extension build in `apps/extension/.output/chrome-mv3`. |
| `npm run typecheck` / `npm test` | TypeScript and unit tests for all packages. |
| `npm run e2e` | Playwright: loads the built extension into Chromium against a fake X page and the demo backend, asserts the full flow and writes screenshots to `e2e/artifacts/`. |
| `npm run analyze -- …` | Command-line analysis (see above). |
| `npm run serve` / `npm run serve:public` | Backend alone / backend + ngrok tunnel with a public URL. |
| `npm run keys -- add\|list\|show\|remove <name>` | Per-person access keys in `.env`. |
| `npm run bundle` | Single-file production build of the server (`apps/server/dist/server.mjs`, used by the Dockerfile). |
| `deploy/cloudrun.sh setup\|secrets\|deploy\|keys\|url\|smoke\|logs\|all` | Google Cloud Run deployment (`docs/DEPLOY.md`). |

## How it works

```
x.com page ── content script ── background worker ── POST /api/analyze ── analysis pipeline (Claude)
   "K" button   extracts PostContext   proxies fetch        POST /api/draft         1 extract claims ┐ parallel
   Shadow-DOM   opens the panel        validates JSON       GET  /api/health        2 classify       ┘
   panel                                                    GET  /api/fixtures      3 web search for sources
                                                                                    4 assess evidence (sources by id only)
                                                                                    5a engage?   ┐ parallel,
                                                                                    5b note?     ┘ independent
                                                                                    6 drafts on demand
```

- `packages/shared` — Zod schemas and types shared by both sides (single source of truth), product copy, the
  Community Notes guidance digest, and the plain-language definitions of every label, technique, level and verdict.
- `apps/server` — Express API, provider abstraction (`lib/ai`), source retrieval + URL verification
  (`lib/sources`), prompt stages (`lib/analysis`), demo fixtures (`mock`), CLI.
- `apps/extension` — WXT + React + Tailwind: content script (K button, DOM extraction, in-page panel),
  background router, toolbar popup, settings page.
- `e2e` — Playwright harness. `docs/ARCHITECTURE.md` — decisions and rationale.

### Safety properties enforced in code

- Sources can only come from real web-search results returned by the model's search tool (chosen by id) or from
  fixtures; any other URL is dropped, and every URL is checked and flagged `verified`.
- When search is unavailable or finds nothing, the evidence says so explicitly instead of guessing.
- The two recommendations come from separate prompt stages that never see each other's answer.
- Model refusals, invalid JSON, timeouts and rate limits degrade to "uncertain" with a visible warning.
- The disinformation score is labelled as an indicative AI assessment and shown separately from confidence.
- The extension holds no AI key and no prompts, and only reads the DOM, calls the Kavannah server you configured
  and copies text. "Request a Community Note" opens the post's ••• menu and highlights X's own item; it never clicks it.
- A hosted server needs a per-person access key for anything that calls the model, rate-limits each key and caps
  concurrent analyses. A live server bound to a public interface refuses to start without keys.

## Limitations (hackathon MVP)

- X's DOM selectors (`data-testid` attributes) can change; extraction is best-effort and unit-tested against a
  realistic fixture, not against live X in CI.
- The panel fills in progressively: the assessment appears after about 6 s, the evidence after about 25 s, and
  the recommendations at about 32 s (measured on a benign post at medium effort; it was 56 s in one piece before).
  A post that triggers the full IHRA review takes about 70 s, with the review arriving a few seconds before the end
  (127 s before). Results are cached per post URL for an hour.
- Posts truncated by X ("Show more") are analyzed from the visible text only.
- Only X in Chrome; no automatic posting; no accounts; trusted-source preferences only influence source selection.
