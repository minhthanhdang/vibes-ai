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

There are none. The suite was agent 1's — provider normalizers, the search
fan-out, the attribution rules — and it went with the code it covered, along
with the `test` script. Nothing that survived is worth pinning: `forDisplay` is
one `signedReadUrl` call and `orchestrate` has no seam to inject
`generateContent` through. Tests come back with agent 2's analyzer, which has
real normalization logic.

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
| `src/server/references/display.ts` | shapes a `Reference` row for the client — signed read URL per image |
| `src/server/references/upload.ts` | object path per upload, and the prefix check that verifies the uri the browser reports back |
| `src/lib/image-types.ts` | accepted upload MIME types → file extension, shared by the form's `accept` and the server's allowlist |
| `src/server/agents/orchestrator.ts` | the routing model: plain-language message → Gemini function-calling loop, no tools registered yet |
| `src/app/projects/[id]/` | project workspace — upload dropzone, reference gallery, collapsible orchestrator sidebar |
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
  loaded. The browser sees a signed read URL minted per request by
  `forDisplay`, good for `SIGNED_URL_TTL_SECONDS`, so a URL copied out of the
  page stops working rather than leaking the object.
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
