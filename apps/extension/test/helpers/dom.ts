import { readFileSync } from "node:fs";
import path from "node:path";

// Under vitest's jsdom environment `import.meta.url` is an http: URL, so resolve from the
// CommonJS-style __dirname vitest injects (falling back to the package root).
const TEST_DIR = typeof __dirname === "string" ? path.join(__dirname, "..") : path.join(process.cwd(), "test");
const FIXTURE_PATH = path.resolve(TEST_DIR, "fixtures/x-timeline.html");

/** Loads the X timeline imitation into the jsdom document body. */
export function loadFixture(): void {
  const html = readFileSync(FIXTURE_PATH, "utf8");
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = body?.[1] ?? html;
}

export function articles(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('article[data-testid="tweet"]'));
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
