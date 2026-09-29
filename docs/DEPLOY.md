# Hosting the Kavannah server

The extension talks to one HTTP API (`apps/server`). It can run in three places; the extension
only needs the **Backend URL** and, for hosted servers, a personal **Access key** (both in the
extension's settings page).

| Where | Command | Good for | Trade-offs |
|---|---|---|---|
| Laptop, local only | `npm run dev` / `npm run serve` | development, solo demo | only this machine |
| Laptop, public tunnel | `npm run serve:public` | showing someone today | URL changes on every restart; dies when the laptop sleeps |
| Google Cloud Run | `deploy/cloudrun.sh all` | production, judges, teammates | ~$0 idle (scales to zero), a few seconds of cold start |

## Access keys (all hosted setups)

A hosted server spends the Anthropic credits of whoever runs it, so it never runs open: with
`KAVANNAH_ACCESS_KEYS` set, `POST /api/analyze` and `POST /api/draft` require
`Authorization: Bearer <key>`. `GET /api/health` and `GET /api/fixtures` stay open (no cost) so
the settings page can verify a URL and a key. A live server bound to a public interface without
keys refuses to start (override: `KAVANNAH_ALLOW_ANONYMOUS=1`).

One key per person, so any single key can be revoked without touching the others:

```bash
npm run keys -- add judge-1        # prints the key once and stores it in .env
npm run keys -- list
npm run keys -- show judge-1
npm run keys -- remove judge-1
```

Keys are `name:key` pairs in `.env` (`KAVANNAH_ACCESS_KEYS=alex:kv_…,judge-1:kv_…`), which is
git-ignored. After changing keys: restart a local server, or run `deploy/cloudrun.sh keys` for
Cloud Run. Hand each person their key together with the install instructions; they paste it in
**Kavannah → Settings → Access key** and press **Test connection**, which reports
"access key accepted (their name)".

Per-person limits (env, defaults in `.env.example`): `KAVANNAH_RATE_LIMIT` live analyses per hour
per key (30) and `KAVANNAH_MAX_CONCURRENT` analyses in flight (4). Cached results (same post URL,
one hour) and demo-mode answers are free. Also set a monthly spend limit in the Anthropic console.

## Laptop tunnel (ngrok)

```bash
npm run keys -- add alex        # once
npm run serve:public            # server + ngrok; the public URL is printed by ngrok
```

Then in the extension: Backend URL = the `https://….ngrok-free.app` URL, Access key = yours.
The extension sends the `ngrok-skip-browser-warning` header, so ngrok's free-tier interstitial
page never gets in the way. The URL changes every time ngrok restarts (a reserved domain on a
paid ngrok plan fixes that), and analyses stop when the laptop sleeps.

## Google Cloud Run (production)

What `deploy/cloudrun.sh` sets up, once, in its own GCP project (`deploy/cloudrun.env`, committed,
holds the project id, region and service name; nothing secret):

- the project, billing link and the Cloud Run, Cloud Build, Artifact Registry and Secret Manager APIs (`setup`);
- a runtime service account `kavannah-api@…` whose only permission is reading the two secrets;
- Secret Manager secrets `kavannah-anthropic-api-key` and `kavannah-access-keys`, filled from `.env` (`secrets`);
- the service `kavannah-api`: image built by Cloud Build from the root `Dockerfile` (a single
  bundled ESM file, plain Node 22, non-root user), 1 vCPU / 512 MiB, request timeout 300 s
  (a live analysis takes 60-120 s), 8 concurrent requests per instance, min 0 / max 2 instances,
  public URL with HTTPS (`deploy`).

```bash
deploy/cloudrun.sh all        # setup + secrets + deploy + smoke
deploy/cloudrun.sh deploy     # redeploy after code changes (2-4 minutes)
deploy/cloudrun.sh keys       # after `npm run keys -- add/remove …`
deploy/cloudrun.sh url        # the https://…run.app URL
deploy/cloudrun.sh smoke      # health + one mock analysis with the first key in .env
deploy/cloudrun.sh logs 200   # recent request logs
```

Model, effort and web-search settings are copied from `.env` at deploy time (env vars on the
service); the API key and access keys are read from Secret Manager at instance start.

Operational notes:

- **Cost**: Cloud Run bills only while requests run; at hackathon volume this is cents. The
  Anthropic usage is the real cost, which the access keys and rate limits bound.
- **Cache**: results are cached in memory per instance for an hour; with two instances a repeat
  analysis can miss the cache. Fine at this scale.
- **Rollback**: `gcloud run revisions list --service kavannah-api --region europe-west1 --project kavannah`
  then `gcloud run services update-traffic kavannah-api --to-revisions <rev>=100 …`.
- **Rotate the Anthropic key**: change it in `.env`, run `deploy/cloudrun.sh secrets` then `deploy/cloudrun.sh deploy`.
- **Delete everything**: `gcloud projects delete kavannah`.

### Custom domain (optional next step)

Cloud Run's URL is stable and has a valid certificate, so a domain is cosmetic. To serve on
`api.<your-domain>`: verify the domain (`gcloud domains verify <your-domain>`), then
`gcloud beta run domain-mappings create --service kavannah-api --domain api.<your-domain> --region europe-west1 --project kavannah`,
add the DNS records the command prints (a CNAME to `ghs.googlehosted.com.`), and wait for the
certificate (minutes to an hour). Then rebuild the extension with the new URL (below).

## Shipping the extension for a hosted server

Bake the server URL in so people only have to paste their key:

```bash
WXT_BACKEND_URL="$(deploy/cloudrun.sh url)" npm run zip -w @kavannah/extension   # zip runs its own build
npm run package:testers   # or: extension + tester guide with screenshots in one zip (kavannah-testers-<version>.zip)
```

Install instructions to send with the zip and a key: unzip → `chrome://extensions` → Developer
mode → Load unpacked → the unzipped folder → toolbar icon → gear → paste the Access key → Test
connection. The **Reset** button next to the Backend URL returns to the baked-in server.

## What is and isn't protected

- Protected by keys and limits: everything that calls the model (`/api/analyze`, `/api/draft`).
- Open on purpose: `/api/health` (reports whether a key is required and whether the caller's key
  is valid; never the keys themselves) and `/api/fixtures` (the ten demo posts).
- Not stored anywhere: post text and analyses live only in memory (cache, one hour) and in the
  request logs' first line (`POST /api/analyze 200 … key=alex`). No database.
- The extension never holds the Anthropic key or prompts; a leaked extension zip reveals only the
  server URL, which is useless without a key.
