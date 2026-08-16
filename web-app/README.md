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

Covered: the upload prefix guard (which doubles as the delete guard and the
discard guard, including that an object a row still points at is never
discardable), the MIME
allowlist, the display contract (a stable `<img src>`, no `gs://` path in the
client payload, and the thumbnail's fallback to the original), the thumbnail
sizing math, the full-size viewer's step/wrap/close arithmetic, the batch
uploader's concurrency bound (peak in flight, input-order results, one rejecting
item not stopping its siblings), the coalescing of the batch's gallery
refetches (requests piling up during a run collapsing into one follow-up, and
never settling on a run that started before them), the client-side gallery ordering the
optimistic favorite toggle re-sorts with, where an upload still in flight is
placed in that order, how a drop is sorted into uploadable and unsupported
files plus the enter/leave counting that keeps the drop overlay steady, the
sidebar's width bounds, drag arithmetic and tolerant parsing of stored state,
the analyzer's tag normalization (off-vocabulary terms dropped, hex coerced,
per-dimension caps), the queue's rules (job parsing, lease expiry, job cap,
whether a re-analysis needs a new job, error truncation), what the property
panel makes of each combination of stored row and run status — including which
dead ends offer a re-analyze — and the second-level sidebar's placement and
selection arithmetic.

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
| `src/server/references/upload.ts` | object path per upload, the prefix check that verifies the uri the browser reports back, the scoped object delete, and which abandoned uploads are safe to discard |
| `src/lib/image-types.ts` | accepted upload MIME types → file extension, shared by the form's `accept` and the server's allowlist |
| `src/server/agents/orchestrator.ts` | the routing model: plain-language message → Gemini function-calling loop, no tools registered yet |
| `src/server/agents/analyzer.ts` | agent 2: one PRO vision call over the reference's `gs://` uri, answered against a schema built from the tag vocabulary |
| `src/lib/analysis.ts` | the fixed tag vocabulary per dimension, and the normalization that drops anything the model invented |
| `src/server/agents/analysis-queue.ts` | the queue over `AgentRun` — `enqueueAnalysis` (in `add`'s transaction), the leased compare-and-set claim, the run, and the after-response kick |
| `src/lib/analyzer-queue.ts` | the queue's rules with no database in them: job parsing, the lease cutoff, the per-invocation cap, whether a re-analysis needs a new job, and the error string the panel renders |
| `src/app/api/agents/analyzer/worker/` | the scheduled drain — no session, authorized only by `ANALYZER_WORKER_SECRET` as a bearer token |
| `src/lib/analysis-view.ts` | what the property panel is looking at: stored properties vs. the run's progress vs. a dead end, and which dead ends offer a re-analyze |
| `src/components/color-palette.tsx` | the palette as overlapping circles, ringed so two near-identical colours stay apart |
| `src/app/projects/[id]/` | project workspace — upload dropzone, reference gallery, full-size viewer, collapsible orchestrator sidebar |
| `src/lib/gallery.ts` | `inGalleryOrder` / `withFavorite` — the server's sort mirrored for optimistic updates — `withPendingUploads`, which slots uploads in flight into that order, and `neighborId`, the viewer's wrapping next/previous step |
| `src/app/projects/[id]/pending-uploads.ts` | the in-flight upload list the dropzone writes and the gallery renders, plus the object URL each placeholder previews |
| `src/lib/concurrency.ts` | `mapWithConcurrency` — the bounded work queue the dropzone uploads a batch through |
| `src/lib/coalesce.ts` | `coalesceRuns` — collapses a batch's per-file gallery refetches into one run in flight plus one queued, without settling a caller on a run that predates it |
| `src/lib/drag-drop.ts` | `sortDroppedFiles` (uploadable vs unsupported, content type narrowed once), the drag-depth counter and the files-only drag check |
| `src/app/projects/[id]/use-file-drop.ts` | the window-level drag listeners that make the whole page the drop target |
| `src/lib/sidebar.ts` | the sidebar's width bounds, the drag and collapse arithmetic, and the tolerant parse of what was stored |
| `src/app/projects/[id]/sidebar-state.ts` | the sidebar's open/width store — an external store over `localStorage`, read after hydration |
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
- **The analyzer queue is the `AgentRun` table, not a job service.** `add` files
  a QUEUED `ANALYZER` row in the same transaction as the reference, so a
  reference always has a job — the panel reads a missing run as "never
  analyzed", not as "waiting". Two things drain it: `after()` on the upload
  request (one job, no secret, works with no infrastructure at all) and
  `POST /api/agents/analyzer/worker` for backlog and dead leases. Deploy the
  second with `gcloud scheduler jobs create http` and an
  `Authorization: Bearer $ANALYZER_WORKER_SECRET` header; without that env var
  the route answers 503 rather than being open to Vertex spend. infra.md §XIII.
- **A run stuck RUNNING is reclaimed, not replaced.** The claim is a
  compare-and-set on the `(status, startedAt)` it read, and a RUNNING row past
  its 10-minute lease is claimable again — so a worker killed mid-job costs a
  delay, not a permanently spinning tile. Re-analyze requests never file a
  second job against a QUEUED or RUNNING row for the same reason.
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
- **A dropped batch uploads three at a time, not all at once and not one at a
  time.** Each file costs a signed-url round trip, a GCS `PUT` (twice, with the
  thumbnail) and an `add`, so serialising a drop of twenty charged the sum of
  all of them — six 1px files measured 2240ms sequential against 958ms at
  concurrency 3. `mapWithConcurrency` never rejects: one unsupported file lands
  in the failure list while its siblings finish. Tiles still appear as they
  land, but the refetch that brings them in is coalesced — see below.
- **The gallery refresh is coalesced and off the upload's critical path.** Every
  landing row wants `reference.listByProject` refetched, and that list gets
  longer as the batch lands, so awaiting one refetch per file was the most
  expensive possible schedule — each worker paid a list round trip before
  picking up its next file. `coalesceRuns` in `src/lib/coalesce.ts` keeps at
  most one refetch in flight plus one queued behind it; measured over 24 files
  at concurrency 3 against a real `QueryClient`, 25 list fetches became 10 and
  the batch finished in 333ms instead of 839ms. What the placeholder release
  depends on is that a coalesced request settles only on a run that *started
  after it*, so the row is in the cache by the time its tile is dropped. A file
  that failed releases its placeholder immediately instead — no row is coming
  for it. Refetching costs no image bytes either way, because tile `src`s are
  stable app paths.
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
- **An upload that fails after the `PUT` hands its bytes back.** The object
  lands before the row does, so anything that throws between them (a failed
  `reference.add`, a dropped connection) would leave bytes nothing points at —
  invisible to the gallery and to `reference.remove`, and billed forever. The
  uploader calls `reference.discardUpload` in that window. It deletes only uris
  under the project's own prefix that no `Reference` row claims, so a replayed
  or stale discard cannot delete a live tile's image. It does not cover a tab
  closed mid-upload; that still needs a sweeper over unreferenced objects.
- **The drop target is the window, not the dashed box.** `useFileDrop` listens
  on `window` for two reasons: a file dropped on anything the page does not
  handle makes the browser navigate the tab to that file, losing the workspace,
  and once the gallery is full the grid is what a director aims at. Nothing else
  may register a `drop` handler — two of them fire on the same drop and the
  batch uploads twice. The overlay is `pointer-events-none` for the same reason.
  Enter and leave are counted rather than treated as a boolean: both bubble, so
  crossing onto a child element looks exactly like leaving the window.
  `sortDroppedFiles` splits the batch before anything starts, so a PDF dragged
  in with the photos is reported without ever getting a placeholder tile.
- **A dropped batch appears in the grid before any of it has uploaded.**
  `usePendingUploads` lives in the workspace, above both the dropzone and the
  gallery, and each entry carries an object URL of the local file — so twenty
  photos show twenty tiles immediately instead of a progress bar over an empty
  grid. `withPendingUploads` puts them at the head of the non-favorite block,
  where the real rows will sort, or the tile jumps when it lands. A placeholder
  is dropped only after the invalidation that brings its row into the cache, and
  the object URL is minted in the drop handler and revoked there — a render or
  an effect can run twice and leak the extra URL.
- **The gallery's sort lives in two places on purpose.** `reference.listByProject`
  orders favorites first then newest first in Postgres; `inGalleryOrder` in
  `src/lib/gallery.ts` repeats it in TypeScript so the star and the Remove button
  can write the cache before the round trip — one waits on a database write, the
  other on two GCS object deletes. Change the `orderBy` and you must change the
  comparator, or the tile jumps when the mutation settles. Both are exercised
  against each other, so `npm test` pins the comparator and the two were checked
  to agree against the live database. Only the last in-flight mutation
  invalidates (`isMutating() === 1`): a list fetched while a sibling toggle is
  still open does not know about that toggle and would flicker it back.
- **The orchestrator runs in-process, not on Agent Engine.** `orchestrate()`
  drives Gemini function calling over `generateContent` directly.
  `AGENT_ENGINE_RESOURCE` and `agent-runtime.ts` stay for the ADK deployment of
  agents 2–5; routing one sentence to one tool does not need a deployment.
- **A failing tool goes back to the model, not to the client.** `runSafely`
  turns a thrown tool into a `functionResponse` carrying `error`, so "that
  project has no references yet" reaches the director as a sentence in the chat
  rather than a 500. Tool arguments are re-validated with zod server-side — the
  model's output is untrusted client input.
- **The sidebar takes page width; the director decides how much.** It is a flex
  sibling of the gallery, never an overlay, so its width is width the grid does
  not get — which is why the left edge is a drag handle (280–560px, arrow keys
  when focused) and why collapsing leaves a 48px rail rather than nothing: the
  expand button has to stay reachable. Open state and width are kept in
  `localStorage` and read through `useSyncExternalStore`, not `useState` plus an
  effect: the server has no `localStorage`, and this project's eslint forbids
  `set-state-in-effect`. That means the first paint is always the default and
  a stored state applies just after hydration. A drag writes the store on every
  pointer event but `localStorage` only on release, and the width transition is
  dropped while resizing or the edge trails the pointer.
- **Chat history lives in the browser.** `orchestrator.send` is stateless and
  takes the prior turns as input; nothing is persisted yet, so a reload starts
  a fresh conversation.

## Skills

`.agents/skills/` holds the Prisma 7 skill pack installed by `prisma init`.
`.claude/` symlinks into it and is gitignored, as are the other agent-tool dirs.
