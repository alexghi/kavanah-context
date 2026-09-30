#!/usr/bin/env node
/**
 * Regenerates docs/testers/img/*.png with real Chromium and the built extension.
 *
 *   npm run build                    # or the package:testers script, which bakes the server URL in
 *   node docs/testers/screenshots.mjs [--headed] [--mock]
 *
 * Uses the backend URL baked into the build and the first access key in .env (only the key's
 * NAME appears in a screenshot; the key itself is masked). Step 6 runs one real analysis
 * through that server unless --mock is given (then it needs a local mock server, see e2e/run.mjs).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXT_DIR = path.join(ROOT, "apps/extension/.output/chrome-mv3");
const OUT = path.join(ROOT, "docs/testers/img");
const FIXTURE_HTML = fs.readFileSync(path.join(ROOT, "e2e/fixtures/x-page.html"), "utf8");
const HERO_ID = "1000000000000000007";
const HERO_URL = `https://x.com/kavannah_demo/status/${HERO_ID}`;
const HEADED = process.argv.includes("--headed");
const MOCK = process.argv.includes("--mock");
const HIGHLIGHT = "3px solid #e11d48";

const log = (...args) => console.log("[screenshots]", ...args);

function firstAccessKey() {
  if (process.env.KAVANNAH_SCREENSHOT_KEY) return process.env.KAVANNAH_SCREENSHOT_KEY;
  const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const line = env.split(/\r?\n/).find((l) => l.startsWith("KAVANNAH_ACCESS_KEYS="));
  const first = line?.slice("KAVANNAH_ACCESS_KEYS=".length).split(/[,;]/)[0]?.trim() ?? "";
  const key = first.slice(first.indexOf(":") + 1).trim();
  if (!key) throw new Error("No access key in .env (npm run keys -- add <name>) and KAVANNAH_SCREENSHOT_KEY is unset.");
  return key;
}

const highlight = (locator) =>
  locator.evaluate((el, outline) => {
    el.style.outline = outline;
    el.style.outlineOffset = "4px";
    el.style.borderRadius = "8px";
  }, HIGHLIGHT);
const unhighlight = (locator) =>
  locator.evaluate((el) => {
    el.style.outline = "";
    el.style.outlineOffset = "";
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!fs.existsSync(path.join(EXT_DIR, "manifest.json"))) throw new Error(`Build the extension first: ${EXT_DIR} is missing`);
  fs.mkdirSync(OUT, { recursive: true });
  const key = firstAccessKey();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kavannah-shots-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: !HEADED,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
    viewport: { width: 1200, height: 800 },
    colorScheme: "light",
    deviceScaleFactor: 2,
  });
  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 20_000 });
    const extId = new URL(worker.url()).host;
    log("extension id", extId);
    const page = context.pages()[0] ?? (await context.newPage());

    // 1 + 2: chrome://extensions with Developer mode on, then Load unpacked.
    await page.goto("chrome://extensions");
    const devMode = page.locator("#devMode");
    await devMode.waitFor({ timeout: 10_000 });
    if (!(await devMode.evaluate((el) => el.checked))) await devMode.click();
    const loadUnpacked = page.locator("#loadUnpacked");
    await loadUnpacked.waitFor({ timeout: 10_000 });
    await sleep(400);
    await highlight(devMode);
    await page.screenshot({ path: path.join(OUT, "01-developer-mode.png") });
    await unhighlight(devMode);
    await highlight(loadUnpacked);
    await page.screenshot({ path: path.join(OUT, "02-load-unpacked.png") });
    log("01, 02 done");

    // 3: the popup with the gear.
    await page.setViewportSize({ width: 420, height: 560 });
    await page.goto(`chrome-extension://${extId}/popup.html`);
    const gear = page.getByRole("button", { name: "Open Kavannah settings" });
    await gear.waitFor({ timeout: 10_000 });
    await sleep(300);
    await highlight(gear);
    await page.screenshot({ path: path.join(OUT, "03-open-settings.png") });
    log("03 done");

    // 4: settings with the key pasted and the connection tested.
    await page.setViewportSize({ width: 960, height: 720 });
    await page.goto(`chrome-extension://${extId}/options.html`);
    const keyInput = page.locator("#access-key");
    await keyInput.waitFor({ timeout: 10_000 });
    await keyInput.fill(key);
    await keyInput.press("Enter");
    if (MOCK) {
      const url = process.env.KAVANNAH_SCREENSHOT_SERVER || "http://127.0.0.1:8790";
      await page.locator("#backend-url").fill(url);
      await page.locator("#backend-url").press("Enter");
    }
    await sleep(300);
    const test = page.getByRole("button", { name: "Test connection" });
    await test.click();
    await page.getByText(/access key accepted|open server/).waitFor({ timeout: 20_000 });
    await sleep(300);
    await highlight(keyInput);
    await highlight(test);
    await page.screenshot({ path: path.join(OUT, "04-settings.png") });
    log("04 done");

    // 5 + 6: the fake x.com page, the K button, then the analysis.
    await page.setViewportSize({ width: 1400, height: 950 });
    await context.route("https://x.com/**", (route) => {
      if (route.request().resourceType() === "document") {
        return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FIXTURE_HTML });
      }
      return route.fulfill({ status: 204, body: "" });
    });
    await page.goto(HERO_URL);
    const hero = page.locator('article[data-testid="tweet"]').filter({ has: page.locator(`a[href$="/status/${HERO_ID}"]:has(time)`) });
    const kButton = hero.getByRole("button", { name: "Analyze with Kavannah" });
    await kButton.waitFor({ timeout: 20_000 });
    await sleep(500);
    await highlight(kButton);
    const box = await hero.boundingBox();
    await page.screenshot({
      path: path.join(OUT, "05-click-k.png"),
      clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 16), width: box.width + 32, height: Math.min(box.height + 32, 950 - box.y) },
    });
    await unhighlight(kButton);
    log("05 done");

    await kButton.click();
    const dialog = page.getByRole("dialog", { name: "Kavannah" });
    log(MOCK ? "waiting for the mock analysis" : "waiting for a live analysis (1-3 min)…");
    await dialog.getByRole("heading", { name: /^Content & manipulation assessment: / }).waitFor({ timeout: 240_000 });
    await sleep(800);
    await page.screenshot({ path: path.join(OUT, "06-result.png") });
    log("06 done");
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
  log("wrote", fs.readdirSync(OUT).join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
