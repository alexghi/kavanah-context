import { parseArgs } from "node:util";
import {
  AnalyzePostResponseSchema,
  DraftKindSchema,
  DraftResponseSchema,
  type AnalyzeOptions,
  type AnalyzePostResponse,
  type DraftResponse,
  type PostContext,
} from "@kavannah/shared";
import { loadEnv, resolveConfig } from "./config.js";
import { createRouter } from "./lib/ai/factory.js";
import { analyzePost } from "./lib/analysis/analyzePost.js";
import { generateDraft } from "./lib/analysis/draft.js";
import { formatAnalysis, formatDraft } from "./lib/format.js";
import { consoleLogger, silentLogger } from "./lib/log.js";
import { FIXTURES, findFixture } from "./mock/fixtures.js";
import { mockAnalyze, mockDraft } from "./mock/mockProvider.js";

const USAGE = `Usage:
  npm run analyze -- --fixture <id> [--mock] [--json] [--draft reply|community_note]
  npm run analyze -- --text "..." [--url https://x.com/u/status/1] [--author @handle] [--mock] [--json] [--draft reply|community_note]

Options:
  --fixture <id>   analyze a built-in demo post (ids: ${FIXTURES.map((f) => f.id).join(", ")})
  --text "..."     analyze this text
  --url <url>      post URL (default: a synthetic x.com URL)
  --author <@h>    author handle
  --mock           use the built-in fixtures instead of calling the model
  --json           print raw JSON (the analysis; with --draft: { analysis, draft })
  --draft <kind>   also generate a draft: reply | community_note
  --help`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      fixture: { type: "string" },
      text: { type: "string" },
      url: { type: "string" },
      author: { type: "string" },
      mock: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      draft: { type: "string" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  let post: PostContext;
  if (values.fixture) {
    const fixture = findFixture(values.fixture);
    if (!fixture) {
      console.error(`Unknown fixture "${values.fixture}". Known ids: ${FIXTURES.map((f) => f.id).join(", ")}`);
      return 1;
    }
    post = fixture.post;
  } else if (values.text?.trim()) {
    const url = values.url?.trim() || `https://x.com/cli_user/status/${Date.now()}`;
    const id = /\/status\/(\d+)/.exec(url)?.[1];
    post = { platform: "x", url, text: values.text, ...(id ? { id } : {}) };
    if (values.author?.trim()) post.author = { handle: values.author.trim().startsWith("@") ? values.author.trim() : `@${values.author.trim()}` };
  } else {
    console.error(USAGE);
    return 1;
  }

  let draftKind: "reply" | "community_note" | undefined;
  if (values.draft !== undefined) {
    const parsedKind = DraftKindSchema.safeParse(values.draft);
    if (!parsedKind.success) {
      console.error(`--draft must be reply or community_note (got "${values.draft}")`);
      return 1;
    }
    draftKind = parsedKind.data;
  }

  loadEnv();
  const config = resolveConfig();
  const mock = values.mock || config.mode === "mock";
  const log = values.json ? silentLogger : consoleLogger;
  if (!values.json) {
    for (const notice of config.notices) log.info(notice);
    if (mock && values.mock) log.info("--mock: using built-in fixtures, the model is not called.");
    if (!mock) log.info(`live analysis with ${config.model} (effort ${config.effort}, web search ${config.webSearchEnabled ? "on" : "off"})`);
  }

  const options: AnalyzeOptions = { mock };
  let analysis: AnalyzePostResponse;
  let draft: DraftResponse | undefined;

  if (mock) {
    analysis = await mockAnalyze(post, options, { delayMs: [0, 0] });
    if (draftKind) draft = await mockDraft({ post, analysis, kind: draftKind, options }, { delayMs: [0, 0] });
  } else {
    const provider = createRouter(config, process.env, log);
    if (!values.json) for (const line of provider.describe()) log.info(line.trim());
    analysis = await analyzePost(post, options, { provider, log });
    if (draftKind) draft = await generateDraft({ post, analysis, kind: draftKind, options }, { provider, log });
  }

  // Same guarantee as the HTTP layer: the output must validate against the shared contract.
  analysis = AnalyzePostResponseSchema.parse(analysis);
  if (draft) draft = DraftResponseSchema.parse(draft);

  if (values.json) {
    console.log(JSON.stringify(draft ? { analysis, draft } : analysis, null, 2));
  } else {
    console.log(formatAnalysis(analysis));
    if (draft) {
      console.log("");
      console.log(formatDraft(draft));
    }
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    if (err instanceof Error && process.env.KAVANNAH_DEBUG) console.error(err.stack);
    process.exit(1);
  });
