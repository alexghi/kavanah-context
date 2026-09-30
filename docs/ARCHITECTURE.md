# Kavannah architecture (hackathon MVP)

Decisions taken on 2026-09-29 with the product owner. Everything here is deliberately
simple: one laptop, one browser, one small API.

```
Chrome (x.com)                                   Laptop (default), ngrok tunnel, or Google Cloud Run   (NDJSON stream)
┌──────────────────────────────┐   JSON/HTTP   ┌──────────────────────────────────┐
│ content script               │ ───────────▶ │ Node server (Express)            │
│  • injects a "K" button into │              │  POST /api/analyze               │
│    every post's action bar   │              │  POST /api/draft                 │
│  • extracts PostContext      │              │  GET  /api/health, /api/fixtures │
│  • renders the Kavannah      │ ◀─────────── │                                  │
│    panel in a Shadow DOM     │              │  lib/ai      provider abstraction│
│ background service worker    │              │  lib/sources web search + URL    │
│  • proxies fetches (no CORS) │              │              validation          │
│ popup (toolbar icon)         │              │  lib/analysis 6 prompt stages    │
│  • same UI for the open post │              │  mock/       demo fixtures       │
└──────────────────────────────┘              └──────────────────────────────────┘
```

## Repository layout

```
packages/shared   Zod schemas + types + product copy shared by both sides (single source of truth)
apps/server       Express API, analysis pipeline, LLM provider, source retrieval, mock fixtures, CLI
apps/extension    WXT (Vite) Chrome extension: content script, background, popup, options
e2e/              Playwright harness: loads the built extension against a fake x.com page + mock server
docs/             this file, plus notes
```

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Where the "K" lives | Injected into each post's action bar on x.com; click opens an in-page panel (Shadow DOM). Toolbar popup also works on a post page. | Works in the timeline and on post pages; the panel stays open while the user pastes a draft into X. |
| LLM | Anthropic Claude, default `claude-opus-5-5`, configurable via `KAVANNAH_MODEL`. Provider is behind `lib/ai/provider.ts`. | Best judgment on nuanced content; swappable. |
| Model tiers and speed (decided 2026-09-30) | Three tiers behind one routing provider (`lib/ai/router.ts`): the **judge** (Opus: classification with the IHRA screening, evidence verdicts, the IHRA review, both recommendations, drafts), the **fast** tier (`KAVANNAH_MODEL_FAST`, Haiku: claim extraction and every web-search research call, one call per claim and two focused IHRA research calls, all in parallel), and **OpenRouter** (`KAVANNAH_OPENROUTER_KEY`): automatic failover for Anthropic rate limits, overloads and timeouts on the same Claude model, plus any `vendor/model` id runs there directly, with its web plugin for research (`KAVANNAH_SEARCH_MODEL`). Short stages run at low effort. Stages overlap: the evidence chain starts when the claims are in, the IHRA research when the screening flags the post. | Search stages were the long pole (30-60 s on Opus, ~5 s per call on Haiku); parallel per-claim searches and overlapping stages cut a live analysis from 56 s to ~35 s and a flagged post from 127 s to well under a minute, at lower cost. Failover keeps the demo running under rate limits. |
| Progressive delivery (decided 2026-09-30) | `POST /api/analyze` streams NDJSON events when asked (`Accept: application/x-ndjson`): progress snapshots after the classification, the evidence and the IHRA review, then the result. The extension reads the stream in its service worker and forwards events to the page over a runtime Port; the panel renders each part as it arrives with pending states for the rest. Plain JSON stays the default (CLI, tests, older clients). | The assessment is readable after ~10 s instead of at the very end; one stateless request per analysis, so Cloud Run needs no session affinity. |
| Evidence | Claude's server-side `web_search` tool. Sources are taken **only** from real search results/citations returned by the tool, then URL-checked by the backend. If search is unavailable, evidence is reported as unavailable, never invented. | Structural guarantee against fabricated sources. |
| Backend | Local Node server on `127.0.0.1:8787`; key in `.env`. | Fastest to demo; the extension never holds secrets or prompts. |
| Hosting (decided 2026-09-29) | The same server also runs hosted: today through an ngrok tunnel from the laptop, for production on Google Cloud Run (project `kavannah`, region europe-west1, `deploy/cloudrun.sh`, secrets in Secret Manager). Hosted servers require one access key per person and apply per-key rate limits and a concurrency cap; the platform URL is used first, a custom domain can be mapped later. | Judges and teammates can use it without running anything; per-person keys can be revoked one at a time; scale-to-zero keeps idle cost at zero; a 300 s request timeout fits 60-120 s analyses. |
| Structured output | Every model stage uses structured JSON output validated with Zod; invalid output degrades gracefully to "uncertain". | Reliability requirement. |
| Two recommendations | "Should I engage?" and "Should I add a Community Note?" are produced by **separate** prompt stages and rendered as **equal** cards. | Core product principle. |
| Drafts | Generated on demand (`POST /api/draft`), editable, copy-only. Nothing is ever posted. | User stays in control; faster first analysis. |
| Explanations and contrast (decided 2026-09-30) | Every label, score band, antisemitism level and category, confidence level and evidence verdict is explained where it appears, from one shared source (`packages/shared/src/explain.ts`, worded to match the prompts). Labels are split into *What was found* (coloured, with an icon) and *Kind of post* (outlined, not a judgement). "How to read this analysis" lists everything. All text meets WCAG AA in both themes; the e2e contrast audit (`e2e/contrast.mjs`) checks every visible text in all ten demo analyses. | Testers and judges must understand each tag without prior knowledge; colour never carries meaning alone. |
| Manipulation layer (decided 2026-09-30) | The classification call also names the manipulation techniques the post uses (15 techniques in four families: emotional and social pressure, distorted evidence, distorted reasoning, blame narratives), each with the post's own words as the trigger, an explanation and a confidence, plus a level (none / present / central). Judged separately from truth. Shown as its own part ("Manipulation techniques") of the Content & manipulation assessment section, with definitions, next to the seven manipulation signals that the same call returns; fed to both recommendations and the drafts, so a note can state the missing piece ("the comparison starts at the 2016 El Niño peak"). | The brief's "information-manipulation analysis"; a true post can manipulate and a false one can argue fairly, and readers need the mechanism named to see it. No extra latency: it rides on the existing call. |
| Mock mode | `KAVANNAH_MOCK=1` (or extension setting) serves 10 hand-written fixtures covering the brief's scenarios; matched by text similarity. | Demo without a key or quota. |

## Analysis pipeline (server)

```
PostContext
  ├─ stage 1  extractClaims      (structured)   claims + types + check-worthiness
  ├─ stage 2  classifyContent    (structured)   labels, antisemitism screening (IHRA patterns), manipulation
  │                                              signals and techniques, manipulation score, confidence
  │                                              [runs in parallel with 1]
  ├─ stage 3  retrieveEvidence   (web_search)   candidate sources for check-worthy claims (skipped if none)
  ├─ stage 4  assessEvidence     (structured)   per-claim verdict; sources chosen by id from stage 3 only
  ├─ stage 5a recommendEngagement(structured)   engage / do_not_engage / uncertain + rationale   ┐ parallel,
  ├─ stage 5b recommendNote      (structured)   recommended / not_recommended / uncertain        ┘ independent
  └─ stage 6  drafts             (structured)   on demand: reply or Community Note
```

The manipulation score (`disinformationScore` in the API) is an indicative AI assessment (0-100) and is shown separately
from confidence. The UI never presents it as "% false".

## Safety rules enforced in code, not just prompts

* Sources come only from web-search results (by id) or from fixtures. Model-proposed URLs are rejected.
* Every source URL is checked (HEAD/GET, short timeout) and flagged `verified`.
* Refusals, invalid JSON, timeouts and rate limits degrade to `uncertain` with a warning in `meta.warnings`.
* The extension has no AI API key and no prompts. It only reads the DOM, calls the configured Kavannah server and copies text.
* A live server on a non-loopback interface refuses to start without `KAVANNAH_ACCESS_KEYS`; model-calling routes need a valid bearer key, are rate-limited per key and capped in concurrency (`lib/auth.ts`, `lib/limits.ts`). Health and fixtures stay open and never reveal keys.
* Nothing is ever posted, submitted or sent to another user. "Request a Community Note" only opens the post's ••• menu and highlights X's own menu item.
