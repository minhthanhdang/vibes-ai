# INFRA

Provisioned 2026-08-16 against project `mtd-hackathons`.

## I. Project

| | |
|---|---|
| Project ID | `mtd-hackathons` |
| Project number | `655806945364` |
| Owner account | `mtddev2004@gmail.com` |
| Billing | enabled (`01202B-A941A0-6A8B07`) |
| Region | `us-central1` |

`gcloud config` default project is set. Note the owner account is *not* the
account Claude Code runs under — check `gcloud auth list` if permissions look
wrong.

## II. Deploy Split

Agents on Google, UI on Vercel.

| Tier | Runs on | Deploy |
|---|---|---|
| Agents 2–6 | Agent Runtime (Gemini Enterprise Agent Platform) | `adk deploy agent_engine` |
| Web app | Vercel | `git push` |

Supersedes tech-spec §I, which put the UI on Cloud Run.

**Naming, as of the 2026-04-22 rebrand** — Vertex AI became Gemini Enterprise
Agent Platform. Vertex AI Agent Engine is now **Agent Runtime**. This is a
rename over identical services: no migration, `aiplatform.googleapis.com` is
still the API, and everything in this doc was provisioned correctly. The CLI
verb is still `adk deploy agent_engine`. See §XI.

## III. Enabled APIs

Required:

| API | For |
|---|---|
| `aiplatform` | Gemini PRO/FLASH/IMAGE, Agent Engine |
| `storage` | `GcsArtifactService`, user uploads |
| `slides` | the deck export (tech-spec §III.5) — called directly, not through a toolset |
| `drive` | Slides decks are Drive files. Scope is `drive.file` only — per-file, created-by-this-app |
| `iam` | service account management |

Not yet enabled, needed by tech-spec §VIII: `sqladmin` — the Cloud SQL Node
connector mints its certs against the Admin API, so the app SA also needs
`roles/cloudsql.client` once the instance exists.

Enabled but not on the critical path: `secretmanager` (Vercel has its own env
store), `iamcredentials` (see §V), `run` / `cloudbuild` / `artifactregistry`
(kept as the Cloud Run fallback in §VII — zero cost idle).

Default-on from project creation: `logging`, `monitoring`, `cloudtrace`,
BigQuery/Dataplex/Dataform boilerplate. Unused.

**Not needed:** `customsearch`. Nothing searches the web any more — references
come from the user's own uploads (product spec item 1), so there is no CSE
key, no Unsplash/Pexels key, and no use for `google_search_tool`,
`url_context_tool` or `computer_use`. `generativelanguage` is also unused since
models come via Vertex, not an AI Studio key. Do not enable both paths.

## IV. Storage

`gs://mtd-hackathons-artifacts` — us-central1, uniform bucket-level access.
Backs `GcsArtifactService`. All images move between agents as references to
this bucket, never base64 through context.

It is now also where images *enter* the system: the user's uploads are
`PUT` directly from the browser against a v4 signed URL, so this bucket holds
originals as well as agent output. Everything in it is user-owned content —
uniform access plus signed reads means nothing is publicly listable.

No staging bucket. `staging_bucket` is deprecated in the vendored ADK
(`adk-python/src/google/adk/cli/cli_deploy.py:906` — "no longer required or
used"); Agent Engine packages server-side. A `-agent-staging` bucket was
created and deleted.

## V. Service Account

`vercel-ui@mtd-hackathons.iam.gserviceaccount.com`

| Role | Scope |
|---|---|
| `roles/aiplatform.user` | project — call Agent Engine |
| `roles/storage.objectUser` | `-artifacts` bucket only |

Key: `~/.config/gcloud/mtd-hackathons-vercel-sa.json`, chmod 600, deliberately
outside the repo. Key ID `415dd4c4d8bd7d1f86881928697efa63c70ecac1`.

Signed URLs — read *and* upload — sign **locally** from the private key in that
JSON, no `signBlob` call, so `iamcredentials` and
`roles/iam.serviceAccountTokenCreator` are not required. `objectUser` already
covers the writes the upload path needs; no extra role. `iamcredentials` stays enabled only because switching to Workload
Identity Federation later would need it.

Verified end-to-end 2026-08-16 by activating the key in a throwaway gcloud
configuration: minted a token, called `gemini-3.7-flash` (200), and wrote /
read / deleted an object in the artifacts bucket. Least privilege also
confirmed — creating a bucket with this SA returns 403, as intended.

## VI. Vercel Environment

```
GOOGLE_SERVICE_ACCOUNT_JSON = <contents of the key file>
GOOGLE_CLOUD_PROJECT        = mtd-hackathons
GOOGLE_CLOUD_LOCATION       = global
GOOGLE_GENAI_USE_ENTERPRISE = 1
```

`GOOGLE_GENAI_USE_ENTERPRISE=1` selects the enterprise backend. Without it the
SDK defaults to the Gemini Developer API and ignores the project entirely. The
old `GOOGLE_GENAI_USE_VERTEXAI` still works but warns
(`adk-python/src/google/adk/utils/env_utils.py:71`).

`global`, not `us-central1` — the Managed Agents API is served only from
`global` (`adk-python/src/google/adk/agents/_managed_agent.py:189`), which is
also why the regional host 404s in §X. The bucket stays in us-central1; that is
unrelated and fine.

**Amended 2026-08-23:** both of the above are now defaults in `src/env.ts`
rather than lines someone remembers to paste, and both are asserted by
`src/env.test.mts` — the `global` default with the key absent *and* with it set,
so a default that ignores the environment fails too. Before that test, flipping
either one left the whole suite green (tech-spec §VIII, "The gate nothing
opened").

`JSON.parse` and pass to the auth client. Do **not** use
`GOOGLE_APPLICATION_CREDENTIALS` — it takes a file path, and no such file
exists on Vercel.

Vercel has no metadata server, so there is no ambient ADC. Every Vertex and GCS
call needs these credentials passed explicitly. This is the main thing Cloud Run
gave for free.

Credentials are server-side only. Agent Engine is called from route handlers /
tRPC procedures, never the browser.

**Held as a test — added 2026-08-22 (late night).** Everything in this section
was prose until now, and every claim in it is an assertion nothing checked.
`src/server/google/auth.test.mts` holds the four that matter on every request:
the key is passed inline (not via a file path), the project is named explicitly
rather than inferred from the key, the scope is `cloud-platform` — one token for
Vertex, GCS and the Cloud SQL Admin API alike — and the process holds one
`GoogleAuth`, so the minted token is cached once rather than per call. All four
could be broken with the whole 1,974-case suite green before it was written; see
tech-spec §VII "The credential nothing asserted".

Two files in the app derive a client from the key, not one: `auth.ts` for
everything that talks to Vertex or Cloud SQL, and `storage.ts`, because the GCS
client takes `credentials` itself and adds its own storage scopes. The test
holds that count at two.

## VII. Risks

**Function timeout vs. batch analysis.** Vercel caps function duration (~800s
on Pro). Dropping agent 1 removed the worst offender — a long browse — but a
user uploading twenty references still fans agent 2 out twenty ways. Kick
the batch off async and poll from the client rather than holding one streaming
connection open. Fallback: move the long-running piece to Cloud Run and keep
only the UI on Vercel — the three Cloud Run APIs are enabled for exactly this.

**Upload bytes must not touch a function.** Vercel's request body limit (4.5 MB)
is well under a phone photo. Uploads go browser → GCS against a signed URL; the
function only mints the URL and records the resulting `gs://` reference.

One thing reads them back the other way now: `crop_reference` cuts on the server,
so the original comes *into* the function that files the cut (`readObject`). That
is a read and not a request body, so the 4.5 MB limit never applies to it — what
applies is memory, measured and recorded in `orchestrator-tool-reference.md` §IV.
Because nothing weighed the object on the way in, the read names the largest
original it will take and refuses past it off the object's recorded size, so an
upload no function can hold is a sentence about that picture rather than the
whole turn dying with the function.

**No `adk api_server`.** Tech-spec §IV assumes SSE from a self-hosted FastAPI.
On Agent Engine that becomes `stream_query`, proxied through Next.js.

Carried over from tech-spec §V: `PRO` is preview and may be renamed.

## VIII. Slides Auth — settled 2026-08-23

**The user's OAuth credential. Not the service account.**

This was open, and defaulted to a service account "unless deck ownership
matters". Two things closed it. First, deck ownership does matter: everything
else in this app is the user's own content — they upload it, they own it,
nothing is credited or hotlinked (tech-spec §III.1) — and a deck of their work
owned by `vercel-ui@` and shared by link contradicts the one rule the intake
design is built on. Second, the premise changed: there is no `SlidesToolset` any
more, because §III.5 is not an agent. Nothing is choosing between the toolset's
two credential arguments; ordinary server code calls the Slides API, and it can
carry whatever credential we hand it.

The cost that argued for the service account — "a consent screen configured with
Slides + Drive scopes, console clickwork, the most likely thing to burn an hour
on the day" — is mostly already paid. The consent screen exists and is
configured; sign-in has used it since §VI. What is left is adding two scopes to
a client that already exists:

| Scope | Why |
|---|---|
| `https://www.googleapis.com/auth/presentations` | create the deck, append the slides |
| `https://www.googleapis.com/auth/drive.file` | per-file. Covers only files this app created — **not** `drive`, which would ask to read everything the user owns |

`drive.file` is the whole reason this is a comfortable ask rather than a scary
one. The consent screen says "see and manage files this app opens or creates",
not "see all your Google Drive files".

The service-account path is **dropped, not kept as a fallback**. Two auth paths
to one API is two things to get wrong and two to test, and the SA's limited
Drive quota was already a standing reason not to accumulate decks there.

**Consequence for the token.** Sign-in currently needs no stored refresh token —
it authenticates and forgets. An export runs on the user's behalf at the moment
they ask, so the access token from the live session is enough and nothing needs
persisting. If the deck ever needs to be built *without* the user present
(a scheduled export, a "Let's Vibes" run that ends in a deck), that changes and a
stored refresh token becomes a real decision — flagged here rather than assumed
away.

**Amended 2026-09-01 — the token is stored.** The paragraph above is reversed,
earlier than the scheduled-export case it flagged. Two things did it. An export
is not one request: the browser draws and PUTs one render per page before the
server call, so "the access token from the live session" would have to survive
an interactive multi-minute stretch with a possible consent redirect in the
middle. And a user who exports twice should not see a consent screen twice — a
forced `prompt: "consent"` round trip per export is a worse consent story than
holding one token.

What is stored is a `GoogleGrant` row, one per user, holding the refresh token
Google returns. A new model rather than columns on `User`, because the grant has
its own lifecycle — granted, re-consented, revoked — and because `User` is read
by `userForToken` on every request and should not carry a secret at all.

**Stored in plaintext, deliberately, and this is the flag rather than a
decision made quietly.** Cloud SQL is encrypted at rest by Google, and the app
already holds a service-account private key in the environment; anything that
can read this column can already read `GOOGLE_SERVICE_ACCOUNT_JSON`, so a second
application-level key would buy a rotation problem without moving the threat
model. If that reasoning stops holding — a read-replica handed to someone, a
log that dumps rows — sealing the column is the change, and it is a change to
one module.

**The consent round trip reuses the existing route pair** rather than building a
second OAuth surface: `/api/auth/google?intent=deck` asks for
`presentations` + `drive.file` on top of sign-in's own scopes, with
`access_type: "offline"`, `include_granted_scopes: true`, and
`prompt: "consent"` — that last one is load-bearing, because Google returns a
refresh token only on a first consent unless consent is actually re-shown, and
without it the feature ships silently unrepeatable. The pending-flow cookie
grows `grant?: true`, and the callback branches on it **before** `resolveUser`:
a grant never mints a session and never re-keys the signed-in user onto
whichever Google account they picked at the consent screen. A password-only
account (`googleId: null`) can therefore hold a grant and keep its own identity;
a grant flow arriving with no live session is refused. A callback that comes
back with no refresh token is a named failure the UI re-asks from, never a
half-connection stored quietly.

**Revocation.** `credential.ts` exchanges the stored token for a short-lived
bearer on each export. `invalid_grant` — the user revoked the app, or the token
aged out — deletes the row and returns the `needsConsent` branch, so the next
click is a consent screen rather than an error.

**Console work this needs:** the two scopes on the consent screen.
`.../auth/presentations` is classified **sensitive** by Google, so an External +
Published consent screen means app verification, while Testing status only means
adding test users. Confirm the publishing status before the first production
export — it is the one thing that can block and cannot be found in the repo.

## IX. Not Yet Done

No infra blockers remain. Credentials, models and storage are all verified
end-to-end (§V, §X). Outstanding items are product decisions, not setup:

- ~~Postgres for Prisma 7. No Cloud SQL provisioned. Use Neon/Supabase/Vercel
  Postgres — external fits the Vercel split and avoids a slow, paid instance.~~
  **Reversed 2026-08-21.** Convenience was the only thing weighed, and the
  eligibility constraints in tech-spec §I now weigh on the other side: with
  Postgres external, the whole "Google Cloud infrastructure" requirement rests
  on the bucket. Provisioning Cloud SQL and reaching it through the Node
  connector is tech-spec §VIII, including the connection math that decides the
  instance size. Still not provisioned — this is now a planned change rather
  than a rejected one. **Provisioned and verified 2026-08-22 — §XVI.** The
  instance is up, `sqladmin` is enabled and the connector path is proven from
  the app's own credential. **Landed 2026-08-22 (night):** the schema is
  deployed, the existing rows are copied across and `server/db.ts` queries Cloud
  SQL through the connector. The only Postgres item left is the Vercel deploy —
  the `CLOUD_SQL_*` four are in `.env.local` and not yet in the env store.
- Bucket CORS for the *deployed* origin. `gs://mtd-hackathons-artifacts` now
  allows `PUT`/`GET`/`HEAD` from `http://localhost:12000` and `:3000`
  (applied 2026-08-16, verified by preflight: the allowed origin is echoed, a
  foreign one gets no `Access-Control-Allow-Origin`). A Vercel deploy has to add
  its own origin — `gcloud storage buckets update gs://... --cors-file=...`,
  which needs a bucket-admin identity; the app SA (`vercel-ui@`) has object
  access only and cannot read or set bucket metadata.
- ~~A lifecycle rule on the `renders/` prefix, 7 days (compositor-v2 §III.2).~~
  **Applied 2026-08-22.** One object per revision per page means a twelve-round
  turn of agent 8 leaves a dozen PNGs behind, and nothing ever reads an old one
  — every read is at the revision it was just taken at. Same identity problem as
  the CORS line above, so it stays an owner action rather than something the app
  can do at boot: `npm run bucket:lifecycle -- --apply` runs on the operator's
  own ADC and writes `{"action":{"type":"Delete"},"condition":{"age":7,
  "matchesPrefix":["renders/"]}}`. It merges rather than pastes — a bucket
  lifecycle is a whole-list write, so the bare `gcloud storage buckets update
  --lifecycle-file=...` form would drop every other rule — and it reads the
  bucket back afterwards to check CORS survived. With no `--apply` it is a
  check, and exits non-zero when the rule is missing. Verified on
  `gs://mtd-hackathons-artifacts`: one rule, `Delete renders/ after 7 days`,
  both localhost origins still allowed.

## X. Model Reachability — 2026-08-16

ADC verified: present, `mtddev2004@gmail.com`, `cloud-platform` scope,
`quota_project_id` = `mtd-hackathons`.

All three tech-spec §II model IDs are **confirmed live** on `global`:

| Model | Location | Result |
|---|---|---|
| `gemini-3.1-pro-preview` | `global` | 200 |
| `gemini-3.7-flash` | `global` | 200 |
| `gemini-3-pro-image` | `global` | 200 — returned a 1.76 MB PNG |
| any of the above | `us-central1` | 404 `Publisher model ... was not found` |

Use `https://aiplatform.googleapis.com/v1/projects/$P/locations/global/...`.
The regional `us-central1-aiplatform.googleapis.com` host does not serve them.

For IMAGE, pass `generationConfig.responseModalities = ["TEXT","IMAGE"]`; the
image comes back as `parts[].inlineData` (base64 PNG). At ~1.8 MB per image
this is exactly why tech-spec §IV routes images through GCS as artifact
references rather than through context.

### Burst throttling looks like a 404

Rapid sequential calls return an **HTML** 404 page rather than a JSON error —
for every model, including ones that work. Spaced-out single calls return 200.

This produced a false negative during setup: PRO and IMAGE were first measured
inside `for` loops and recorded as unavailable. They are not. Anything measured
in a tight loop against this API should be re-tested in isolation before being
believed. Distinguishing signal: a genuine missing model returns **JSON**
`{"error": {"code": 404, "message": "Publisher model ... was not found"}}`;
throttling returns **HTML**.

Agent 2's fan-out across an uploaded batch will hit this. Add backoff and treat
HTML-bodied 404s as retryable.

**Held as a test — 2026-08-22 (night).** Both transports now decide this the
same way and a test says so: `server/google/retry-ladder.test.mts` puts
`isThrottle` (the header reading `vertexFetch` can make) beside `isThrottledCall`
(the body reading the SDK leaves us) and requires them to answer the throttling
HTML page, the missing-model JSON and an HTML 503 identically. The same file
holds 404 off the retry ladder both transports share, and holds the ladder
itself onto the SDK client — absent `httpOptions.retryOptions` the SDK returns
the first response unretried, which is "no backoff", not "the defaults".
tech-spec §VII has the mutation table.

**And the budget behind it — 2026-08-22 (night).** How many times a throttled
call is asked again was the literal `4` written twice, once per transport. It is
now `THROTTLE_RETRIES` in `server/google/vertex.ts`, read as the default by
both. They have to agree: the image generator tells the user the drawing service
is "busy" on the strength of that number, and a call goes out over one transport
or the other. Held by `server/google/vertex-defaults.test.mts`, behaviourally on
the SDK side and at the source on the REST side — `vertexFetch` needs a live
bearer token to make a call at all, so its default cannot be counted from a
test.

**The retry the ladders could not see — 2026-08-30.** A stream can open with
HTTP 200 and deliver the quota error as its first SSE chunk; the SDK throws it
as an `ApiError` mid-iteration, past both `retryOptions` (which reads only the
fetch response's status) and `throttleRetried` (which wraps only the connect).
That path "refused" 2 of 6 vibes pages on 2026-08-30 — a `got status:
RESOURCE_EXHAUSTED` 429 propagated to the worker and ended the chain.
`streamRetried` in `server/google/vertex.ts` now reconnects, but only while no
parts have reached the watcher: a replay after that would duplicate streamed
text in the live chat buffer, so mid-generation 429s still fail terminally, by
design. Backoff is `2 ** attempt * 1000`, double the connect ladders' 500,
because the quota it dodges refills per minute. A `VertexError` surfacing from
the inner `throttleRetried` already spent its budget and is not asked again.
Held by `server/google/stream-retry.test.mts`.

## XI. Rebrand — Vertex AI → Gemini Enterprise Agent Platform

Announced 2026-04-22. Vertex AI was reorganised, not retired: Model Garden,
Training, Model Registry, Endpoints, Pipelines and Agent Engine all continue
under the Agent Platform umbrella. Google states existing customers need no
migration and the underlying services are identical.

| Old | New |
|---|---|
| Vertex AI | Gemini Enterprise Agent Platform |
| Vertex AI Agent Engine | Agent Runtime |
| Agent Builder | folded into Agent Platform |
| `GOOGLE_GENAI_USE_VERTEXAI` | `GOOGLE_GENAI_USE_ENTERPRISE` (old one warns) |

Unchanged and verified by direct call: `aiplatform.googleapis.com` still serves
`generateContent` (§X). `google-cloud-aiplatform` is live on PyPI at 1.164.0.
ADK is at 2.7.0 published / 2.6.3 vendored here, and still spells the deploy
verb `adk deploy agent_engine`.

Nothing in §III–§VI needs changing — the API to enable is still `aiplatform`,
the SA roles are still `roles/aiplatform.user`. Only terminology and the env
flag move.

Note the vendored ADK imports an `agentplatform` package
(`memory/vertex_ai_rag_memory_service.py:38`) that is **not on PyPI** — guarded
by try/except. Don't depend on it; use the `google-genai` client path.

Sources: [name changes](https://docs.cloud.google.com/gemini-enterprise-agent-platform/vertex-ai-name-changes),
[Agent Runtime](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/runtime),
[product page](https://cloud.google.com/products/gemini-enterprise-agent-platform).

**Amended 2026-08-23 — the client for it is asserted now.** Nothing is deployed
behind Agent Runtime, so `src/server/google/agent-runtime.ts` has never run
outside a deploy that has not happened: `AGENT_ENGINE_RESOURCE` is unset in
every environment. The two verb spellings this section's rename makes easy to
get wrong — the resource's `:query` / `:streamQuery?alt=sse` and the payload's
`class_method: "query"` / `"stream_query"`, which are *not* the same string —
are now held by `agent-runtime.test.mts` against an injected transport, along
with the SSE reader's `data:` stripping and its blank-line skipping. See
tech-spec §VII "What stays on REST". A dormant path is the one a rename breaks
silently, because no run reports it.

## XII. Reproduce

```sh
P=mtd-hackathons; R=us-central1
gcloud services enable aiplatform storage slides drive iam \
  secretmanager iamcredentials --project=$P
gcloud storage buckets create gs://$P-artifacts \
  --project=$P --location=$R --uniform-bucket-level-access

SA=vercel-ui@$P.iam.gserviceaccount.com
gcloud iam service-accounts create vercel-ui --project=$P
gcloud projects add-iam-policy-binding $P \
  --member="serviceAccount:$SA" --role="roles/aiplatform.user"
gcloud storage buckets add-iam-policy-binding gs://$P-artifacts \
  --member="serviceAccount:$SA" --role="roles/storage.objectUser"
gcloud iam service-accounts keys create \
  ~/.config/gcloud/$P-vercel-sa.json --iam-account=$SA --project=$P
```

## XIII. Analyzer Queue — Cloud Scheduler

Agent 2 runs out of band: `reference.add` writes the reference row and a
`QUEUED` `AgentRun` in one transaction, and a worker claims it later. There is
no separate job store — the queue *is* the `AgentRun` table, which is also what
the property panel polls for "how far along is it".

Two things drain it:

1. **The kick.** `reference.add` schedules one job through `after()`, so the
   first analysis starts as the upload response is sent rather than on the next
   tick. Bounded to one job — it spends the tRPC function's remaining duration.
2. **The scheduler.** `POST /api/agents/analyzer/worker` drains up to
   `WORKER_JOB_LIMIT` (5) jobs per invocation, serially — Vertex burst-throttles
   a fan-out (§X), so depth comes from more invocations, not more parallel
   calls. It also reclaims jobs stuck `RUNNING` past a 10-minute lease, which is
   what a killed function (a deploy mid-analysis) leaves behind.

The endpoint carries no session — the caller is a machine — so a shared secret
in `Authorization: Bearer` is the whole authorization, and a wrong or missing
one is a 404. `ANALYZER_WORKER_SECRET` unset disables the endpoint entirely
(503): open-by-default would be an unauthenticated way to spend Vertex budget.
Queued jobs still get their kick, so the app works without the scheduler; the
scheduler is what guarantees a backlog and a dead lease are eventually cleared.

```sh
P=mtd-hackathons; R=us-central1
gcloud services enable cloudscheduler --project=$P
SECRET=$(openssl rand -hex 32)   # also set as ANALYZER_WORKER_SECRET on Vercel

gcloud scheduler jobs create http analyzer-worker \
  --project=$P --location=$R --schedule="* * * * *" \
  --uri="https://<deployment>/api/agents/analyzer/worker" \
  --http-method=POST \
  --update-headers="Authorization=Bearer $SECRET" \
  --attempt-deadline=300s
```

`cloudscheduler` is not in §III's enabled list — enable it at deploy time.
Minute granularity is the floor for Scheduler; if the queue needs to be emptied
faster than that, the Cloud Run fallback in §VII is the move, not a tighter
cron.

### Amended 2026-08-28: a second queue on the same table — the vibes worker

The vibes designer now runs out of band the same way
(multi-vibes-and-preview-prd §II.5). `vibes.startBatch` files one `QUEUED`
`AgentRun` (`agent: VIBES`) per board in the transaction that creates it,
`vibes.resume` files one for the first blank page, and
`POST /api/agents/vibes/worker` claims them later. Same secret discipline as
the analyzer's endpoint — `VIBES_WORKER_SECRET` unset disables it (503), a
wrong or missing bearer is 404 — and a **separate** secret on purpose:
rotating one worker's must not break the other.

Where it deviates from the analyzer, each with its reason:

- **One job per invocation, not five.** An analysis is seconds; a design page
  runs to minutes (one measured 12.5 at the round ceiling), and two in one
  invocation can exceed `maxDuration = 300`. Measured 2026-08-28: one can
  too — the four real queue pages ran 167–754s, two past the cap. Locally
  nothing enforces it; deployed, a >300s page is killed mid-design and the
  cron reclaims it after the lease, settling whatever the dead call left
  (the designed check is non-blank, so a partial page can settle designed).
  Applied 2026-08-28: the route now exports `maxDuration = 800` — Vercel's
  Fluid Compute ceiling on Pro, clear of the 754s worst page.
- **A 20-minute lease, not ten.** Same margin argument, wider because the
  page is slower: originally 15, widened 2026-08-28 when the 754s measured
  page left only ~2.5 minutes before a mid-flight double-claim, and so the
  lease stays above `maxDuration = 800` — a live invocation is never
  reclaimed, a dead one zombies for at most the 400s difference, and the
  cron clears a dead lease in 20 minutes instead of 15.
- **The settle chain-enqueues the board's next blank page in the same
  transaction**, so a board is a chain of rows walked in order rather than a
  fan-out — the analyzer has no ordering to keep.
- **A self-kick.** An invocation that took its one job `after()`-fires one
  POST at its own endpoint — URL from `APP_URL`, which is already required,
  validated and deployment-exact, not the PRD's `VERCEL_URL`, which is unset
  locally — so a chain advances at design speed. The cron stays the backstop
  that clears a dead lease and a cold queue; a lost kick costs a tick of
  latency, never a page.

The job, at deploy time, beside the analyzer's:

```sh
SECRET=$(openssl rand -hex 32)   # also set as VIBES_WORKER_SECRET on Vercel

gcloud scheduler jobs create http vibes-worker \
  --project=$P --location=$R --schedule="* * * * *" \
  --uri="https://<deployment>/api/agents/vibes/worker" \
  --http-method=POST \
  --update-headers="Authorization=Bearer $SECRET" \
  --attempt-deadline=300s
```

### Amended 2026-08-30: the tRPC route is at 800 as well

`app/api/trpc/[trpc]/route.ts` — every tRPC call in the app, and so every chat
turn — now exports `maxDuration = 800` too, raised from 300 for the same
measurement and the same reason as the vibes worker above: a design page runs
to minutes, and the turn that hits the cap is killed with its boards written
and no `ChatMessage` row for them. It had been holding a 170s reserve against
the 300s cap instead, which refused the second and third design of *"create 3
new pages"* (compositor-v2 §VI); that reserve is gone and the wall is the whole
bound now.

Two routes, one number, both of them a model loop the user is waiting on. The
difference is what happens past it: the vibes worker is leased and a killed
invocation is reclaimed by the cron, where a killed chat turn is simply lost —
which is why the worker takes one page per invocation and the turn does not.

None of this section is provisioned, checked 2026-08-28: `gcloud scheduler
jobs list` still refuses because `cloudscheduler` is not enabled, and the app
is not on Vercel (§IX), so both worker jobs — this one and the analyzer's
above — plus both secrets in the env store are one first-deploy owner action.
Until then the queue still works end to end: the mutations kick, settles
self-kick, and `npm run vibes:run` is the local drain.

## XIV. The 3.5 Floor — 2026-08-21, probed 2026-08-22

**The release-note half below was not probed when it was written.** The routing
half now is: on 2026-08-22 all five text/vision agents moved onto
`gemini-3.7-flash` and every one of them was run against `global` through
`npm run smoke` — a 4-round orchestrator turn, a live crop, a live page read, a
compose and a drained analyzer reading. No provisioning was needed and no quota
or region surprise appeared; §X's reachability finding held. The dated release
facts below are still read off release notes and still carry §X's warning.

The event requires Gemini 3.5 or newer (tech-spec §I). `PRO` is 3.1 and was what
every agent called, so the project did not clear it until that move. Nor can it on the
Pro tier: Gemini 3.5 Pro has not shipped, and `gemini-3.1-pro-preview`
(2026-02-19) is still the newest Pro-class id. The models at or above the floor
are flash: `gemini-3.7-flash` (GA 2026-08-13), `gemini-3.6-flash` and
`gemini-3.5-flash-lite` (both 2026-07-21).

`gemini-3.7-flash` was already confirmed live on `global` in §X, so the routing
change in tech-spec §II needed no new provisioning — only re-measurement of the
five agents moving onto it, which tech-spec §II now records.

One thing the move did touch that is infra-shaped: `scripts/floor.mts` prices
the orchestrator's prompt with `countTokens`, and it names its own model id. It
moved to `FLASH` with the agents, because a floor counted against a model
nothing calls is a number about nothing. Re-measured after the move: 11,865
tokens on a project holding a photograph and a board, 71% of it the 22 tool
declarations — the same shape as before, so the tokenizer did not shift under
the swap.

**Probed again 2026-08-22 (night): flash caches, `PRO` did not.** A real
three-call orchestrator turn reported `cachedContentTokenCount` 10,919 of 13,234
prompt tokens on its second call — implicit caching of the prefix every round
re-sends. Best-effort, not a budget: the third call re-sent a longer prefix and
reported none. The `AgentRun` rows have no column for a cached count, so they
price those tokens at the full input rate and the orchestrator's line in
`npm run spend` is a ceiling. tech-spec §II, "What the move did to the bill",
carries the numbers and why the rows were left alone.

Note for the ledger: the introductory price on 3.6/3.7 Flash runs to
2026-12-31, after which the published rate is $1.50/M in and $7.50/M out. The
`MODEL_PRICES` row for `gemini-3.7-flash` carries the introductory rate, so a
run costed after that date reads low. Irrelevant for the event, wrong afterwards.

## XV. Gen AI SDK — Infra Notes — landed 2026-08-22

Details of the swap are tech-spec §VII, including six places the plan met the
code and lost. Every bullet below held when it was run for real: no API was
enabled, no role was granted, and nothing in §VI or §XII moved. What is
infra-shaped:

- **No new API, no new role.** `@google/genai` in Vertex mode calls the same
  `aiplatform` endpoints under the same `roles/aiplatform.user`. It is a client
  library change, not a platform one.
- **Credentials work the way §VI requires.** The SDK's `googleAuthOptions` is
  google-auth-library's own options object, so the inline service-account key
  passes straight through and the no-ambient-ADC problem stays solved. Nothing
  in §VI or §XII changes.
- **`location=global` is handled by the SDK** — it branches to
  `aiplatform.googleapis.com` for `global` and to the regional host otherwise,
  which is the rule §X establishes and `apiHost()` implements by hand.
- **`GOOGLE_GENAI_USE_ENTERPRISE` is read by the SDK itself**, along with
  `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`. The env already carries
  all three (`src/env.ts`), so the client is configurable from the environment
  alone except for the credentials.
- **Retries are opt-in.** The SDK does not retry unless `httpOptions.retryOptions`
  is passed; its default ladder does not include 404, and the throttling
  described in §X arrives as an HTML-bodied 404. That discrimination has to be
  kept by hand on top of the SDK — see tech-spec §VII. It is: the client passes
  `{attempts: 5, httpStatusCodes: [408, 429, 500, 502, 503, 504]}` and
  `throttleRetried` wraps the call for the 404 alone. The signal survives
  because the SDK re-wraps a non-JSON error body as
  `{"error":{"message":"<the raw text>",…}}`, so §X's HTML page is still
  readable — off a string now rather than off a `content-type` header.
- **`vertexFetch` did not go away.** Agent Runtime (`:query`,
  `:streamQuery?alt=sse` against a `reasoningEngines` resource) has no surface
  in the SDK's model API, so `apiHost()` and `vertexFetch` stay for it — and for
  it alone. Both still throw while `AGENT_ENGINE_RESOURCE` is unset, which is
  still the state.
- **The prompt floor moved too.** `scripts/floor.mts` was the last hand-rolled
  POST outside Agent Runtime; it now calls the SDK's `countTokens` through a new
  `countTokens` export in `vertex.ts`, and the numbers came back the same shape
  (§XIV).

## XVI. Cloud SQL — Provisioned — 2026-08-22

**Superseding the "not yet run" version of this section.** It was written as a
script for the owner to run; the owner asked for it to be run instead, and it
was. Everything below is measured against the live instance.

It provisions under **different names** than that script proposed
(`director-assistant` / `director` / `director_assistant`). If a copy of the old
block is still in circulation, do not run it — it would create a *second* paid
instance beside this one.

| | |
|---|---|
| Instance | `vibes-ai-pg` |
| Connection name | `mtd-hackathons:us-central1:vibes-ai-pg` |
| Version | `POSTGRES_18` — same major as `docker-compose.yml` |
| Edition / tier | Enterprise, `db-g1-small` (1.7 GiB) |
| Region | `us-central1`, same as the artifacts bucket (§I) |
| Storage | 10 GB SSD, auto-increase |
| Availability | zonal, **backups off** |
| Public IP | `35.254.133.109` — informational; the app never dials it |
| Database / user | `vibes_ai` / `vibes_app`, BUILT_IN password auth |
| `max_connections` | **50** — the tier default, read off `pg_settings` |

`max_connections` was left at the default rather than raised to 100 as the
earlier draft proposed. 50 against a pool of `max: 3` is ~16 warm Vercel
instances plus the analyzer worker, and raising it on a 1.7 GiB instance trades
a limit you can see for an OOM you cannot. Raise it when the connection count
under real traffic says to, not before.

Backups off and zonal are deliberate: the contents are re-creatable with
`db:deploy` and nothing in it is a user's authored work. Both are one
`gcloud sql instances patch` away if that stops being true.

### Verified end to end, not assumed

A Node probe built `GoogleAuth` from the `vercel-ui@` service-account key — the
same inline-credentials path `server/google/auth.ts` uses, and the thing §VI
says is mandatory because Vercel has no ADC — handed it to
`new Connector({ auth })`, and queried through `pg`:

```
current_user      vibes_app
current_database  vibes_ai
version           PostgreSQL 18.4
max_connections   50
```

The whole chain works with the credential the deployed app will actually hold.
Two things this turned up that the docs do not say:

- **`getOptions()` returns `{ stream }`** — a socket factory, not the
  `{host, port, ssl}` the connector's README describes. tech-spec §VIII is
  corrected. A `pg` config that looks empty of connection details is correct.
- `sqladmin.googleapis.com` was **not** enabled before this and is now. §III
  listed it as required; that is no longer a pending item.

`roles/cloudsql.client` on the app SA is the whole grant.
`roles/cloudsql.instanceUser` is only wanted for IAM database auth, which
tech-spec §VIII takes second and on purpose — password auth first, one failure
surface at a time.

No `--authorized-networks`, deliberately: the connector authenticates with
short-lived certs against the Admin API, so there is nothing to allowlist —
which is the whole reason this works from Vercel, where egress IPs move.

**Amended 2026-08-23:** two facts in the table above are now held by a test as
well as written down here. `vibes-ai-pg` has a public IP and no VPC peering, so
`cloudSqlOptions()` must ask the connector for `IpAddressTypes.PUBLIC` —
`PRIVATE` typechecks, reads as the safer of the two, and would fail every query
at runtime. And the one connector per process is a requirement of this instance
in particular: each connector runs its own cert-refresh loop against the Admin
API for the same `mtd-hackathons:us-central1:vibes-ai-pg`. Both, plus the
credential the connector is built from, are asserted in
`src/server/google/cloud-sql.test.mts` against an injected fake connector —
tech-spec §VIII "Environment" has the mutation table. Nothing about the instance
changed; what changed is that a change to how it is reached now fails a test
rather than a query.

### Reproduce

```sh
P=mtd-hackathons; R=us-central1; INSTANCE=vibes-ai-pg
SA=vercel-ui@$P.iam.gserviceaccount.com
PGPASS=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)

gcloud services enable sqladmin.googleapis.com --project=$P
gcloud sql instances create $INSTANCE --project=$P \
  --database-version=POSTGRES_18 --edition=enterprise --tier=db-g1-small \
  --region=$R --availability-type=zonal \
  --storage-size=10GB --storage-type=SSD --storage-auto-increase --no-backup
gcloud sql databases create vibes_ai --instance=$INSTANCE --project=$P
gcloud sql users create vibes_app --instance=$INSTANCE --project=$P --password="$PGPASS"
gcloud projects add-iam-policy-binding $P \
  --member="serviceAccount:$SA" --role="roles/cloudsql.client"
echo "$PGPASS"
```

### Migrating the schema — the step tech-spec §VIII does not spell out

§VIII step 2 says "`npm run db:deploy` against the new instance" and leaves the
*how* open. It does not follow from step 3: the connector is wired into
`server/db.ts`, and the Prisma CLI does not go through our client. `migrate` and
`studio` read `DATABASE_URL` through `prisma.config.ts` and open an ordinary TCP
connection, so they need a real host and port the connector never provides.

The Auth Proxy bridges that, and it is a local dev tool rather than a deploy
dependency:

```sh
# one terminal
cloud-sql-proxy mtd-hackathons:us-central1:vibes-ai-pg --port 5432

# another
DATABASE_URL="postgresql://vibes_app:$PGPASS@127.0.0.1:5432/vibes_ai" \
  npm run db:deploy
```

Same answer for `npm run db:studio` against the deployed database. The running
app needs none of it.

#### Amended 2026-08-22 (night): deployed, over a tunnel written here

`cloud-sql-proxy` is still not installed on this machine and was not installed.
It did not need to be: the proxy is a TCP listener that hands each accepted
socket to `clientOpts.stream()`, and the connector that produces that stream is
already a dependency. `scripts/db-tunnel.mts` is those twelve lines.

```sh
# one terminal
npm run db:tunnel                                          # 127.0.0.1:5433

# another
DATABASE_URL="$(npm run -s db:tunnel:url)" npm run db:deploy
```

Both migrations applied on the first run. `vibes_ai` now holds the eleven
application tables plus `_prisma_migrations`, and the rows that were in local
Docker were copied across with it — 3 users, 7 projects, 38 references, 29
analyses, 18 moodboards, 156 agent runs. `npm run db:studio` takes the same
`DATABASE_URL`.

Preferred over installing the binary for two reasons: the tunnel authenticates
through the app's own credential path, so bridging the CLI proves the same
wiring the app uses, and there is nothing to install on the next machine. A
driver-adapter route was checked first and does not exist — Prisma 7.9.1's
config has no `adapter` field at all (tech-spec §VIII).

#### Amended 2026-08-23: a migration written after the cutover has two databases to reach

The first schema change since the cutover — `Moodboard.vibesBrief`
(compositor-v2.md §IX.2) — was written, applied with `npm run db:deploy` and
verified against the local `director-assistant-pg` container, and the suite,
the typecheck and the build were all green on it for four days. The app never
saw the column: `server/db.ts` dials Cloud SQL through the connector and has no
other path, so `vibes.start` was failing with `P2022 ColumnNotFound` against
`vibes_ai` the whole time, and nothing in the repo could have said so.

What made it invisible is worth naming, because it will happen again:

- `DATABASE_URL` in `.env.local` still points at local Docker, which is correct
  — §VIII step 3 kept it as the CLI's channel — so `npx prisma migrate status`
  answers "up to date" about a database the app does not use.
- The test suite never touches a database, and the four commands the stages are
  verified with (`typecheck`, `test`, `lint`, `floor`, `build`) do not either.
  A missing column is only ever found by something that runs a real query.
- Every script that reads real data (`design:*`, `render:check`, `spend`)
  imports `server/db.ts` and so goes to Cloud SQL. The local container has no
  reader left in this repo other than the CLI.

So a migration lands in two places or it has not landed:

```sh
npm run db:deploy                                          # local Docker, via DATABASE_URL
DATABASE_URL="$(npm run -s db:tunnel:url)" npm run db:deploy   # vibes_ai, with the tunnel up
```

Found by `npm run vibes:run`, which is the first thing in the repo that runs a
`vibes.*` procedure against a real database.

### Environment the cutover will want

`DATABASE_URL` **stays** — it is the CLI's channel and the local story, per
§VIII step 3. The connector path is configured separately:

| Var | Value |
|---|---|
| `CLOUD_SQL_INSTANCE` | `mtd-hackathons:us-central1:vibes-ai-pg` |
| `CLOUD_SQL_USER` | `vibes_app` |
| `CLOUD_SQL_PASSWORD` | the generated password |
| `CLOUD_SQL_DATABASE` | `vibes_ai` |

~~None of these are in `src/env.ts` yet.~~ **All four are required in
`src/env.ts` as of 2026-08-22 (night)**, added with the cutover as this
paragraph asked — `server/db.ts` has no other path to a database, so a missing
one is an app with no storage and belongs in the boot failure rather than in the
first query. They are not yet in the Vercel env store; that goes with the
deploy.

### Cost

`db-g1-small` bills while it exists, not while it is used — roughly $25–30/month,
about $0.90/day, and there is no free tier. It is the only always-on charge in
this project; GCS and Vertex are both per-use.

```sh
gcloud sql instances delete vibes-ai-pg --project=mtd-hackathons
```

after the event.
