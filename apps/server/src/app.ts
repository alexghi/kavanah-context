import cors from "cors";
import express from "express";
import type { Principal } from "./lib/auth.js";
import { createErrorHandler, createRouter, notFoundHandler, type AppContext } from "./routes.js";

export type { AppContext } from "./routes.js";

/** Builds the Express app (used by index.ts and by the route tests). */
export function createApp(ctx: AppContext): express.Express {
  const app = express();
  app.disable("x-powered-by");
  // Behind Cloud Run / ngrok the client IP arrives in X-Forwarded-For; needed for per-IP limits and logs.
  if (ctx.config.trustProxy) app.set("trust proxy", true);
  // The extension's service worker calls from a chrome-extension:// origin; access keys, not
  // origins, are the gate, so CORS stays permissive (no credentials are ever used).
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.use((req, res, next) => {
    const started = performance.now();
    res.on("finish", () => {
      const ms = Math.round(performance.now() - started);
      const mode = (res.locals.mode as string | undefined) ?? ctx.config.mode;
      const cache = res.locals.cache ? " cache=hit" : "";
      const principal = res.locals.principal as Principal | undefined;
      const who = principal && !principal.anonymous ? ` key=${principal.name}` : "";
      ctx.log.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms mode=${mode}${cache}${who}`);
    });
    next();
  });

  app.use(createRouter(ctx));
  app.use(notFoundHandler);
  app.use(createErrorHandler(ctx));
  return app;
}
