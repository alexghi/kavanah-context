#!/usr/bin/env node
/**
 * Kavannah end-to-end harness.
 *
 * Loads the BUILT extension (apps/extension/.output/chrome-mv3) into real Chromium, serves a fake
 * x.com page (e2e/fixtures/x-page.html) for every https://x.com/** navigation, runs the backend in
 * mock mode, and drives the whole user flow: K button -> panel -> both recommendations -> evidence
 * -> drafts -> copy -> "Request a Community Note" -> popup -> dark mode. Screenshots and a
 * report.json land in e2e/artifacts/.
 *
 *   node e2e/run.mjs [--headed] [--no-build] [--port <n>]
 *
 * Plain Node ESM + node:assert; no test framework. Exit code 1 when any step fails.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { CONTRAST_AUDIT_IN_PAGE, expandAll } from "./contrast.mjs";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT_DIR = path.join(ROOT, "apps/extension/.output/chrome-mv3");
const FIXTURE_HTML = path.join(ROOT, "e2e/fixtures/x-page.html");
const ARTIFACTS = path.join(ROOT, "e2e/artifacts");

const HERO_ID = "1000000000000000007";
const BENIGN_ID = "1000000000000000005";
const QUOTE_ID = "1000000000000000009";
const HERO_URL = `https://x.com/kavannah_demo/status/${HERO_ID}`;
const HERO_FIXTURE = "no-engage-note-recommended";
const BENIGN_FIXTURE = "benign-factual";
const QUOTE_FIXTURE = "mention-not-use";
const HERO_SOURCE_URL = "https://www.federalreserve.gov/faqs/about_14986.htm";

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
const optValue = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const HEADED = hasFlag("--headed");
const NO_BUILD = hasFlag("--no-build");
const PORT = Number.parseInt(optValue("--port", "8790"), 10);
if (!Number.isInteger(PORT) || PORT <= 0) {
  console.error(`--port must be a positive integer (got ${optValue("--port", "8790")})`);
  process.exit(2);
}
const BACKEND_URL = `http://127.0.0.1:${PORT}`;

// Generous but explicit waits. Mock analyses answer in ~0.3-0.8 s; 20 s covers a cold service worker.
const T = { short: 5_000, medium: 10_000, analysis: 20_000, boot: 45_000 };

const log = (...args) => console.log("[e2e]", ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const report = {
  startedAt: new Date().toISOString(),
  finishedAt: null,
  durationMs: 0,
  headless: !HEADED,
  port: PORT,
  extensionId: null,
  build: NO_BUILD ? "skipped (--no-build)" : "pending",
  steps: [],
  screenshots: [],
  browserConsole: [],
  observations: [],
  fixesOutsideE2E: [],
};

let blockedBy = null;

/** Runs one step; failures are recorded, a failure screenshot is taken, and critical failures block the rest. */
async function step(id, name, fn, { critical = false, page = null } = {}) {
  const entry = { id, name, status: "pass", ms: 0, screenshots: [], details: {}, error: null };
  const started = Date.now();
  if (blockedBy) {
    entry.status = "skip";
    entry.error = `blocked by failed step ${blockedBy}`;
    report.steps.push(entry);
    log(`SKIP ${id} ${name} (${entry.error})`);
    return entry;
  }
  try {
    const details = await fn(entry);
    if (details && typeof details === "object") entry.details = { ...entry.details, ...details };
    entry.ms = Date.now() - started;
    log(`ok   ${id} ${name} (${entry.ms} ms)`);
  } catch (err) {
    entry.status = "fail";
    entry.ms = Date.now() - started;
    entry.error = String(err && err.stack ? err.stack : err)
      .split("\n")
      .slice(0, 6)
      .join("\n");
    log(`FAIL ${id} ${name} (${entry.ms} ms)\n${entry.error}`);
    if (page) {
      try {
        await snap(page, `failure-${id}.png`, entry, { fullPage: false });
      } catch (snapErr) {
        log(`  (could not take failure screenshot: ${snapErr.message})`);
      }
    }
    if (critical) blockedBy = id;
  }
  report.steps.push(entry);
  return entry;
}

function observe(text) {
  if (!report.observations.includes(text)) report.observations.push(text);
}

/** Screenshot of a page or locator into e2e/artifacts, recorded on the step. */
async function snap(target, name, entry, options = {}) {
  const file = path.join(ARTIFACTS, name);
  await target.screenshot({ path: file, ...options });
  entry.screenshots.push(name);
  if (!report.screenshots.includes(name)) report.screenshots.push(name);
  return file;
}

/** expect-style polling: resolves with the first truthy probe result, throws after `timeout` ms. */
async function waitUntil(probe, { timeout = T.medium, interval = 100, message = "condition" } = {}) {
  const started = Date.now();
  let last;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
      last = value;
    } catch (err) {
      last = err;
    }
    if (Date.now() - started > timeout) {
      const why = last instanceof Error ? `: ${last.message.split("\n")[0]}` : last === undefined ? "" : ` (last value: ${JSON.stringify(last)})`;
      throw new Error(`Timed out after ${timeout} ms waiting for ${message}${why}`);
    }
    await sleep(interval);
  }
}

// ---------------------------------------------------------------------------
// Backend (mock mode) as a child process
// ---------------------------------------------------------------------------

let backend = null;
const backendLog = [];

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(`${url} answered non-JSON (HTTP ${res.status}): ${text.slice(0, 120)}`);
  }
  return { status: res.status, json };
}

async function startBackend() {
  // Refuse to reuse a stranger's server on the port: the harness must own the process it kills.
  try {
    const probe = await fetchJson(`${BACKEND_URL}/api/health`);
    throw new Error(`port ${PORT} already answers /api/health (${JSON.stringify(probe.json)}); pick another --port`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("already answers")) throw err;
    // connection refused => port is free, which is what we want
  }

  const child = spawn("npx", ["tsx", path.join(ROOT, "apps/server/src/index.ts")], {
    cwd: path.join(ROOT, "apps/server"),
    env: { ...process.env, KAVANNAH_MOCK: "1", KAVANNAH_PORT: String(PORT), KAVANNAH_ACCESS_KEYS: "", FORCE_COLOR: "0", NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32", // own process group so npx -> tsx -> node all die together
  });
  backend = child;
  const collect = (stream, label) =>
    stream.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) backendLog.push(`[${label}] ${line}`);
    });
  collect(child.stdout, "server");
  collect(child.stderr, "server:err");
  child.on("exit", (code, signal) => backendLog.push(`[harness] backend exited code=${code} signal=${signal}`));

  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < T.boot) {
    if (child.exitCode !== null) {
      throw new Error(`backend exited early (code ${child.exitCode}):\n${backendLog.slice(-20).join("\n")}`);
    }
    try {
      const { status, json } = await fetchJson(`${BACKEND_URL}/api/health`);
      if (status === 200 && json && json.ok === true && json.mode === "mock") return json;
      lastError = new Error(`health answered HTTP ${status} ${JSON.stringify(json)}`);
    } catch (err) {
      lastError = err;
    }
    await sleep(250);
  }
  throw new Error(`backend did not report mode "mock" within ${T.boot} ms: ${lastError?.message}\n${backendLog.slice(-20).join("\n")}`);
}

function signalBackend(signal) {
  if (!backend || backend.exitCode !== null || backend.signalCode !== null) return;
  try {
    if (process.platform !== "win32" && backend.pid) process.kill(-backend.pid, signal);
    else backend.kill(signal);
  } catch {
    try {
      backend.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

async function stopBackend() {
  if (!backend) return;
  signalBackend("SIGTERM");
  const started = Date.now();
  while (backend.exitCode === null && backend.signalCode === null && Date.now() - started < 4_000) await sleep(100);
  if (backend.exitCode === null && backend.signalCode === null) signalBackend("SIGKILL");
  backend = null;
}

// ---------------------------------------------------------------------------
// Helpers shared by the steps
// ---------------------------------------------------------------------------

/** Text of a tweetText element the way extractPost.collectText sees it (text nodes + emoji img alt). */
const COLLECT_TEXT_IN_PAGE = `(root) => {
  const parts = [];
  const walk = (node) => {
    if (node.nodeType === 3) { parts.push(node.nodeValue ?? ""); return; }
    if (node.nodeType !== 1) return;
    if (node.tagName === "IMG") { const alt = node.getAttribute("alt"); if (alt) parts.push(alt); return; }
    if (node.tagName === "BR") { parts.push("\\n"); return; }
    if (node.tagName === "BUTTON" || node.tagName === "SCRIPT" || node.tagName === "STYLE" || node.getAttribute("role") === "button") return;
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return parts.join("").replace(/\\u00a0/g, " ").trim();
}`;

/** Reads the drawer root inside the shadow DOM (null when the content script has not mounted). */
const PANEL_STATE_IN_PAGE = `() => {
  const root = document.querySelector("kavannah-panel")?.shadowRoot?.querySelector('[role="dialog"]');
  if (!root) return null;
  const cs = getComputedStyle(root);
  return {
    ariaHidden: root.getAttribute("aria-hidden"),
    inert: root.hasAttribute("inert"),
    visibility: cs.visibility,
    transform: cs.transform,
    position: cs.position,
    width: cs.width,
    background: cs.backgroundColor,
    color: cs.color,
    fontFamily: cs.fontFamily,
    theme: root.getAttribute("data-theme"),
    zIndex: cs.zIndex,
  };
}`;

/** Layout audit of the open drawer: horizontal overflow and elements poking outside the panel. */
const LAYOUT_AUDIT_IN_PAGE = `() => {
  const shadow = document.querySelector("kavannah-panel")?.shadowRoot;
  const dialog = shadow?.querySelector('[role="dialog"]');
  if (!dialog) return null;
  const d = dialog.getBoundingClientRect();
  const scroll = shadow.querySelector(".kavannah-scroll");
  const offenders = [];
  for (const el of dialog.querySelectorAll("*")) {
    const cls = typeof el.className === "string" ? el.className : "";
    if (cls.includes("sr-only")) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > d.right + 1 || r.left < d.left - 1) {
      offenders.push({ tag: el.tagName.toLowerCase(), cls: cls.slice(0, 80), text: (el.textContent || "").trim().slice(0, 60), overflowPx: Math.round(Math.max(r.right - d.right, d.left - r.left)) });
      if (offenders.length >= 8) break;
    }
  }
  let minFont = 99;
  for (const el of dialog.querySelectorAll("p, span, a, button, li, h3, label, textarea")) {
    if (!(el.textContent || "").trim()) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < minFont) minFont = fs;
  }
  return {
    panelWidth: Math.round(d.width),
    panelHeight: Math.round(d.height),
    horizontalOverflowPx: scroll ? scroll.scrollWidth - scroll.clientWidth : null,
    offenders,
    smallestFontPx: minFont,
  };
}`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let context = null;
let userDataDir = null;

async function cleanup() {
  if (context) {
    try {
      await context.close();
    } catch {
      /* already closed */
    }
    context = null;
  }
  await stopBackend();
  if (userDataDir) {
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    userDataDir = null;
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    log(`${signal} received, cleaning up`);
    void cleanup().finally(() => process.exit(130));
  });
}
process.on("uncaughtException", (err) => {
  console.error(err);
  void cleanup().finally(() => process.exit(1));
});

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  for (const stale of fs.readdirSync(ARTIFACTS)) {
    if (/\.(png|json|log)$/.test(stale)) fs.rmSync(path.join(ARTIFACTS, stale), { force: true });
  }

  // 1. Build ----------------------------------------------------------------
  if (!NO_BUILD) {
    log("building the extension (npm run build -w @kavannah/extension)…");
    const build = spawnSync("npm", ["run", "build", "-w", "@kavannah/extension"], { cwd: ROOT, stdio: "inherit", env: { ...process.env, FORCE_COLOR: "0" } });
    if (build.status !== 0) throw new Error(`extension build failed with status ${build.status}`);
    report.build = "ok";
  }
  const manifestPath = path.join(EXT_DIR, "manifest.json");
  assert.ok(fs.existsSync(manifestPath), `missing ${manifestPath} (build the extension first or drop --no-build)`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(fs.existsSync(FIXTURE_HTML), `missing fake X page ${FIXTURE_HTML}`);
  const fixtureHtml = fs.readFileSync(FIXTURE_HTML, "utf8");

  // 2. Backend --------------------------------------------------------------
  log(`starting the mock backend on ${BACKEND_URL}…`);
  const health = await startBackend();
  log(`backend healthy: mode=${health.mode} model=${health.model} v${health.version}`);
  const fixtures = (await fetchJson(`${BACKEND_URL}/api/fixtures`)).json.fixtures;
  const fixtureById = new Map(fixtures.map((f) => [f.id, f]));
  for (const id of [HERO_FIXTURE, BENIGN_FIXTURE, QUOTE_FIXTURE]) assert.ok(fixtureById.has(id), `backend has no fixture "${id}"`);

  // 3. Browser + extension --------------------------------------------------
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kavannah-e2e-"));
  log(`launching Chromium (${HEADED ? "headed" : "headless"}) with the unpacked extension…`);
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: !HEADED,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
    viewport: { width: 1400, height: 950 },
    permissions: ["clipboard-read", "clipboard-write"],
    colorScheme: "light",
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://x.com" });

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: T.analysis });
  assert.match(worker.url(), /^chrome-extension:\/\/[a-p]{32}\/background\.js$/, `unexpected service worker url ${worker.url()}`);
  const extId = new URL(worker.url()).host;
  report.extensionId = extId;
  log(`extension id ${extId}`);

  const attachConsole = (pg, label) => {
    pg.on("console", (msg) => {
      const type = msg.type();
      if (type === "error" || type === "warning") report.browserConsole.push({ page: label, type, text: msg.text().slice(0, 300) });
    });
    pg.on("pageerror", (err) => report.browserConsole.push({ page: label, type: "pageerror", text: String(err.message || err).slice(0, 300) }));
  };

  // Every https://x.com/** document gets the fake page; sub-resources (favicon etc.) get an empty 204.
  await context.route("https://x.com/**", (route) => {
    if (route.request().resourceType() === "document") {
      return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fixtureHtml });
    }
    return route.fulfill({ status: 204, body: "" });
  });

  // 4. Options page ---------------------------------------------------------
  const opts = context.pages()[0] ?? (await context.newPage());
  attachConsole(opts, "options");
  await step(
    "00",
    "options page: backend URL + demo mode through the real form, Test connection reports mock",
    async (entry) => {
      await opts.goto(`chrome-extension://${extId}/options.html`);
      const urlInput = opts.locator("#backend-url");
      await urlInput.waitFor({ timeout: T.medium });
      await urlInput.fill(BACKEND_URL);
      await urlInput.press("Enter");

      const demoSwitch = opts.getByRole("switch", { name: "Demo mode" });
      await demoSwitch.waitFor({ timeout: T.short });
      if ((await demoSwitch.getAttribute("aria-checked")) !== "true") await demoSwitch.click();
      await waitUntil(async () => (await demoSwitch.getAttribute("aria-checked")) === "true", { message: "Demo mode switch on", timeout: T.short });

      // The settings the service worker will actually use.
      const stored = await waitUntil(
        async () => {
          const all = await worker.evaluate(() => chrome.storage.local.get("kavannah:settings"));
          const s = all && all["kavannah:settings"];
          return s && s.backendUrl === BACKEND_URL && s.mockMode === true ? s : null;
        },
        { message: `stored settings backendUrl=${BACKEND_URL} mockMode=true`, timeout: T.short },
      );

      await opts.getByRole("button", { name: "Test connection" }).click();
      const connected = opts.getByRole("alert").filter({ hasText: "Connected." });
      await connected.waitFor({ timeout: T.medium });
      const alertText = (await connected.innerText()).replace(/\s+/g, " ");
      assert.match(alertText, /Mode: mock/, `options page health alert: ${alertText}`);

      const direct = (await fetchJson(`${BACKEND_URL}/api/health`)).json;
      assert.equal(direct.mode, "mock");
      await snap(opts, "00-options.png", entry, { fullPage: true });
      return { stored, optionsAlert: alertText, directHealth: direct };
    },
    { critical: true, page: opts },
  );
  await opts.close();

  // 5. The fake X page ------------------------------------------------------
  const page = await context.newPage();
  attachConsole(page, "x.com");
  const articleById = (id) => page.locator('article[data-testid="tweet"]').filter({ has: page.locator(`a[href$="/status/${id}"]:has(time)`) });
  const hero = articleById(HERO_ID);
  const benign = articleById(BENIGN_ID);
  const quoting = articleById(QUOTE_ID);
  const kButton = (article) => article.getByRole("button", { name: "Analyze with Kavannah" });
  const dialog = page.getByRole("dialog", { name: "Kavannah" });
  const panelState = () => page.evaluate(`(${PANEL_STATE_IN_PAGE})()`);
  const isPanelOpen = async () => {
    const s = await panelState();
    if (process.env.KAVANNAH_E2E_DEBUG) log("panel state", JSON.stringify(s));
    return Boolean(s && s.ariaHidden !== "true" && !s.inert && s.visibility === "visible");
  };
  const isPanelHidden = async () => {
    const s = await panelState();
    return Boolean(s && s.ariaHidden === "true" && s.inert && s.visibility === "hidden");
  };
  const openPanelFor = async (article, resultHeading) => {
    await kButton(article).click();
    await waitUntil(isPanelOpen, { message: "panel open", timeout: T.short });
    await dialog.getByRole("heading", { name: resultHeading }).waitFor({ timeout: T.analysis });
  };
  const previewRegion = dialog.getByRole("region", { name: "Post being analyzed" });
  // The three decisions are collapsed sections; the header button's name starts with "Disinfo:", "Engage:" or "Note:".
  const sectionHeader = (label) => dialog.getByRole("button", { name: new RegExp(`^${label}: `) });
  const openSection = async (label) => {
    const header = sectionHeader(label);
    await header.waitFor({ timeout: T.analysis });
    if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
    await waitUntil(async () => (await header.getAttribute("aria-expanded")) === "true", { message: `${label} section open`, timeout: T.short });
  };

  await step(
    "01",
    "K buttons injected on every post (and never inside a quoted post)",
    async (entry) => {
      await page.goto(HERO_URL);
      await waitUntil(async () => (await page.locator(".kavannah-k-btn").count()) >= 3, { message: ">= 3 K buttons", timeout: T.analysis });
      await sleep(300); // let the debounced observer finish its first pass
      const articles = await page.locator('article[data-testid="tweet"]').count();
      const buttons = await page.locator(".kavannah-k-btn").count();
      const named = await page.getByRole("button", { name: "Analyze with Kavannah" }).count();
      assert.ok(buttons >= 3, `expected >= 3 K buttons, got ${buttons}`);
      assert.equal(buttons, articles, "one K button per article");
      assert.equal(named, buttons, "every K button has the accessible name");
      assert.equal(await page.locator('div[role="link"] .kavannah-k-btn').count(), 0, "no K button inside a quoted post");
      const lastInEveryBar = await page.evaluate(() =>
        Array.from(document.querySelectorAll('article[data-testid="tweet"]')).every((article) => {
          const bar = Array.from(article.querySelectorAll('div[role="group"]')).find((g) => g.querySelector('[data-testid="reply"]'));
          return Boolean(bar && bar.lastElementChild && bar.lastElementChild.classList.contains("kavannah-k-wrap"));
        }),
      );
      assert.equal(lastInEveryBar, true, "K is the last item of every action bar");
      const styleTag = await page.locator("style#kavannah-k-style").count();
      assert.equal(styleTag, 1, "K button stylesheet injected once");
      const kBox = await kButton(hero).boundingBox();
      await kButton(hero).hover();
      await sleep(150);
      await snap(page, "01-k-buttons.png", entry);
      return { articles, kButtons: buttons, heroKButtonBox: kBox && { w: Math.round(kBox.width), h: Math.round(kBox.height) } };
    },
    { critical: true, page },
  );

  await step(
    "01b",
    "fake page carries the fixture post texts verbatim (hero, benign, quoting post; quoted block is the hero text)",
    async () => {
      const texts = await page.evaluate(
        ([collectSrc, ids]) => {
          const collect = new Function(`return (${collectSrc})`)();
          const out = {};
          for (const id of ids) {
            const article = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).find((a) =>
              Array.from(a.querySelectorAll('a[href*="/status/"]')).some((l) => l.getAttribute("href").endsWith(`/status/${id}`) && l.querySelector("time")),
            );
            const quote = article?.querySelector('div[role="link"]');
            const textEl = Array.from(article?.querySelectorAll('[data-testid="tweetText"]') ?? []).find((el) => !(quote && quote.contains(el)));
            out[id] = { main: textEl ? collect(textEl) : null, quoted: quote ? collect(quote.querySelector('[data-testid="tweetText"]')) : null };
          }
          return out;
        },
        [COLLECT_TEXT_IN_PAGE, [HERO_ID, BENIGN_ID, QUOTE_ID]],
      );
      assert.equal(texts[HERO_ID].main, fixtureById.get(HERO_FIXTURE).post.text, "hero text differs from the fixture");
      assert.equal(texts[BENIGN_ID].main, fixtureById.get(BENIGN_FIXTURE).post.text, "benign text differs from the fixture");
      assert.equal(texts[QUOTE_ID].main, fixtureById.get(QUOTE_FIXTURE).post.text, "quoting post text differs from the fixture");
      assert.equal(texts[QUOTE_ID].quoted, fixtureById.get(HERO_FIXTURE).post.text, "quoted block should repeat the hero text");
      return { checked: Object.keys(texts).length };
    },
    { page },
  );

  await step(
    "02",
    "click K on the hero post: loading state, then the three collapsed verdicts render with the score always visible (Demo chip)",
    async (entry) => {
      const clickedAt = Date.now();
      await kButton(hero).click();
      await waitUntil(isPanelOpen, { message: "panel open", timeout: T.short });

      // Loading state (mock answers in 0.3-0.8 s; best effort).
      let loading = { caught: false };
      try {
        const status = dialog.getByRole("status").filter({ hasText: /Analyzing|Starting analysis/ });
        await status.first().waitFor({ timeout: 1_500 });
        const text = (await status.first().innerText()).replace(/\s+/g, " ").trim();
        await snap(page, "02-loading.png", entry);
        loading = { caught: true, text: text.slice(0, 160), stillLoadingAfterScreenshot: (await status.count()) > 0 };
        if (/Live analysis takes/.test(text)) {
          observe("Loading state in the in-page drawer says \"Live analysis takes about 30-60 seconds.\" even though demo mode is on (the popup's demo picker shows the demo wording instead).");
        }
      } catch {
        loading = { caught: false, note: "result arrived before the loading state could be observed" };
      }

      await dialog.getByRole("heading", { name: "Disinfo: Likely misleading" }).waitFor({ timeout: T.analysis });
      const renderedAfterMs = Date.now() - clickedAt;

      // All three verdicts are readable without expanding anything.
      await dialog.getByRole("heading", { name: "Engage: No" }).waitFor({ timeout: T.short });
      await dialog.getByRole("heading", { name: "Note: Recommended" }).waitFor({ timeout: T.short });
      await dialog.getByText("Demo", { exact: true }).waitFor({ timeout: T.short });
      await dialog.getByText(`Demo fixture: ${HERO_FIXTURE}`).waitFor({ timeout: T.short });
      for (const label of ["Disinfo", "Engage", "Note"]) {
        assert.equal(await sectionHeader(label).getAttribute("aria-expanded"), "false", `${label} section starts collapsed`);
      }
      assert.equal(await dialog.getByRole("textbox").count(), 0, "no draft is visible while the sections are collapsed");

      // The score stays visible while the Disinfo section is collapsed.
      const meter = dialog.getByRole("meter", { name: "Disinformation score" });
      await meter.waitFor({ timeout: T.short });
      assert.equal(await meter.isVisible(), true, "score scale is visible while collapsed");
      assert.equal(await meter.getAttribute("aria-valuenow"), "90", "hero score is 90");
      await dialog.getByText("AI confidence:", { exact: true }).waitFor({ timeout: T.short });
      await snap(dialog, "03a-panel-collapsed.png", entry);

      // The section labels are rendered uppercase (CSS text-transform).
      const engageLabel = dialog.getByText(/^engage$/i);
      const rendered = await engageLabel.evaluate((el) => ({ innerText: el.innerText, transform: getComputedStyle(el).textTransform }));
      assert.equal(rendered.innerText, "ENGAGE");
      assert.equal(rendered.transform, "uppercase");

      // Details live inside the Disinfo section; the score is still there once it is open.
      await openSection("Disinfo");
      await dialog.getByRole("heading", { name: "False claim in an antisemitic conspiracy frame" }).waitFor({ timeout: T.short });
      assert.equal(await meter.isVisible(), true, "score scale is visible while expanded");
      await dialog.getByText("Key sources", { exact: true }).waitFor({ timeout: T.short });
      await dialog.getByText("Demo output from a built-in fixture, not a live analysis.").waitFor({ timeout: T.short });

      const preview = (await previewRegion.innerText()).replace(/\s+/g, " ");
      assert.match(preview, /Awake Finance/);
      assert.match(preview, /@awake_finance_x/);
      assert.match(preview, /The Rothschild family owns the Federal Reserve/);

      const state = await panelState();
      assert.equal(state.position, "fixed", "drawer is a fixed overlay");
      assert.equal(state.width, "420px", "drawer is 420px wide");
      assert.equal(state.theme, "dark", "drawer follows the dark host page");
      assert.notEqual(state.background, "rgba(0, 0, 0, 0)", "drawer has an opaque background (styles loaded in the shadow root)");
      const audit = await page.evaluate(`(${LAYOUT_AUDIT_IN_PAGE})()`);
      if (audit && audit.horizontalOverflowPx > 0) observe(`Drawer body scrolls horizontally by ${audit.horizontalOverflowPx}px in the result state.`);
      if (audit && audit.offenders.length > 0) observe(`Elements poke outside the drawer in the result state: ${JSON.stringify(audit.offenders.slice(0, 3))}`);

      await snap(dialog, "03-panel-result.png", entry);
      await snap(page, "03b-page.png", entry, { fullPage: true });
      return { loading, renderedAfterMs, panel: state, layout: audit };
    },
    { critical: true, page },
  );

  await step(
    "03",
    "View evidence: claims with verdicts, sources whose publisher/title is the link",
    async (entry) => {
      await openSection("Disinfo");
      const toggle = dialog.getByRole("button", { name: /View evidence/ });
      const toggleText = (await toggle.innerText()).replace(/\s+/g, " ").trim();
      assert.match(toggleText, /\(2 claims\)/, `evidence toggle text: ${toggleText}`);
      await toggle.click();
      await dialog.getByRole("button", { name: /Hide evidence/ }).waitFor({ timeout: T.short });

      const sourceLinks = dialog.getByRole("link", { name: /opens in a new tab/ });
      await waitUntil(async () => (await sourceLinks.count()) >= 2, { message: ">= 2 inline source links", timeout: T.short });
      assert.equal(await dialog.getByText("Open source").count(), 0, "no separate 'Open source' button");
      const heroLinkText = (await dialog.locator(`a[href="${HERO_SOURCE_URL}"]`).first().innerText()).replace(/\s+/g, " ");
      assert.match(heroLinkText, /federalreserve\.gov Who owns the Federal Reserve\?/, `the link text is the publisher and title: ${heroLinkText}`);
      const hrefs = await sourceLinks.evaluateAll((links) => links.map((a) => ({ href: a.href, target: a.target, rel: a.rel })));
      assert.ok(hrefs.some((l) => l.href === HERO_SOURCE_URL), `expected ${HERO_SOURCE_URL} among ${JSON.stringify(hrefs)}`);
      assert.ok(hrefs.every((l) => l.href.startsWith("http") && l.target === "_blank" && /noopener/.test(l.rel)), "source links open safely in a new tab");

      await dialog.getByText("federalreserve.gov", { exact: true }).first().waitFor({ timeout: T.short });
      await dialog.getByText("ajc.org", { exact: true }).first().waitFor({ timeout: T.short });
      await dialog.getByText("Who owns the Federal Reserve? - Board of Governors of the Federal Reserve System").first().waitFor({ timeout: T.short });
      const verdicts = await dialog.getByText("Contradicted", { exact: true }).count();
      assert.equal(verdicts, 2, "both hero claims are contradicted");
      await dialog.getByText("The Rothschild family owns the Federal Reserve.", { exact: true }).waitFor({ timeout: T.short });
      const unverified = await dialog.getByText("Unverified link").count();

      await sourceLinks.first().scrollIntoViewIfNeeded();
      await sleep(150);
      await snap(dialog, "04-evidence.png", entry);
      return { toggleText, sources: hrefs.map((l) => l.href), unverifiedBadges: unverified };
    },
    { page },
  );

  let noteDraftText = null;
  await step(
    "04",
    "Open the Note section: the recommended draft appears with a source URL, edit it, Copy puts the edited text on the clipboard",
    async (entry) => {
      // The note is recommended, so opening its section generates the draft without a further click.
      await openSection("Note");
      const box = dialog.getByRole("textbox", { name: "Community Note draft" });
      await box.waitFor({ timeout: T.analysis });
      const generated = await waitUntil(async () => ((await box.inputValue()).trim() ? box.inputValue() : null), { message: "non-empty Community Note draft", timeout: T.analysis });
      assert.match(generated, /https?:\/\/\S+/, "draft contains a URL");
      assert.ok(generated.includes(HERO_SOURCE_URL), `draft cites ${HERO_SOURCE_URL}`);
      await dialog.getByText("Sources used", { exact: true }).waitFor({ timeout: T.short });
      const resetBtn = dialog.getByRole("button", { name: "Reset to generated" });
      assert.equal(await resetBtn.isDisabled(), true, "Reset is disabled before editing");

      const edited = `${generated} (edited)`;
      await box.fill(edited);
      await waitUntil(async () => (await box.inputValue()) === edited, { message: "edited draft kept by React state", timeout: T.short });
      assert.equal(await resetBtn.isEnabled(), true, "Reset is enabled after editing");

      await page.bringToFront();
      const copy = dialog.getByRole("button", { name: "Copy", exact: true });
      await copy.click();
      await dialog.getByRole("button", { name: "Copied", exact: true }).waitFor({ timeout: T.short });
      const clipboard = await waitUntil(
        async () => {
          const text = await page.evaluate(() => navigator.clipboard.readText());
          return text === edited ? text : null;
        },
        { message: "clipboard equals the edited draft", timeout: T.short },
      );
      assert.equal(clipboard, edited);
      noteDraftText = edited;

      const textareaBox = await box.boundingBox();
      await box.scrollIntoViewIfNeeded();
      await sleep(150);
      await snap(dialog, "05-note-draft.png", entry);
      const audit = await page.evaluate(`(${LAYOUT_AUDIT_IN_PAGE})()`);
      if (audit && audit.horizontalOverflowPx > 0) observe(`Drawer body scrolls horizontally by ${audit.horizontalOverflowPx}px with the Community Note draft open.`);
      if (audit && audit.offenders.length > 0) observe(`Elements poke outside the drawer with the note draft open: ${JSON.stringify(audit.offenders.slice(0, 3))}`);
      return { generatedChars: Array.from(generated).length, textareaHeightPx: textareaBox && Math.round(textareaBox.height), copied: true, layout: audit };
    },
    { page },
  );

  await step(
    "05",
    "Request a Community Note: X's request form opens with the edited note draft in it; nothing is sent unless the auto-send setting is on",
    async (entry) => {
      await openSection("Note");
      const request = dialog.getByRole("button", { name: "Request a Community Note" });
      await request.scrollIntoViewIfNeeded();
      const urlBefore = page.url();
      await request.click();

      // Kavannah chooses X's "Request Community Note" item and fills the form's explanation.
      const form = page.locator('[role="dialog"].x-note-request');
      await form.waitFor({ timeout: T.short });
      const explanation = form.locator('textarea[name="NoteRequestExplanationFormTextInput"]');
      await waitUntil(async () => (await explanation.inputValue()) === noteDraftText, { message: "X's explanation field holds the edited note draft", timeout: T.short });
      const heroUrlRe = new RegExp(`^https://x\\.com/[^/]+/status/${HERO_ID}$`);
      assert.match(await form.locator('input[name="NoteRequestFormTextInput"]').inputValue(), heroUrlRe, "the 'Link to an X post' field holds the post's URL");
      assert.equal(await page.locator("#kavannah-form-hint").count(), 0, "no 'writing…' marker when the draft already exists");
      const feedback = dialog.getByRole("alert").filter({ hasText: /Opened X's request form and filled in the explanation/ });
      await feedback.waitFor({ timeout: T.short });
      assert.match(await feedback.innerText(), /Kavannah did not send anything/);

      // Only that one item was chosen, nothing was sent and nothing navigated.
      await sleep(400); // give any accidental click/navigation a chance to show up
      const fake = await page.evaluate(() => ({ opens: window.__xFake.opens, itemClicks: window.__xFake.itemClicks, navigations: window.__xFake.navigations, requests: window.__xFake.requests }));
      assert.deepEqual(fake.itemClicks, ["Request Community Note"], "only X's Request Community Note item was chosen");
      assert.equal(fake.requests.length, 0, "the request was not sent");
      assert.equal(fake.navigations.length, 0, "no link was followed");
      assert.equal(page.url(), urlBefore, "no navigation");
      assert.equal(await form.count(), 1, "X's form stays open for the user to review");
      await snap(page, "06-request-note.png", entry);

      await page.keyboard.press("Escape");
      await waitUntil(async () => (await form.count()) === 0, { message: "form closed after Escape", timeout: T.short });
      await sleep(350);
      const reopen = async () => {
        if (await isPanelOpen()) return;
        await openPanelFor(hero, "Engage: No");
        assert.ok(await dialog.getByRole("textbox", { name: "Community Note draft" }).count(), "note draft still there after reopening");
      };
      const panelOpenAfterEscape = await isPanelOpen();
      if (!panelOpenAfterEscape) observe("Escape pressed while X's request form is open closes the form AND the Kavannah drawer at once (the drawer closes on Esc from anywhere on the page); the drawer has to be reopened with K, its analysis and drafts are kept.");
      await reopen();

      // With "Send Community Note requests automatically" on, X's button is pressed too.
      const settings = await context.newPage();
      attachConsole(settings, "options");
      await settings.goto(`chrome-extension://${extId}/options.html`);
      const autoSend = settings.getByRole("switch", { name: "Send Community Note requests automatically" });
      await autoSend.waitFor({ timeout: T.medium });
      assert.equal(await autoSend.getAttribute("aria-checked"), "false", "auto-send is off by default");
      await autoSend.click();
      await waitUntil(async () => (await autoSend.getAttribute("aria-checked")) === "true", { message: "auto-send switch on", timeout: T.short });
      await snap(settings, "06b-auto-send-setting.png", entry, { fullPage: true });

      await page.bringToFront();
      await openSection("Note");
      await request.scrollIntoViewIfNeeded();
      await request.click();
      const sent = dialog.getByRole("alert").filter({ hasText: /Sent your request to X/ });
      await sent.waitFor({ timeout: T.medium });
      const requests = await page.evaluate(() => window.__xFake.requests);
      assert.equal(requests.length, 1, "exactly one request was sent");
      assert.equal(requests[0].explanation, noteDraftText, "the request carries the edited draft");
      assert.match(requests[0].source, heroUrlRe, "the request carries the post's URL");
      assert.equal(await form.count(), 0, "X closed the form after the request");

      await settings.bringToFront();
      await autoSend.click();
      await waitUntil(async () => (await autoSend.getAttribute("aria-checked")) === "false", { message: "auto-send switch off again", timeout: T.short });
      await settings.close();
      await page.bringToFront();
      return { menuOpens: fake.opens, panelOpenAfterEscape, autoSentRequests: requests.length };
    },
    { page },
  );

  await step(
    "06",
    "Prepare reply: reply draft with a character count and no 280 limit",
    async (entry) => {
      if (!(await isPanelOpen())) await openPanelFor(hero, "Engage: No");
      await openSection("Engage");
      // "Don't engage" here, so the reply stays on demand.
      const prepare = dialog.getByRole("button", { name: "Prepare reply" });
      await prepare.scrollIntoViewIfNeeded();
      await prepare.click();
      const box = dialog.getByRole("textbox", { name: "Reply draft" });
      await box.waitFor({ timeout: T.analysis });
      const text = await waitUntil(async () => ((await box.inputValue()).trim() ? box.inputValue() : null), { message: "non-empty reply draft", timeout: T.analysis });
      const counter = dialog.getByText(/^\d+ characters?$/);
      await counter.waitFor({ timeout: T.short });
      const counterText = (await counter.innerText()).replace(/\s+/g, " ").trim();
      const count = Number(counterText.match(/^(\d+)/)[1]);
      assert.equal(count, Array.from(text).length, "counter matches the draft length");
      assert.equal(await dialog.getByText(/\/ 280/).count(), 0, "no 280-character limit is shown");
      // A long reply is accepted as is: no limit, no error state.
      const longReply = `${text} ${"More context. ".repeat(30)}`.trim();
      await box.fill(longReply);
      await waitUntil(async () => (await counter.innerText()).startsWith(String(Array.from(longReply).length)), { message: "counter follows a long reply", timeout: T.short });
      assert.equal(await box.getAttribute("aria-invalid"), null, "a reply over 280 characters is not flagged");
      await box.fill(text);
      await box.scrollIntoViewIfNeeded();
      await sleep(150);
      await snap(dialog, "07-reply-draft.png", entry);
      return { counter: counterText, replyChars: count, noteDraftStillOpen: (await dialog.getByRole("textbox", { name: "Community Note draft" }).count()) > 0 };
    },
    { page },
  );

  await step(
    "07",
    "Close the panel with × and with Esc; K on the benign post gives 'Engage: No' and 'Note: Not recommended'",
    async (entry) => {
      if (!(await isPanelOpen())) await openPanelFor(hero, "Engage: No");
      await dialog.getByRole("button", { name: "Close Kavannah panel" }).click();
      await waitUntil(isPanelHidden, { message: "panel hidden after ×", timeout: T.short });

      await openPanelFor(hero, "Engage: No"); // result comes back instantly (kept in memory)
      await page.keyboard.press("Escape");
      await waitUntil(isPanelHidden, { message: "panel hidden after Esc", timeout: T.short });

      await benign.scrollIntoViewIfNeeded();
      await openPanelFor(benign, "Note: Not recommended");
      await dialog.getByRole("heading", { name: "Engage: No" }).waitFor({ timeout: T.short });
      for (const label of ["Disinfo", "Engage", "Note"]) {
        assert.equal(await sectionHeader(label).getAttribute("aria-expanded"), "false", `${label} section is collapsed again for a new post`);
      }
      assert.equal(await dialog.getByRole("meter", { name: "Disinformation score" }).getAttribute("aria-valuenow"), "2", "benign score is 2 (visible while collapsed)");
      for (const label of ["Disinfo", "Engage", "Note"]) await openSection(label);
      await dialog.getByRole("heading", { name: "No clear factual issue identified" }).waitFor({ timeout: T.short });
      await dialog.getByText(`Demo fixture: ${BENIGN_FIXTURE}`).waitFor({ timeout: T.short });
      assert.equal(await dialog.getByRole("meter", { name: "Disinformation score" }).getAttribute("aria-valuenow"), "2", "benign score is 2");
      const preview = (await previewRegion.innerText()).replace(/\s+/g, " ");
      assert.match(preview, /Civic Notes/);
      assert.match(preview, /@civic_notes_eu/);
      // Both cards read as not recommended, with the outline (not primary) buttons.
      const engageDesc = await dialog.getByText("A public response may not add useful context or may unnecessarily amplify the content.").count();
      const noteDesc = await dialog.getByText("There is no clear factual claim that would benefit from a note.").count();
      assert.equal(engageDesc, 1);
      assert.equal(noteDesc, 1);
      await snap(dialog, "08-benign.png", entry);

      // No note draft exists for this post: "Request a Community Note" opens X's form at once and
      // the explanation is written while it is open (a "writing…" marker shows meanwhile).
      assert.equal(await dialog.getByRole("textbox", { name: "Community Note draft" }).count(), 0, "no note draft yet on the benign post");
      const request = dialog.getByRole("button", { name: "Request a Community Note" });
      await request.scrollIntoViewIfNeeded();
      await request.click();
      const form = page.locator('[role="dialog"].x-note-request');
      await form.waitFor({ timeout: T.short });
      const explanation = form.locator('textarea[name="NoteRequestExplanationFormTextInput"]');
      let marker = { caught: false };
      try {
        const hint = page.locator("#kavannah-form-hint");
        await hint.waitFor({ timeout: 1_000 });
        marker = { caught: true, text: (await hint.innerText()).trim(), explanationWhileWriting: await explanation.inputValue() };
        assert.equal(marker.text, "Kavannah is writing the explanation…");
        assert.equal(marker.explanationWhileWriting, "", "the explanation is empty while the draft is being written");
        await snap(page, "08a-request-writing.png", entry);
      } catch (err) {
        if (err && err.name === "AssertionError") throw err;
        marker = { caught: false, note: "the draft arrived before the marker could be observed" };
      }
      const written = await waitUntil(async () => ((await explanation.inputValue()).trim() ? explanation.inputValue() : null), { message: "explanation filled once the draft is written", timeout: T.analysis });
      assert.equal(await page.locator("#kavannah-form-hint").count(), 0, "marker removed once the explanation is filled");
      assert.match(await form.locator('input[name="NoteRequestFormTextInput"]').inputValue(), new RegExp(`/status/${BENIGN_ID}$`), "the link field holds the benign post's URL");
      assert.equal((await page.evaluate(() => window.__xFake.requests)).length, 1, "nothing new was sent (only the earlier auto-send request)");
      await snap(page, "08c-request-filled.png", entry);
      await page.keyboard.press("Escape");
      await waitUntil(async () => (await form.count()) === 0, { message: "form closed after Escape", timeout: T.short });
      return { engage: "Engage: No", communityNote: "Note: Not recommended", marker, explanationChars: written.length };
    },
    { page },
  );

  await step(
    "07b",
    "K on the quoting post analyzes the main text, not the quoted post",
    async (entry) => {
      await page.keyboard.press("Escape");
      await waitUntil(isPanelHidden, { message: "panel hidden", timeout: T.short });
      await quoting.scrollIntoViewIfNeeded();
      await kButton(quoting).click();
      await waitUntil(isPanelOpen, { message: "panel open", timeout: T.short });
      await waitUntil(async () => /Just saw a post claiming/.test(await previewRegion.innerText()), { message: "preview shows the quoting post", timeout: T.short });
      const preview = (await previewRegion.innerText()).replace(/\s+/g, " ");
      assert.doesNotMatch(preview, /Rothschild family owns/, "quoted text must not leak into the analyzed post");
      assert.match(preview, /M\. K\., history teacher/);
      assert.match(preview, /@history_teacher_mk/);
      await dialog.getByText(`Demo fixture: ${QUOTE_FIXTURE}`).waitFor({ timeout: T.analysis });
      await dialog.getByRole("heading", { name: "Note: Not recommended" }).waitFor({ timeout: T.short });
      await snap(dialog, "08b-quote-post.png", entry);
      return { fixture: QUOTE_FIXTURE };
    },
    { page },
  );

  // 6. Popup ----------------------------------------------------------------
  await step(
    "08",
    "popup with no X tab targeted: demo picker, hero fixture renders the analysis",
    async (entry) => {
      const popup = await context.newPage();
      attachConsole(popup, "popup");
      await popup.setViewportSize({ width: 400, height: 600 });
      await popup.goto(`chrome-extension://${extId}/popup.html`);
      await popup.getByText(/pick a demo post/).waitFor({ timeout: T.medium });
      const list = popup.getByRole("list", { name: "Demo posts" });
      const demoPosts = await waitUntil(async () => {
        const n = await list.getByRole("listitem").count();
        return n >= fixtures.length ? n : null;
      }, { message: `${fixtures.length} demo posts listed`, timeout: T.medium });
      await snap(popup, "09a-popup-picker.png", entry);
      await popup.getByRole("button", { name: /Viral conspiracy post/ }).click();
      await popup.getByRole("heading", { name: "Note: Recommended" }).waitFor({ timeout: T.analysis });
      await popup.getByRole("heading", { name: "Engage: No" }).waitFor({ timeout: T.short });
      await popup.getByText("Demo", { exact: true }).waitFor({ timeout: T.short });
      await popup.getByRole("button", { name: /All demo posts/ }).waitFor({ timeout: T.short });
      const overflow = await popup.evaluate(() => ({ docScrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
      if (overflow.docScrollWidth > overflow.innerWidth) observe(`Popup document is wider than the 400px popup (scrollWidth ${overflow.docScrollWidth}).`);
      await snap(popup, "09-popup.png", entry);
      await popup.emulateMedia({ colorScheme: "dark" });
      await sleep(150);
      await snap(popup, "09b-popup-dark.png", entry);
      await popup.close();
      return { demoPosts, overflow };
    },
    { page },
  );

  // 7. Dark mode + light host ------------------------------------------------
  await step(
    "09",
    "dark mode: emulate prefers-color-scheme dark with the panel open; also the drawer on a light X page",
    async (entry) => {
      await page.bringToFront();
      if (!(await isPanelOpen())) await openPanelFor(hero, "Engage: No");
      else {
        await page.keyboard.press("Escape");
        await waitUntil(isPanelHidden, { message: "panel hidden", timeout: T.short });
        await hero.scrollIntoViewIfNeeded();
        await openPanelFor(hero, "Engage: No");
      }
      await page.emulateMedia({ colorScheme: "dark" });
      await sleep(200);
      const dark = await panelState();
      assert.equal(dark.theme, "dark");
      assert.equal(dark.background, "rgb(9, 9, 11)", `dark drawer background: ${dark.background}`);
      await snap(page, "10-dark.png", entry);

      // The drawer follows the host page's background: switch the fake X page to its light theme.
      await page.emulateMedia({ colorScheme: "light" });
      await page.keyboard.press("Escape");
      await waitUntil(isPanelHidden, { message: "panel hidden", timeout: T.short });
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      await openPanelFor(hero, "Engage: No");
      const light = await panelState();
      assert.equal(light.theme, "light", "drawer detects the light host page");
      assert.equal(light.background, "rgb(244, 244, 246)", `light drawer background: ${light.background}`);
      await snap(page, "10b-light-host.png", entry);
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      return { dark: { theme: dark.theme, background: dark.background, color: dark.color }, light: { theme: light.theme, background: light.background, color: light.color } };
    },
    { page },
  );

  // 8. Contrast ----------------------------------------------------------------
  await step(
    "10",
    "contrast: every visible text meets WCAG AA (4.5:1, large text 3:1) in light and dark: all 10 demo analyses, the settings page, the drawer on dark and light X",
    async (entry) => {
      const audits = [];
      const failures = [];
      const record = (where, scheme, result) => {
        if (result.error) throw new Error(`${where} (${scheme}): ${result.error}`);
        audits.push({ where, scheme, checked: result.checked, failures: result.failures.length, minRatio: result.minRatio });
        for (const failure of result.failures) failures.push({ where, scheme, ...failure });
      };
      const audit = (target, pg) => pg.evaluate(`(${CONTRAST_AUDIT_IN_PAGE})(${JSON.stringify(target)})`);
      const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (m) => `\\${m}`);
      // Contrast is judged on the settled page: with reduced motion the panel's fade-ins are off,
      // so no text is measured half-transparent in the middle of an animation.
      const reducedMotion = "reduce";

      // Popup: every demo analysis, fully expanded, in both colour schemes.
      const popup = await context.newPage();
      attachConsole(popup, "popup");
      await popup.setViewportSize({ width: 400, height: 600 });
      for (const scheme of ["light", "dark"]) {
        await popup.emulateMedia({ colorScheme: scheme, reducedMotion });
        await popup.goto(`chrome-extension://${extId}/popup.html`);
        await popup.getByRole("list", { name: "Demo posts" }).getByRole("listitem").first().waitFor({ timeout: T.medium });
        record("popup: demo picker", scheme, await audit("document", popup));
        for (const fixture of fixtures) {
          await popup.getByRole("button", { name: new RegExp(`^${escapeRe(fixture.title)}`) }).click();
          await popup.getByRole("heading", { name: /^Disinfo: / }).waitFor({ timeout: T.analysis });
          await expandAll(popup.locator(".kavannah-root").first());
          record(`popup: ${fixture.id}`, scheme, await audit("document", popup));
          if (fixture.id === HERO_FIXTURE) await snap(popup, `11-contrast-${scheme}.png`, entry, { fullPage: true });
          await popup.getByRole("button", { name: /All demo posts/ }).click();
          await popup.getByRole("list", { name: "Demo posts" }).waitFor({ timeout: T.medium });
        }
      }
      await popup.close();

      // Settings page, with the connection-test result showing.
      const settingsPage = await context.newPage();
      attachConsole(settingsPage, "options");
      for (const scheme of ["light", "dark"]) {
        await settingsPage.emulateMedia({ colorScheme: scheme, reducedMotion });
        await settingsPage.goto(`chrome-extension://${extId}/options.html`);
        await settingsPage.getByRole("button", { name: "Test connection" }).click();
        await settingsPage.getByText(/Connected\./).waitFor({ timeout: T.medium });
        record("settings page", scheme, await audit("document", settingsPage));
      }
      await settingsPage.close();

      // The in-page drawer follows X's theme through data-theme: check it on a dark and a light X page.
      await page.bringToFront();
      await page.emulateMedia({ reducedMotion });
      for (const hostTheme of ["dark", "light"]) {
        if (await isPanelOpen()) {
          await page.keyboard.press("Escape");
          await waitUntil(isPanelHidden, { message: "panel hidden", timeout: T.short });
        }
        await page.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), hostTheme);
        await hero.scrollIntoViewIfNeeded();
        await openPanelFor(hero, "Engage: No");
        await expandAll(dialog);
        record(`drawer on ${hostTheme} X`, (await panelState()).theme, await audit("drawer", page));
      }
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      await page.emulateMedia({ reducedMotion: null });

      const checked = audits.reduce((sum, a) => sum + a.checked, 0);
      const minRatio = Math.min(...audits.map((a) => a.minRatio ?? Infinity));
      // One line per distinct offending style, so the report stays readable.
      const distinct = [];
      const keys = new Set();
      for (const f of failures) {
        const key = `${f.fg}|${f.bg}|${f.px}|${f.weight}`;
        if (keys.has(key)) continue;
        keys.add(key);
        distinct.push(f);
      }
      const summary = { views: audits.length, textsChecked: checked, failures: failures.length, distinctFailingStyles: distinct.length, minRatio: Math.round(minRatio * 100) / 100 };
      log(`contrast: ${JSON.stringify(summary)}`);
      for (const f of distinct.slice(0, 40)) log(`  ${f.ratio}:1 (need ${f.need}) ${f.fg} on ${f.bg} ${f.px}px/${f.weight} [${f.scheme}, ${f.where}] "${f.text}"`);
      entry.details = { summary, audits, distinctFailures: distinct };
      assert.equal(failures.length, 0, `${failures.length} text elements (${distinct.length} distinct styles) are below WCAG AA contrast`);
      return entry.details;
    },
    { page },
  );
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const t0 = Date.now();
let fatal = null;
try {
  await main();
} catch (err) {
  fatal = err;
  console.error("[e2e] fatal:", err && err.stack ? err.stack : err);
} finally {
  await cleanup();
}

report.finishedAt = new Date().toISOString();
report.durationMs = Date.now() - t0;
if (fatal) report.fatal = String(fatal && fatal.stack ? fatal.stack : fatal).split("\n").slice(0, 8).join("\n");
fs.mkdirSync(ARTIFACTS, { recursive: true });
fs.writeFileSync(path.join(ARTIFACTS, "report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(ARTIFACTS, "server.log"), backendLog.join("\n") + "\n");

const passed = report.steps.filter((s) => s.status === "pass").length;
const failed = report.steps.filter((s) => s.status === "fail").length;
const skipped = report.steps.filter((s) => s.status === "skip").length;
console.log("\n[e2e] summary");
for (const s of report.steps) {
  const mark = s.status === "pass" ? "PASS" : s.status === "fail" ? "FAIL" : "SKIP";
  console.log(`  ${mark}  ${s.id.padEnd(3)} ${s.name} (${s.ms} ms)${s.screenshots.length ? `  [${s.screenshots.join(", ")}]` : ""}`);
  if (s.error) console.log(`        ${s.error.split("\n")[0]}`);
}
if (report.observations.length) {
  console.log("[e2e] observations");
  for (const o of report.observations) console.log(`  - ${o}`);
}
if (report.browserConsole.length) {
  console.log(`[e2e] browser console (${report.browserConsole.length} warning/error entries, see report.json)`);
  for (const c of report.browserConsole.slice(0, 5)) console.log(`  ${c.page} ${c.type}: ${c.text}`);
}
console.log(`[e2e] ${passed} passed, ${failed} failed, ${skipped} skipped in ${(report.durationMs / 1000).toFixed(1)} s -> ${path.relative(ROOT, ARTIFACTS)}/report.json`);
process.exit(failed > 0 || fatal ? 1 : 0);
