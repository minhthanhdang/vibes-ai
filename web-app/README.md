# web-app

Product spec item 7 — the centralized experience. Not an agent; it drives the
six agents that live on Agent Runtime.

Next.js 16 (App Router, Turbopack) · React 19 · tRPC 11 · Prisma 7 · zod 4 ·
TanStack Query 5 · Tailwind 4. Deploys to Vercel.

## Setup

```sh
cp .env.example .env.local   # DATABASE_URL, the SA key, the OAuth client
npm run db:up                # postgres 18 in docker on 12001
npm run db:push              # or db:migrate once you want migration files
npm run dev                  # http://localhost:12000
```

### Tests

`npm test`. See [Tests](#tests) below for what the command's flags are for.

### The OAuth client

Sign-in needs a **Web application** OAuth client. `gcloud` cannot create one —
its only OAuth commands are `alpha iap oauth-clients` (IAP brands) and
`beta iam oauth-clients` (Workforce Identity Federation), neither of which is a
"Sign in with Google" client. Make it by hand:

1. [Google Auth Platform → Branding](https://console.cloud.google.com/auth/branding)
   — configure it once per project, audience **External**.
2. [→ Clients](https://console.cloud.google.com/auth/clients) → **Create client**
   → type **Web application**.
3. Authorized redirect URI: `http://localhost:12000/api/auth/google/callback`,
   plus one per deployed origin. It has to match `APP_URL` exactly, scheme
   included — Google compares the string, not the host.
4. Copy the id and secret into `GOOGLE_OAUTH_CLIENT_ID` /
   `GOOGLE_OAUTH_CLIENT_SECRET` in `.env.local`.
5. While the consent screen is in **Testing**, only accounts listed under
   Audience → Test users can sign in.

| | Port |
|---|---|
| Next dev server | 12000 |
| Postgres (docker) | 12001 |

Local Postgres is `docker-compose.yml`; data lives in the
`director-assistant-pgdata` volume and survives `db:down`. Use `docker compose
down -v` to wipe it.

Nothing is provisioned for deploy yet (infra.md §IX) — Neon, Supabase, or
Vercel Postgres fits the Vercel split. Serverless needs `connection_limit=1`
inside the URL, not appended to it.

`prisma generate` writes to `src/generated/prisma`, which is gitignored, so
`npm run build` runs it first. Prisma 7 loads no env of its own; `prisma.config.ts`
pulls in `.env.local` then `.env`.

## Tests

`npm test` — `node --test` over `src/**/*.test.mts`, no server, no database, no
credentials. Three parts of that command are load-bearing: `.mts` (tsx compiles
plain `.ts` as CJS, which forbids the top-level `await import` a test needs to
set env before loading a module), `--conditions=react-server` (without it the
`server-only` package throws), and `SKIP_ENV_VALIDATION=1` set inside the test
file before importing anything that reads `env()`.

Covered: the upload prefix guard (which doubles as the delete guard), the MIME
allowlist, the display contract (a stable `<img src>`, no `gs://` path in the
client payload, and the thumbnail's fallback to the original), the thumbnail
sizing math, and the full-size viewer's step/wrap/close arithmetic.

## Layout

| Path | What |
|---|---|
| `src/env.ts` | zod-validated server env. `SKIP_ENV_VALIDATION=1` bypasses it. |
| `src/server/db.ts` | Prisma singleton over the `PrismaPg` driver adapter |
| `src/server/api/` | tRPC router, context, `publicProcedure` / `protectedProcedure` |
| `src/server/auth/google.ts` | authorize URL, PKCE, code → verified identity |
| `src/server/auth/session.ts` | session rows, cookie, `currentUser()` |
| `src/app/api/auth/` | `google` (start), `google/callback`, `signout` |
| `src/server/google/auth.ts` | `GoogleAuth` from the inline SA key |
| `src/server/google/storage.ts` | GCS client, locally-signed read/write URLs |
| `src/server/google/vertex.ts` | model ids, API host, retrying fetch |
| `src/server/google/agent-runtime.ts` | `:query` / `:streamQuery` against the deployed agents |
| `src/server/references/display.ts` | shapes a `Reference` row for the client — drops both bucket paths, adds the stable image paths |
| `src/app/api/references/[id]/image/` | the gallery's `<img src>` — ownership check, then a redirect to a freshly signed read URL; `?variant=thumb` serves the downscaled copy |
| `src/lib/thumbnail.ts` | the grid-sized copy the browser renders at upload time, plus the no-upscale sizing math |
| `src/server/references/upload.ts` | object path per upload, the prefix check that verifies the uri the browser reports back, and the scoped object delete |
| `src/lib/image-types.ts` | accepted upload MIME types → file extension, shared by the form's `accept` and the server's allowlist |
| `src/server/agents/orchestrator.ts` | the routing model: plain-language message → Gemini function-calling loop, no tools registered yet |
| `src/app/projects/[id]/` | project workspace — upload dropzone, reference gallery, full-size viewer, collapsible orchestrator sidebar |
| `src/lib/gallery.ts` | `neighborId` — the viewer's next/previous step, wrapping, and the null that closes it |
| `src/trpc/` | client provider, server-side prefetch proxy |
| `prisma/schema.prisma` | User → Project → Reference → Analysis / Crop → Moodboard → Deck, plus Session and AgentRun |

## Things that will bite

- **`global`, not `us-central1`.** The gemini-3.x models and the Managed Agents
  API are only served from `global`; the regional host 404s. infra.md §X.
- **A 404 with an HTML body is throttling, not a missing model.** `vertexFetch`
  retries those and lets JSON 404s through. Agent 2's batch fan-out over a
  project's references will hit this. infra.md §X.
- **No ambient ADC on Vercel.** Every Vertex and GCS call passes
  `GOOGLE_SERVICE_ACCOUNT_JSON` explicitly. Do not reach for
  `GOOGLE_APPLICATION_CREDENTIALS` — it wants a file path.
- **Function timeout vs. agent 2.** Analyzing a whole project outlives a Vercel
  function. Start an `AgentRun` row and poll `agent.status`; keep `streamQuery`
  for short calls. infra.md §VII.
- **Two different Google credentials.** `GOOGLE_SERVICE_ACCOUNT_JSON` is the
  app calling Vertex and GCS as itself. `GOOGLE_OAUTH_CLIENT_*` is a human
  signing in. They are unrelated and not interchangeable.
- **Everything under `project.*` and `agent.*` is `protectedProcedure`.** Ids
  come from the client, so each one re-derives ownership from `ctx.user` and
  answers `NOT_FOUND`, not `FORBIDDEN`, for someone else's row.
- **`PRO` is a preview id.** It lives in `MODELS` in `vertex.ts` so a rename is
  a one-line fix.
- **Every reference is a `gcsUri` in our bucket.** `Reference.gcsUri` is
  required and is the only image locator — no third-party URL is ever stored or
  loaded. It never reaches the browser: `forDisplay` strips it and hands over
  `/api/references/<id>/image` instead.
- **The gallery's `src` is an app path, not a signed URL.** The signature lives
  only in the redirect that route returns, good for `SIGNED_URL_TTL_SECONDS`, so
  a URL copied out of the page stops working rather than leaking the object.
  Signing per list instead would change every `src` on every refetch — and the
  gallery refetches after each file in a batch upload, so a 30-image project
  would re-download itself 30 times. The redirect is `private, max-age=` half
  the TTL, which is what keeps a cached redirect from outliving its signature.
- **The full-size viewer is a native `<dialog>` opened with `showModal()`.**
  Escape, the focus trap and the backdrop come from the element; setting `open`
  as a prop gives none of them, which is why the component drives it from an
  effect instead. It shows `displayUrl` — the original — while the grid behind
  it shows `thumbUrl`, so opening an image is a real second fetch unless the
  reference has no thumbnail, in which case the two urls are the same one.
- **Thumbnails are made in the browser, not on a server.** The uploader already
  decodes each file to read its pixel size, so it draws a 640px-long-edge JPEG
  from the same bitmap and PUTs it as a second object under the project's own
  prefix. There is no server-side image pipeline and no backfill: a row whose
  `thumbGcsUri` is null — every upload before this existed, plus any image
  already smaller than the box — is served the original for `?variant=thumb`,
  so the grid never 404s. A failed thumbnail upload is swallowed for the same
  reason; it costs bandwidth, not correctness.
- **`next/image` cannot be used for reference tiles.** The optimizer fetches
  the source itself, carrying no session cookie, so every tile would 404 against
  the ownership check. Plain `<img loading="lazy">` is deliberate.
- **Upload bytes never touch a function.** `reference.uploadUrl` mints a v4
  signed `PUT`; the browser uploads straight to GCS and then calls
  `reference.add` with the resulting `gs://` uri. Routing bytes through a route
  handler would cap uploads at Vercel's 4.5 MB body limit — under one phone
  photo. infra.md §VII.
- **That `PUT` needs bucket CORS.** `gs://mtd-hackathons-artifacts` allows
  `PUT`/`GET`/`HEAD` from `http://localhost:12000` and `:3000` only. A deploy
  must add its own origin (`gcloud storage buckets update --cors-file`) or every
  upload fails in the browser while succeeding from a script.
- **The uri the browser reports back is client input.** `reference.add` rejects
  anything outside `gs://<bucket>/projects/<projectId>/references/`, so a
  captured mutation cannot point a row at another project's object. The signed
  `PUT` is scoped to one path and one `Content-Type` — sending different bytes
  under a different type is a 403 from GCS.
- **`reference.remove` deletes the bytes too, and only the project's own.** It
  drops the row first — a failed object delete leaves an orphan blob, the other
  order leaves a tile whose image 404s — then deletes the object, but only if
  the row's `gcsUri` sits under `projects/<projectId>/references/`. A row
  pointing elsewhere (a seeded object, an artifact a later agent shares with a
  `Crop`) is left in the bucket. The delete is `ignoreNotFound`, so removing a
  reference whose upload never landed still succeeds.
- **The orchestrator runs in-process, not on Agent Engine.** `orchestrate()`
  drives Gemini function calling over `generateContent` directly.
  `AGENT_ENGINE_RESOURCE` and `agent-runtime.ts` stay for the ADK deployment of
  agents 2–5; routing one sentence to one tool does not need a deployment.
- **A failing tool goes back to the model, not to the client.** `runSafely`
  turns a thrown tool into a `functionResponse` carrying `error`, so "that
  project has no references yet" reaches the director as a sentence in the chat
  rather than a 500. Tool arguments are re-validated with zod server-side — the
  model's output is untrusted client input.
- **Chat history lives in the browser.** `orchestrator.send` is stateless and
  takes the prior turns as input; nothing is persisted yet, so a reload starts
  a fresh conversation.

## Skills

`.agents/skills/` holds the Prisma 7 skill pack installed by `prisma init`.
`.claude/` symlinks into it and is gitignored, as are the other agent-tool dirs.
