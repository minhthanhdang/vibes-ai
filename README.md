# Vibes AI
**Open source AI-first design platform. Visual communication makes easier.**

[**▶ 4-min demo**](https://youtu.be/mwthfVIQC6c) · [**🔗 Live app**](https://vibes-ai-655806945364.us-central1.run.app/) · [**🏗 Architecture**](#architecture) · [**⚡ Reproducible Testing Instructions**](#reproducible-testing-instructions)

Built for the **All Things Agentic Hackathon** — category **Taskmaster**.

`gemini-3.7-flash` · `gemini-3-pro-image` · `gemma-4-26b-a4b-it-maas` · Gen AI SDK (Vertex mode) · Cloud SQL · Cloud Storage · Cloud Scheduler

<!-- TODO: hero GIF — the unattended run, not the chat. Fill the "Let's Vibes" form,
     then time-lapse six blank pages filling themselves in. ~15s, no narration. -->
![Vibes](docs/hero.gif)

## What it does

Vibes AI is a **5-agent design team** on Gemini 3 that turns a brief and a folder
of photographs into finished, editable pages:

- 🎛 **Orchestrator** (`gemini-3.7-flash`): the only voice in the chat. Holds the
  other four as tools across **29 calls** — read, crop, generate, place, design —
  and answers in one reply. Agents don't talk to the user; it does.
- 🔍 **Property analyzer** (`GEMMA` vision — open-weight): reads every upload the way a director
  does — colour palette, lighting, texture & grain, composition, subject, contrast
  & depth. A **fixed vocabulary per dimension**, so tags group instead of drifting.
  Runs off a queue, so dropping in twenty photos blocks on nothing.
- ✂️ **Image editor** (`FLASH` + `sharp`): "crop the middle sunflower, square"
  becomes a detected box, validated in code, cut for real — plus turn, flip, and a
  five-knob grade. Every cut is filed as a **version linked to its original**,
  never an overwrite.
- 🎨 **Image generator** (`gemini-3-pro-image`): when a page wants a paper texture
  or a dusk wash behind the grid, it makes the picture instead of explaining that
  it can't.
- 🖼 **Design assistant** (`FLASH` vision, 12-round tool loop): the one that
  actually designs. It **renders its own page and looks at it** each round —
  pictures, type in any Google Fonts family, colour fields, backgrounds, all
  written as real geometry you can then drag.

Behind them: **54 files of written design expertise** — 37 occupations (wedding,
banner, album, editorial, concept artist…) and 17 foundations (colour theory,
grid systems, typography, light and shadow…) — pulled by the design agent on
demand and returned whole. No model call, no drift.

**Let's Vibes** is the unattended run: one form — purpose, pages, palette, vibe,
size — and up to **4 briefs × 3 independent takes** go out as jobs a worker picks
up. Each page is a bounded unit of work, so a failure at page four keeps pages one
to three, Stop means stop, and a closed tab doesn't kill the run.

**Key innovation: the design agent has eyes on its own work.** Every round, the
page it is building is rasterised server-side and handed back to it as an image —
with the same page in words, off one read, so the picture and the description can
never disagree. It sees the headline it just put over a dark photograph and moves
it. And because the run's progress is **derived from the board** rather than kept
in a progress record, it cannot go stale: asking "is anything on this page?" is
the same question as "was this page designed?"


## Reproducible Testing Instructions

The app is a single Next.js project in `web-app/`. Local development is not
offline: it signs its own URLs against a real bucket and calls real Gemini, so a
Google Cloud project is part of the setup. Only Postgres is local.

### Prerequisites

| | Why |
|---|---|
| Node **20.9+** and npm | `engines` in `web-app/package.json` |
| Docker | local Postgres 18 on port 12001 — `npm run db:up` |
| A Google Cloud project with billing | Gemini calls and the dev bucket are real; nothing is stubbed |
| `gcloud` CLI, authenticated | provisioning the bucket, the service account and its key |
| `openssl` | generating the worker secrets (optional, see below) |

### Configuration

**1. Install**

```sh
git clone https://github.com/minhthanhdang/vibes-ai.git
cd vibes-ai/web-app
npm install
cp .env.example .env.local
```

**2. Google Cloud, once**

```sh
P=your-project; R=us-central1; DEV_BUCKET=$P-vibes-dev

gcloud services enable aiplatform.googleapis.com storage.googleapis.com --project=$P

gcloud storage buckets create gs://$DEV_BUCKET \
  --project=$P --location=$R --uniform-bucket-level-access

SA=vibes-app@$P.iam.gserviceaccount.com
gcloud iam service-accounts create vibes-app --project=$P
gcloud projects add-iam-policy-binding $P \
  --member="serviceAccount:$SA" --role="roles/aiplatform.user"
gcloud storage buckets add-iam-policy-binding gs://$DEV_BUCKET \
  --member="serviceAccount:$SA" --role="roles/storage.objectUser"
gcloud iam service-accounts keys create ~/.config/gcloud/$P-sa.json \
  --iam-account=$SA --project=$P

# let the browser PUT uploads straight to the dev bucket from localhost
./scripts/deploy.sh cors-dev $DEV_BUCKET
```

Development gets a bucket of its own — it writes originals, crops and renders
into it. Signed URLs are signed locally from that key, so
`roles/iam.serviceAccountTokenCreator` is deliberately not granted.

**3. Fill `.env.local`**

| Var | Value |
|---|---|
| `APP_ENV` | `development` — nothing defaults it; unset fails the boot check rather than serving 500s |
| `DATABASE_URL` | `postgresql://director:director@localhost:12001/director_assistant` — under `development` this is the app's own database, not just Prisma's channel |
| `DEV_BUCKET` | the bucket from step 2 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | whole key JSON, on one line |
| `GOOGLE_CLOUD_PROJECT` | your project id |
| `GOOGLE_CLOUD_LOCATION` | `global` — **not** a region; the models are only served there |
| `GOOGLE_GENAI_USE_ENTERPRISE` | `1` |
| `APP_URL` | `http://localhost:12000` |
| `DEV_SIGNUP_TIER` | `TIER_1` (unlimited) — set `TIER_2`/`TIER_3` to exercise the metered path |

Optional, and each one is *closed* when unset rather than open:

| Var | Effect |
|---|---|
| `VIBES_WORKER_SECRET` / `ANALYZER_WORKER_SECRET` | `openssl rand -hex 24`, ≥16 chars. Unset and those worker routes answer `503`; they carry no session, so a missing secret must not mean an open door |
| `AGENT_TRANSCRIPT_DIR` | e.g. `.design-log` — writes one `.jsonl` and one `.md` per turn, every model call the app made |
| `JUDGE_SIGNUP_CODES` | comma-separated, ≥24 chars each. Unset and the judges tab is gone |

The rest of `.env.example` belongs to `APP_ENV=production` and is not read
here — leave it as it comes.

**4. Database**

```sh
npm run db:up        # Postgres 18 in Docker, port 12001
npm run db:deploy    # apply migrations over DATABASE_URL
```

**5. Run**

```sh
npm run dev          # http://localhost:12000
```

Sign-in with Google is off in development — the OAuth door is closed and its
env is unread. Create an account with email + password at `/signin`; it lands on
`DEV_SIGNUP_TIER`. To reset one later:

```sh
node --import tsx scripts/set-password.mts you@example.com <password>
```

**6. Drain the queues** — in a second terminal, if you set either worker secret:

```sh
npm run dev:scheduler   # ticks the vibes + analyzer workers every 3s
```

This stands in for Cloud Scheduler. Without it a "Let's Vibes" run stalls after
the page the enqueuing request kicked off, and uploads sit `QUEUED` unanalyzed.
`npm run vibes:run` drains the vibes queue once, by hand.

### Checks

```sh
npm test           # 151 test files — no cloud credentials, no database
npm run typecheck
npm run floor      # prove every agent is on a model ≥ 3.5, live
npm run smoke      # end-to-end against real Gemini, the dev bucket and local Postgres
```

### Ports

| | Port |
|---|---|
| Next dev server | 12000 |
| Local Postgres (Docker) | 12001 |

Making a set of design pages is not one job, it is forty small ones. Find a
photograph. Squint at it and try to name what you actually like about it. Cut the
one part that matters out of the frame. Place it next to five others at a size
that doesn't fight them. Choose a background that isn't in any of your photos, so
go find one. Then do it again, five more times, for five more pages.

Nothing in that list is hard. All of it is *fiddly*, sequential, and impossible
to hand to anyone else, because the taste is the whole point and the taste lives
in your head. So it never gets delegated, and it eats an evening.

The chat-shaped answer is a model that *describes* a moodboard. That is not the
job. **The job is a system that takes the brief once, then puts pixels in the
right place in files you own — for as many pages as you asked for, while you are
not looking.**

## The unattended run

This is the workflow the project exists for. One form on the canvas — purpose,
page count, palette, vibe, page size — and then no further human input:

```
brief ──▶ vibes.start ──▶ board with N empty pages, painted
                              │
                              ▼
              ┌── for each page, in order ──┐
              │  agent 8 opens a tool loop  │
              │  · reads the gallery        │
              │  · looks at its own page    │
              │  · pulls design skills      │
              │  · crops / generates bytes  │
              │  · writes geometry          │
              └──────────┬──────────────────┘
                         ▼
        designed  ·  empty  ·  refused   ← three outcomes, not two
                         │
              refused ───┴──▶ run halts, finished pages kept
```

Each page is a **bounded unit of work**, not one giant request. That is a state
decision, and everything good about the run falls out of it:

- **A failure at page four keeps pages one to three.** The run halts; nothing
  rolls back.
- **Stop means stop.** The button ends the run at the current page boundary.
- **A closed tab is resumable.** Progress is read *off the board* — "is anything
  on this page?" — not off a record of what ran. A record would be a second
  account of the same fact, wrong the moment a page is deleted by hand. The scene
  cannot be wrong about whether a page is blank.
- **"Empty" is not "failed."** A page that spent all its rounds reading and
  placed nothing is reported as empty, so the run can't claim six successes over
  a board with five designs on it. Only a refusal halts.

**The honest limit:** the per-page loop is browser-driven, so closing the tab
pauses the run rather than continuing it server-side. The trade was deliberate —
six mutations give honest progress and a working Stop button where one long
request gives neither — and resume closes the gap. The *analyzer* pipeline below
has no such limit: it is fully server-side.

### Also running in the background

Uploading twenty photographs does not block on twenty vision calls.
`reference.add` writes the reference row and a `QUEUED` `AgentRun` in **one
transaction**; a Cloud Scheduler–driven worker claims jobs later. The queue *is*
the `AgentRun` table — one thing to poll, one thing to audit, no second job store
to fall out of sync.

## What else it does

- **Reads a photograph the way a director does.** Colour palette, lighting,
  texture and grain, composition, subject, contrast and depth — a fixed
  vocabulary per dimension, so the tags group instead of drifting.
- **Cuts what you asked for, not what fits.** "Crop the middle sunflower, square"
  becomes a detected box, validated in code, cut with `sharp`, and filed as a
  version linked to its original.
- **Composes pages, two different ways.** A deterministic layout engine that
  seats blocks in ten templates — or reads the slots straight out of a layout
  image you hand it.
- **Buys the picture that doesn't exist.** When a page needs a paper texture or a
  dusk wash behind the grid, it generates one instead of explaining that it can't.
- **Knows the trade, not just the pixels.** Thirteen files of written design
  expertise — seven occupations (wedding, banner, album, photographer, concept
  artist…) and six foundations (colour theory, composition, typography, visual
  hierarchy, light and shadow, grid systems) — returned whole to the design
  agent, no model call.

## How we built it

### AI core: Gemini 3 on the Gen AI SDK, Vertex mode

- **One client, three model families.** `gemini-3.7-flash` reasons and sees,
  `gemini-3-pro-image` draws, open-weight `gemma-4-26b-a4b-it-maas` reads
  uploads. All of it goes through a single `@google/genai` client in Vertex mode.
  `sdk-boundary.test.mts` fails the build if a call escapes onto raw REST.
- **Orchestration by `AgentTool`, not `sub_agents`.** The orchestrator holds the
  other four as tools: 19 declarations of its own, 21 inside the design agent.
  Every hop is request/response, so there is one voice in the chat.
- **Structured output wherever code consumes the answer.** Zod schema in, typed
  JSON out. The image editor returns `box_2d`, code validates it (min < max, box
  inside frame, aspect in tolerance), `sharp` does the cutting.
- **A retry ladder that tells failures apart.** A prompt block, an empty
  candidate with a `finishReason`, and a transport error each get a different
  answer. Only `MALFORMED_FUNCTION_CALL` is worth a retry.

### The design loop: the agent looks at its own page

- **Render, then show it the render.** Every round the scene goes render plan to
  SVG to PNG through `@resvg/resvg-js`, lands in Cloud Storage, and comes back as
  a `gs://` `fileData` part Gemini fetches itself. No image bytes in the context
  window.
- **The picture ships with the page in words.** Boxes, stacking order, overflow,
  band occupancy, text-on-background contrast, all off one read of the scene, so
  they cannot disagree. Renders are cached by revision plus a renderer
  fingerprint.
- **Same type on the server as in the browser.** Excalidraw's WOFF2 faces are
  decompressed to TTF at build (`wawoff2`), and any Google Fonts family the agent
  asks for is fetched and cached, so what `resvg` draws is what the user sees.
- **Expertise as files, not prompts.** 54 skill files, 37 occupations and 17
  foundations, returned whole with no model call. Nothing to drift.

### Frontend: an AI-native design surface

- **Next.js 16 App Router, React 19, TypeScript, Tailwind v4.**
- **The canvas is Excalidraw.** Pages, images, type and colour fields are
  ordinary Excalidraw elements, so anything an agent writes is something the user
  can drag. Assets are mirrored into the app, so the canvas makes no third-party
  request at runtime.
- **tRPC 11 + TanStack Query end to end,** zustand for view state, Prisma 7 types
  shared across the wire.
- **A turn streams while it runs.** `orchestrator.send` is a tRPC mutation that
  returns an async generator, so tool steps appear as they happen; the turn is
  persisted in `after()`, past the last byte of the response.

### Infrastructure: Google Cloud

- **Cloud Run** gen2, 2 vCPU / 2 GiB, 3600s timeout, concurrency 30, scale to
  zero.
- **Cloud SQL** PostgreSQL 18 over the Node connector, no IP allowlist. Prisma 7
  on the `pg` adapter.
- **Cloud Storage** for originals, crops, generated images and renders. The
  browser `PUT`s straight to the bucket on a v4 signed URL, so upload bytes never
  enter a function.
- **Cloud Scheduler** ticks two worker routes, the analyzer queue and the vibes
  run. The queue is the `AgentRun` table: one thing to poll, one thing to audit.
- **Secret Manager** for every credential; **Cloud Build** to **Artifact
  Registry** on a cleanup policy, deploy on push.
- **Auth is first-party.** Google OAuth and email + password, a sha256 session
  token in an httpOnly cookie, no auth library.

### Kept honest by tests

205 test files and 3,580 tests run with **no cloud credentials and no
database**, because every agent's loop is separable from its executor.
`npm run floor` proves live that every agent sits on a model at or above 3.5.

## Architecture

![Vibes AI architecture](docs/architecture.png)

Two things about this diagram are load-bearing.

**Image bytes never enter the agent tier.** The browser `PUT`s straight to GCS on
a v4 signed URL; every agent receives a *reference* to a bucket object. Nothing
is base64'd through a context window, and no upload counts against a serverless
body limit.

**The orchestrator holds agents 2–4, 7 and 8 as `AgentTool`, not as `sub_agents`.**
It needs their results back to write the sentence the user reads, so every call
is request/response. There is exactly one voice in the conversation.

### The agent tier

| # | Agent | Model | In → out | Code |
|---|---|---|---|---|
| 1 | Reference intake | — *(not an agent)* | file picker / drag-drop → GCS object + row | `src/server/references/upload.ts` |
| 2 | Property analyzer | `GEMMA` | image → a title, a palette of up to six hex colours, and five fixed-vocabulary tag dimensions | `src/server/agents/analyzer/analyzer.ts` |
| 3 | Image editor | `FLASH` vision + `sharp` | image + intention → `box_2d` and an ordered crop/turn/flip/grade list → a filed version | `src/server/agents/image-editor/` |
| 4 | Moodboard compositor | — *(retired)* | blocks + layout → slot assignments | `src/server/agents/deprecated/` |
| 6 | Orchestrator | `FLASH` | user message → tool routing → one reply | `src/server/agents/orchestrator/orchestrator.ts` |
| 7 | Image generator | `IMAGE` | description + shape → generated bytes | `src/server/agents/image-generator/image-generator.ts` |
| 8 | Design assistant | `FLASH` vision | intention → a tool loop that *sees* its own page | `src/server/agents/designer/` |
| — | Vibes worker | — *(not an agent)* | a `QUEUED` page ticket → agent 8 → the next ticket | `src/server/agents/vibes/` |

**2 is the one open-weight seat**, and the only agent no tool declaration routes
to. The orchestrator kicks its queue after filing a picture and moves on; a
reference is analyzed by a worker, so twenty uploads do not become twenty
blocking vision calls inside a chat turn.

**3 grew out of the cropper.** It was one call that answered with a `box_2d` and
stopped. It is now a tool loop that can also turn, flip and grade, answering
with an `EditOp` list that is ordered and validated in code before `sharp`
touches a pixel — a crop has to come first, because a box read against a picture
nobody has seen is not a box. The old guarantee is the one that survived: the
model says which rectangle, never which pixels. `crop_image` is gone from the
orchestrator's declarations; the tool is `edit_reference`.

**4 is retired.** It laid a page out by assigning the orchestrator's blocks to
the slots of a template chosen before the call — one text-only model call, with
deterministic code drawing the pixels. Agent 8 does the same job by judgement,
with its own eyes on the page it is making and no template to fit, so there is
no ask agent 4 answered that agent 8 does not answer better. `compose_moodboard`
is declared to nobody and dispatched by nothing; the compositor and its
layout-reader are kept unmodified under `deprecated/` as the record of what a
template-shaped compositor had to be told. A board now comes from `add_board`,
which is code and decides nothing, and everything that goes on its pages comes
from `design_page`.

Numbering follows the product spec, and **5 is missing on purpose**: deck export
is not an agent. A board's pages have already made every judgement a deck could
make — which references, which crop, where, in what order — so turning a board
into slides is a mapping, one slide per page in reading order. It is not a
server module at all: the Preview tab
(`src/app/projects/[id]/_main-viewport/_preview/`) rasterises the pages the
canvas already holds and walks them in order. Nothing to reach a model *from*
beats a test asserting nothing reaches one. Slot numbers are kept rather than
renumbered because the code and commit history refer to agents by them.

### Where state lives

| State | Home | Why there |
|---|---|---|
| Image bytes — originals, crops, generated, renders | Cloud Storage, uniform access | Signed URLs both ways; nothing publicly listable |
| Projects, references, boards, pages, conversations | Cloud SQL for PostgreSQL 18 | Relational, and versions are edges. A project holds *many* conversations, one open at a time |
| Agent job queue | The `AgentRun` table, two kinds — `ANALYZER` and `VIBES` | The queue *is* the run log — one thing to poll, one thing to audit |
| What a run spent | Token columns on `AgentRun`, money derived | A sum across a project is a sum over columns; a rate written into a row goes stale the day the price list moves |
| Canvas scenes | Postgres JSON, autosaved | The board is a document, not an event stream |
| Which chat and which panels a project is open on | `localStorage`, two keys, per project | What is on screen is a property of the *window*, not the project — two tabs would write a column against each other |
| **Run progress** | **The `VIBES` ticket, checked against the board** | The ticket is what a server-side run can resume from; the board is what stops it designing a page twice |

That last row is the load-bearing one for a long-running job, and it is where the
design moved. The run is no longer browser-driven: a `VIBES` row is one page of
work, and finishing it writes an outcome — `designed`, `empty` or `refused` —
and enqueues the next page. That row is the only durable account of where the
run got to, which is what makes a closed tab irrelevant.

A record like that can drift from the board — a user deletes a page by hand, and
the queue does not know. So it is never trusted about the thing it would be
wrong about: before designing, the worker reads the scene and asks "is anything
on this page?", and a page already designed is skipped rather than done again.
The ticket says what to do next; the board says what is true.

## Google Cloud & Gemini

The hackathon requires three things. Each is met, and each is **held down by a
test**, not by this paragraph:

| Requirement | Met by | Enforced by |
|---|---|---|
| Gemini 3.5 or newer | `gemini-3.7-flash` on the three reasoning agents — orchestrator, design assistant, image editor — via Gemini API on Vertex. The rule is mandatory, not exclusive — agent 2 runs the open-weight `gemma-4-26b-a4b-it-maas` alongside it, on the same Vertex endpoint | `src/server/google/model-floor.test.mts` — reads the generation off each id as a *number*, asserts the analyzer is on `GEMMA` and the three reasoning agents are still on `FLASH`, and asserts no source file reaches `PRO` |
| A Google agent framework | `@google/genai` — the Gen AI SDK for TypeScript, in Vertex mode; every model call goes through it | `src/server/google/sdk-boundary.test.mts` |
| A Google Cloud infra service | **Cloud SQL** (Node connector) **and Cloud Storage** (v4 signed URLs), plus Cloud Scheduler ticking both worker queues — `/api/agents/analyzer/worker` and `/api/agents/vibes/worker` | `src/server/google/cloud-sql.test.mts`, `storage.test.mts` |

Model IDs are pinned in one place so a mid-event rename is a one-line fix:

| Alias | Model ID | Used by |
|---|---|---|
| `FLASH` | `gemini-3.7-flash` | agents 3, 6, 8 — the reasoning text and vision agents, and the retired 4 |
| `GEMMA` | `gemma-4-26b-a4b-it-maas` | agent 2 — open-weight, served managed on Vertex |
| `IMAGE` | `gemini-3-pro-image` | agent 7 |
| `PRO` | `gemini-3.1-pro-preview` | **nothing** — 3.1 is below the 3.5 floor, so it stays declared and priced but uncalled |

An id is spelled in exactly four places — where it is declared, where it is
priced (`src/lib/agent/shared/model-cost.ts`), and the two landing-page files
whose copy names a model — and the same test fails if a fifth appears or if the
copy names a model the analyzer does not actually run on.

## Architectural discipline

The interesting engineering here is not the prompts. It is the **seams that are
tested rather than trusted** — 151 test files, ~3,000 assertions, `npm test`.

### Modularity — one agent, one module, one model call

Every agent is a folder under `src/server/agents/` that owns exactly one model
function; the executor half — bucket writes, reference rows, queue jobs, catalog
— lives outside it. That split is not tidiness, it is what lets the loop around a
model be exercised **without a bucket or a database**, which is why 151 test
files can run with no cloud credentials.

**Two doors, one function.** The properties panel's crop and the assistant's crop
both file through `src/server/references/file-version.ts`; "Let's Vibes" and the
orchestrator both call one `designPage`. A contract test asserts that neither
door assembles the agent out of its parts — two doors are allowed, two
implementations are not.

### State — derived where it can be, transactional where it can't

- **Progress is derived, never recorded.** See the note above: the run reads its
  own position off the board. Nothing to keep in sync, nothing to go stale.
- **Enqueue is one transaction.** The reference row and its `QUEUED` `AgentRun`
  land together or not at all — there is no window where an image exists with no
  job to analyze it.
- **One picture, one revision.** No vision tool is ever shown a render of a
  revision other than the one it read the scene at, and it reads at call time —
  so the words and the picture in one answer can never describe different boards.
  Renders are cached by revision *and* by a renderer fingerprint, so moving the
  renderer's arithmetic invalidates every stale picture instead of serving it.

### Tools — isolated, scoped, and failure-tolerant

- **The model never touches pixels.** The cropper gets `box_2d` (normalized
  0–1000, y-first — Gemini's trained detection format), then validates
  deterministically: min < max, box inside the frame, aspect within tolerance. On
  failure the validation error is appended to the prompt. Three attempts, then it
  reports failure rather than inventing a box. Cutting is arithmetic.
- **Three failures told apart, because they need different answers.** A
  prompt-level block (`promptFeedback`) is the model refusing *these words* — a
  retry sends the same words to the same reader, so it is answered once and
  steered at the description, not retried. A refusal with no image keeps the
  model's own sentence. A transport failure is read off the thrown value's
  `retryable` flag, after backoff is already exhausted. Two attempts, not three.
- **Scoped per agent.** Toolsets are per-agent, not global. The design agent is
  gated on `boards > 0` with a per-turn call limit, so a looping model can't run
  up a bill inside one turn.
- **An unconfigured door is a closed door.** The analyzer worker route answers
  `503` when its shared secret is unset — it carries no session, so a missing
  secret must never mean an open endpoint.
- **The eligibility claims above cannot silently regress.**
  `model-floor.test.mts` walks the source tree and fails if any text or vision
  agent is wired below 3.5; `sdk-boundary.test.mts` fails if a model call escapes
  onto the raw REST transport. These are red builds, not documentation.

## Deploying your own instance

Everything above runs on local Postgres and a dev bucket. Production adds Cloud
SQL, its own bucket, and a real "Sign in with Google" client.

### 1. Provision Google Cloud

```sh
P=your-project; R=us-central1

gcloud services enable aiplatform storage sqladmin \
  iam secretmanager iamcredentials cloudscheduler --project=$P

# Artifact bucket — originals, crops, generated images, renders
gcloud storage buckets create gs://$P-artifacts \
  --project=$P --location=$R --uniform-bucket-level-access

# Service account: one credential reaches Gemini, GCS and Cloud SQL
SA=vibes-app@$P.iam.gserviceaccount.com
gcloud iam service-accounts create vibes-app --project=$P
gcloud projects add-iam-policy-binding $P \
  --member="serviceAccount:$SA" --role="roles/aiplatform.user"
gcloud projects add-iam-policy-binding $P \
  --member="serviceAccount:$SA" --role="roles/cloudsql.client"
gcloud storage buckets add-iam-policy-binding gs://$P-artifacts \
  --member="serviceAccount:$SA" --role="roles/storage.objectUser"
gcloud iam service-accounts keys create ~/.config/gcloud/$P-sa.json \
  --iam-account=$SA --project=$P
```

Signed URLs are signed **locally** from that key — no `signBlob` call, so
`roles/iam.serviceAccountTokenCreator` is deliberately *not* granted. Creating a
bucket with this SA returns `403`, as intended.

### 2. Provision Cloud SQL

```sh
INSTANCE=vibes-ai-pg
PGPASS=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)

gcloud sql instances create $INSTANCE --project=$P \
  --database-version=POSTGRES_18 --edition=enterprise --tier=db-g1-small \
  --region=$R --availability-type=zonal \
  --storage-size=10GB --storage-type=SSD --storage-auto-increase --no-backup
gcloud sql databases create vibes_ai --instance=$INSTANCE --project=$P
gcloud sql users create vibes_app --instance=$INSTANCE --project=$P --password="$PGPASS"
echo "password: $PGPASS"
```

### 3. Configure production

`APP_ENV=production` reads a different half of `.env.example`:

| Var | Value |
|---|---|
| `APP_ENV` | `production` |
| `CLOUD_SQL_INSTANCE` | `your-project:us-central1:vibes-ai-pg` |
| `CLOUD_SQL_USER` / `_PASSWORD` / `_DATABASE` | `vibes_app` / the generated password / `vibes_ai` |
| `GCS_BUCKET` | `your-project-artifacts` |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | see below |
| `APP_URL` | the deployed origin |
| `ANALYZER_WORKER_SECRET` / `VIBES_WORKER_SECRET` | `openssl rand -hex 24` each — Cloud Scheduler presents them |
| `DATABASE_URL` | Prisma CLI's channel only; the app itself uses the connector |

The `GOOGLE_*` credential and project vars are the same ones development reads.
`DEV_BUCKET` and `DEV_SIGNUP_TIER` are not read here.

**The OAuth client must be made by hand.** No `gcloud` command mints a
"Sign in with Google" web client. In the Console: [Auth Platform → Branding]
(https://console.cloud.google.com/auth/branding) (audience **External**), then
[→ Clients](https://console.cloud.google.com/auth/clients) → **Create client** →
**Web application**. Authorized redirect URI must equal `${APP_URL}/api/auth/google/callback`
*exactly*, scheme included — Google compares the string, not the host.

### 4. Migrate the Cloud SQL schema

The Prisma CLI cannot use the Cloud SQL connector — `migrate` and `studio` open
ordinary TCP. `db:tunnel` bridges the two, reading the four `CLOUD_SQL_*` keys
out of `.env.local`:

```sh
# terminal 1
npm run db:tunnel                                   # 127.0.0.1:5433 -> the instance

# terminal 2
DATABASE_URL="$(npm run -s db:tunnel:url)" npm run db:deploy
```

The running app needs none of this — it reaches Cloud SQL through
`@google-cloud/cloud-sql-connector` with no host, port or IP allowlist.

### 5. Deploy

<!-- TODO: replace with the real deploy path once decided — see note below. -->

```sh
# TODO
```

> **Note on hosting.** The web tier currently deploys to Vercel while all state,
> storage, scheduling and inference stay on Google Cloud. See
> [`docs/deployment.md`](docs/deployment.md) for the Cloud Run path.

## Proof of execution

<!-- TODO: three screenshots. These are cheap and they are literally in the rubric. -->
| | |
|---|---|
| ![Cloud SQL instance](docs/proof-cloudsql.png) | `vibes-ai-pg` serving live queries |
| ![Vertex logs](docs/proof-vertex.png) | `gemini-3.7-flash` calls in Gemini Enterprise Agent Platform |
| ![GCS bucket](docs/proof-gcs.png) | Originals, crops and renders in the artifact bucket |

Verified end to end: a token minted from the service-account key, a live
`gemini-3.7-flash` call returning `200`, and an object written, read and deleted
in the artifact bucket. `npm run floor` and `npm run smoke` reproduce it.

## Repo layout

| Path | What's in it |
|---|---|
| `web-app/src/server/agents/` | The six agents. One folder per agent, one model function each |
| `web-app/src/server/agents/designer/` | Agent 8's tool loop — canvas, page, gallery, images, skills |
| `web-app/src/server/google/` | The Gen AI SDK boundary, auth, Cloud SQL connector, GCS |
| `web-app/src/server/skills/` | Thirteen files of written design expertise, returned whole — no model call |
| `web-app/src/server/references/` | Upload, cut, versioning — the one function both crop doors file through |
| `web-app/src/lib/` | Shared logic, browser and server: layout, canvas, pages, render |
| `web-app/src/app/` | Next.js App Router — workspace, gallery, moodboard, auth |
| `web-app/prisma/` | Schema and migrations |
| `web-app/scripts/` | `floor`, `smoke`, `spend`, `render:check`, `design:check` |

## What's next for Vibes

The pitch is a designer and a client iterating together. Today the app holds one
account per project, and the design agent is the only one in the room. The next
six things close that gap.

- **Two people on one board.** Presence on the canvas, comments pinned to a
  block, and a client's "make it warmer" arriving as a request the designer can
  accept or send back. The scene is already a document in Postgres with autosave
  and a refused-on-conflict revision, so this is a second writer against an
  existing lock, not a rewrite of how state works.
- **A brand kit the design agent has to obey.** Right now the direction comes off
  one form: purpose, palette, vibe, size. A studio should upload its logo, its
  fonts and its colours once and have every page honour them. Skills are already
  written files returned whole with no model call, so a brand kit rides the same
  door: a constraint the agent reads, not a prompt it can drift off.
- **Skills the user writes.** The 37 occupations and 17 foundations are mine.
  A wedding studio's house rules, a brand's editorial standards, an agency's
  layout habits: those belong in files their owners write and drop in. Nothing
  about the retrieval path changes, which is the point.
- **Export that leaves the app.** A deck is one slide per page today. Next is PDF
  and PNG at print resolution off the same server-side renderer the vision loop
  already calls every round, plus the slide click that currently does nothing
  jumping back to Design on that page.
- **More of the image editor on the same seam.** Crop, turn, flip and a five-knob
  grade ship now. Masking, background removal and generative fill are the same
  shape of work: a model that proposes a region, code that validates it, `sharp`
  or the image model that does the cutting, and a version linked to its original
  rather than an overwrite. One function, both doors, as it is now.
- **Grading the pages, not the prompts.** `design:check` and `render:check` catch
  a broken render. They do not tell me whether round three of the design loop
  produced a better page than round two. A scored set of briefs, run on every
  prompt change, is what turns "this feels better" into a number. It is the piece
  I most want and the one I had the least time for.

Further out: motion. Every page is real geometry with a stacking order, which is
most of what an animated version of the same page needs.

## License

Vibes is released under the [MIT License](LICENSE).

### Third-party components

The hackathon rules permit open source *provided the entrant complies with the
applicable open source licenses*. That compliance is generated, not asserted:
`npm run licenses:notice` walks the installed production tree and writes the
attribution from what is actually there. It runs before `dev`, `build` and
`test`, so the notice cannot drift from what ships.

| Where | What |
| --- | --- |
| `/licenses` | Public page — every package and font, grouped by licence |
| `/NOTICE.txt` | Every copyright notice and licence text, in full |
| `web-app/licenses/fonts/` | The nine font licences, committed by hand |
| `web-app/licenses/models/` | The open-weight model terms, committed by hand |

**465 npm packages across 13 licences** — MIT, ISC, Apache-2.0, BSD-2- and
BSD-3-Clause, MPL-2.0, LGPL-3.0, CC-BY-4.0, CC0-1.0, Python-2.0, 0BSD, Unlicense
and one `MIT AND Zlib`. Nothing resolves to an unknown licence, and the
generator throws rather than ship a component it cannot attribute.

**Nine font families are served from this origin**, which is redistribution, so
each carries its licence text beside it. Seven are mirrored out of Excalidraw —
which ships no licence files of its own, so they are authored here — and
`Assistant` and `Geist` are bundled into the build by Excalidraw's CSS and
`next/font/google`. Liberation Sans 1.05 is GPLv2 with the font exception; the
exception is precisely what lets an application embed it, and it is satisfied by
shipping the licence text and a source pointer.

**One model is open-weight, not open source.** Agent 2 runs
`gemma-4-26b-a4b-it-maas` under the [Gemma Terms of
Use](https://ai.google.dev/gemma/terms) — a custom Google licence carrying use
restrictions, not an OSI-approved one. The generator cannot see it, because the
app redistributes no weights: it calls a hosted Vertex endpoint, so the terms
bind use rather than distribution and there is nothing in the bundle to
attribute. `web-app/licenses/models/` records that obligation by hand, the way
the font licences are.

**Two upstream projects carry reciprocal terms** — `resvg-js` (MPL-2.0) and
`libvips`, which `sharp` ships prebuilt (LGPL-3.0-or-later). The notice makes a
written offer of source for all three package entries they install, platform
binaries included. `dompurify` is dual-licensed `MPL-2.0 OR Apache-2.0`;
Apache-2.0 is elected, so MPL's source-disclosure obligation never applies.
