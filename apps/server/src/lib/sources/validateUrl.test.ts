import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateUrl, validateUrls } from "./validateUrl.js";

let server: http.Server;
let base = "";
const methods: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    methods.push(`${req.method} ${req.url}`);
    switch (req.url) {
      case "/ok":
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html>ok</html>");
        return;
      case "/missing":
        res.writeHead(404);
        res.end("nope");
        return;
      case "/head-rejected":
        if (req.method === "HEAD") {
          res.writeHead(405);
          res.end();
        } else {
          res.writeHead(200);
          res.end("body");
        }
        return;
      case "/redirect":
        res.writeHead(302, { location: "/ok" });
        res.end();
        return;
      case "/hang":
        return; // never answers
      default:
        res.writeHead(500);
        res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("validateUrl", () => {
  it("200 → verified", async () => {
    expect(await validateUrl(`${base}/ok`)).toEqual({ url: `${base}/ok`, ok: true, status: 200 });
  });

  it("404 → not verified (after a GET fallback)", async () => {
    expect(await validateUrl(`${base}/missing`)).toEqual({ url: `${base}/missing`, ok: false, status: 404 });
    expect(methods.filter((m) => m.endsWith("/missing"))).toEqual(["HEAD /missing", "GET /missing"]);
  });

  it("falls back to GET when HEAD is rejected and follows redirects", async () => {
    expect(await validateUrl(`${base}/head-rejected`)).toMatchObject({ ok: true, status: 200 });
    expect(await validateUrl(`${base}/redirect`)).toMatchObject({ ok: true, status: 200 });
  });

  it("times out on a hanging server", async () => {
    const started = Date.now();
    const result = await validateUrl(`${base}/hang`, { timeoutMs: 300 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timeout");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("rejects invalid URLs and unsupported protocols without a request", async () => {
    expect(await validateUrl("not a url")).toMatchObject({ ok: false, error: "invalid URL" });
    expect(await validateUrl("ftp://example.org/file")).toMatchObject({ ok: false, error: "unsupported protocol" });
  });

  it("connection errors are reported, not thrown", async () => {
    const result = await validateUrl("http://127.0.0.1:1/closed", { timeoutMs: 2000 });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("validateUrls checks each unique URL once and returns a map", async () => {
    const map = await validateUrls([`${base}/ok`, `${base}/missing`, `${base}/ok`]);
    expect(map.size).toBe(2);
    expect(map.get(`${base}/ok`)?.ok).toBe(true);
    expect(map.get(`${base}/missing`)?.ok).toBe(false);
  });
});
