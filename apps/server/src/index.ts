import { createApp } from "./app.js";
import { isLoopback, loadEnv, resolveConfig, startupBlocker } from "./config.js";
import { AnthropicProvider } from "./lib/ai/anthropic.js";
import { ANALYSIS_CACHE_TTL_MS, TtlCache } from "./lib/cache.js";
import { consoleLogger } from "./lib/log.js";
import { PROMPT_VERSION } from "./lib/analysis/prompts.js";
import { FIXTURES } from "./mock/fixtures.js";

const envFiles = loadEnv();
const config = resolveConfig();
const log = consoleLogger;
for (const notice of config.notices) log.info(notice);

const blocker = startupBlocker(config);
if (blocker) {
  log.error(blocker);
  process.exit(1);
}

const provider =
  config.mode === "live"
    ? new AnthropicProvider({ model: config.model, effort: config.effort, webSearch: config.webSearchEnabled, log })
    : null;

const app = createApp({ config, provider, cache: new TtlCache(ANALYSIS_CACHE_TTL_MS), log });

const server = app.listen(config.port, config.host, () => {
  const modeLabel = config.mode === "mock" ? `mock (${config.mockForced ? "KAVANNAH_MOCK=1" : "no API key"})` : "live";
  const webSearch = config.mode === "live" && config.webSearchEnabled ? "on" : config.webSearchEnabled ? "off (mock mode)" : "off (KAVANNAH_WEB_SEARCH=0)";
  const keys =
    config.accessKeys.length > 0
      ? `${config.accessKeys.length} (${config.accessKeys.map((k) => k.name).join(", ")})`
      : isLoopback(config.host)
        ? "none (open; loopback only)"
        : "none (OPEN TO EVERYONE)";
  const limits = `${config.rateLimitPerHour > 0 ? `${config.rateLimitPerHour}/h per key` : "no rate limit"}, ${config.maxConcurrent > 0 ? `${config.maxConcurrent} concurrent` : "unlimited concurrency"}`;
  const lines = [
    "Kavannah server",
    `  listening    http://${config.host}:${config.port}${config.trustProxy ? " (behind a trusted proxy)" : ""}`,
    `  mode         ${modeLabel}`,
    `  model        ${config.model} (effort: ${config.effort}, prompts ${PROMPT_VERSION})`,
    `  web search   ${webSearch}`,
    `  API key      ${config.hasApiKey ? "set" : "not set"}`,
    `  access keys  ${keys}`,
    `  limits       ${limits}`,
    `  env files    ${envFiles.length ? envFiles.join(", ") : "none"}`,
    `  fixtures     ${FIXTURES.length} demo posts`,
  ];
  console.log(lines.join("\n"));
});

// Keep idle connections open longer than the proxy in front does, so it never reuses a socket
// the server has just closed (a classic source of sporadic 502s behind load balancers).
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;

server.on("error", (err) => {
  log.error(`failed to listen on ${config.host}:${config.port}: ${err.message}`);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log.info(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
