# Vibes AI
AI-first design platform. Visual communication makes easier.

## From Idea to Impact

### The Problem - Design takes time and skills. Effective visual communication is impossible for non-creative individuals.

Almost everyone can tell good design from bad. Almost nobody can produce it. The gap between those two facts is a translation problem: the idea is already in your head, and every tool that could realize it demands you first restate it in a language you don't speak — layers, masks, type scales, grids, auto-layout. So the founder who can describe her brand in one sentence cannot build its identity. The project manager who knows exactly what's wrong with the homepage writes "make it feel more premium" and waits three rounds to find out it wasn't that. And the designer — the one person who *does* speak the language — has ten ideas and hours for two.

The evidence:

- **Fluency is priced in months, not minutes** — professional proficiency in Figma takes 100–200 hours of deliberate practice; Photoshop's everyday tools take a beginner two to three months. That is the toll before a first idea ever leaves your head
- **"That's not what I meant" is the default outcome, not the exception** — first-draft accuracy sits near 30% and the average brief runs four revision rounds. The idea was fine; putting it into words was the lossy step
- **Most people route around the skill curve instead of climbing it** — 84% of small businesses make their marketing graphics in template tools, and 67% of companies that use no design at all say they would if there were a quicker, cheaper way to get it
- **Hiring a designer moves the gap, it doesn't close it** — $45–$85/hr for a mid-level freelancer, and you still have to get the idea out of your head and into theirs. Well-briefed projects are 3× more likely to land within two rounds, which is another way of saying the brief is the hard part, not the drawing
- **Even the fluent run out of hours** — 62% of a designer's workday goes to manual, repetitive production: resizing, reformatting, removing backgrounds, chasing approvals. Their ideas queue behind their own execution

One shape underneath all of it: an idea exists, and there is no cheap path from it
to a picture. The tool charges you skill, the freelancer charges you a brief, and
both are the same toll — translate what's in your head into a language that isn't
yours before anything gets made. That is exactly the work an agent that can *see
the page it is making* can absorb: you say what the board is for, in your own
words, once.

### The Solution - a Deisgner Co-Pilot that automates 

**Say what the board is for. Walk away. Come back to a finished board.**
"A six-page wedding welcome set, warm and filmic" is one form. Six agents then
read your photographs, cut them, invent the pictures your gallery doesn't have,
and design every page — one at a time, without you.

<!-- TODO: replace with the real links before submitting -->
[**▶ 4-min demo**](TODO-youtube-url) · [**🔗 Live app**](TODO-live-url) · [**🏗 Architecture**](#architecture) · [**⚡ Quick start**](#quick-start)

Built for the **All Things Agentic Hackathon** — category **Taskmaster**.

`gemini-3.7-flash` · `gemini-3-pro-image` · Gen AI SDK (Vertex mode) · Cloud SQL · Cloud Storage · Cloud Scheduler

<!-- TODO: hero GIF — the unattended run, not the chat. Fill the "Let's Vibes" form,
     then time-lapse six blank pages filling themselves in. ~15s, no narration. -->
![Vibes](docs/hero.gif)

---

## The friction — Bring Your Own

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

## Architecture

```mermaid
flowchart TB
    U([User]) -->|drag & drop| B[Browser workspace<br/>Next.js 16 · React 19]
    U -->|"Let's Vibes brief<br/>purpose · pages · palette · vibe"| LOOP[Unattended run<br/>one bounded call per page<br/>resumable · stoppable]
    LOOP -->|"designed · empty · refused"| A8
    B -->|v4 signed PUT<br/>bytes never touch a function| GCS[(Cloud Storage<br/>originals · crops · renders)]
    B <-->|tRPC| S[Agent tier<br/>src/server/agents]

    S -->|6 Orchestrator · FLASH| O{{AgentTool routing}}
    O --> A2[2 · Property analyzer<br/>FLASH vision + schema]
    O --> A3[3 · Cropper<br/>FLASH + sharp]
    O --> A4[4 · Compositor<br/>FLASH + deterministic layouts]
    O --> A7[7 · Image generator<br/>IMAGE]
    O --> A8[8 · Design assistant<br/>FLASH vision + tool loop]
    A8 --> SK[Skills<br/>13 files, no model call]

    A2 & A3 & A4 & A7 & A8 -->|Gen AI SDK · Vertex mode| V[[Gemini Enterprise<br/>Agent Platform]]
    A3 & A7 & A8 --> GCS
    S <-->|Node connector, no IP allowlist| SQL[(Cloud SQL<br/>PostgreSQL 18)]
    SCH[Cloud Scheduler] -->|claims QUEUED AgentRun| A2
```

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
| 2 | Property analyzer | `FLASH` | image → six structured design dimensions | `src/server/agents/analyzer/analyzer.ts` |
| 3 | Cropper | `FLASH` + `sharp` | image + intention + ratio → `box_2d` → cut version | `src/server/agents/cropper/cropper.ts` |
| 4 | Moodboard compositor | — *(retired)* | blocks + layout → slot assignments | `src/server/agents/deprecated/compositor.ts` |
| 6 | Orchestrator | `FLASH` | user message → tool routing → one reply | `src/server/agents/orchestrator/orchestrator.ts` |
| 7 | Image generator | `IMAGE` | description + shape → generated bytes | `src/server/agents/image-generator/image-generator.ts` |
| 8 | Design assistant | `FLASH` vision | intention → a tool loop that *sees* its own page | `src/server/agents/designer/` |

**4 is retired.** It laid a page out by assigning the orchestrator's blocks to
the slots of a template chosen before the call — one text-only model call, with
deterministic code drawing the pixels. Agent 8 does the same job by judgement,
with its own eyes on the page it is making and no template to fit, so there is
no ask agent 4 answered that agent 8 does not answer better. `compose_moodboard`
is declared to nobody and dispatched by nothing; the files are kept unmodified
under `deprecated/` as the record of what a template-shaped compositor had to be
told. A board now comes from `add_board`, which is code and decides nothing, and
everything that goes on its pages comes from `design_page`.

Numbering follows the product spec, and **5 is missing on purpose**: deck export
is not an agent. A board's pages have already made every judgement a deck could
make — which references, which crop, where, in what order — so turning a board
into slides is a mapping (one slide per page, in reading order) and lives in
`src/server/decks/`, with a test asserting no model function is reachable from
it. Slot numbers are kept rather than renumbered because the code and commit
history refer to agents by them.

### Where state lives

| State | Home | Why there |
|---|---|---|
| Image bytes — originals, crops, generated, renders | Cloud Storage, uniform access | Signed URLs both ways; nothing publicly listable |
| Projects, references, boards, pages, conversations | Cloud SQL for PostgreSQL 18 | Relational, and versions are edges. A project holds *many* conversations, one open at a time |
| Agent job queue | The `AgentRun` table | The queue *is* the run log — one thing to poll, one thing to audit |
| Canvas scenes | Postgres JSON, autosaved | The board is a document, not an event stream |
| Which chat a project is open on | `localStorage`, one entry, per project | Which thread is on screen is a property of the *window*, not the project — two tabs would write a column against each other |
| **Run progress** | **Nowhere — derived from the board** | A second account of the same fact goes stale; the scene can't |

That last row is the load-bearing one for a long-running job. An unattended run
needs to know where it got to, and the obvious answer — a progress record,
updated after each page — is wrong here: it drifts the moment a user deletes a
page by hand. Asking the board "is anything on this page?" cannot drift, because
being on the page *is* what the question means.

## Google Cloud & Gemini

The hackathon requires three things. Each is met, and each is **held down by a
test**, not by this paragraph:

| Requirement | Met by | Enforced by |
|---|---|---|
| Gemini 3.5 or newer | `gemini-3.7-flash` on all five text/vision agents, via Gemini API on Vertex | `src/server/google/model-floor.test.mts` |
| A Google agent framework | `@google/genai` — the Gen AI SDK for TypeScript, in Vertex mode; every model call goes through it | `src/server/google/sdk-boundary.test.mts` |
| A Google Cloud infra service | **Cloud SQL** (Node connector) **and Cloud Storage** (v4 signed URLs), plus Cloud Scheduler for the analyzer queue | `src/server/google/cloud-sql.test.mts`, `storage.test.mts` |

Model IDs are pinned in one place so a mid-event rename is a one-line fix:

| Alias | Model ID | Used by |
|---|---|---|
| `FLASH` | `gemini-3.7-flash` | agents 2, 3, 4, 6, 8 — every text and vision agent |
| `IMAGE` | `gemini-3-pro-image` | agent 7 |
| `PRO` | `gemini-3.1-pro-preview` | **nothing** — 3.1 is below the 3.5 floor, so it stays declared and priced but uncalled |

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

## Quick start

### Prerequisites

- Node 20+, npm
- A Google Cloud project with billing
- Docker (local Postgres only — the deployed app doesn't need it)
- `gcloud` CLI, and [`cloud-sql-proxy`](https://cloud.google.com/sql/docs/postgres/sql-proxy) for migrations

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

### 3. Configure

```sh
git clone https://github.com/minhthanhdang/vibes-ai.git
cd vibes-ai/web-app
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Var | Value |
|---|---|
| `CLOUD_SQL_INSTANCE` | `your-project:us-central1:vibes-ai-pg` |
| `CLOUD_SQL_USER` / `_PASSWORD` / `_DATABASE` | `vibes_app` / the generated password / `vibes_ai` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | whole key JSON, on one line |
| `GOOGLE_CLOUD_PROJECT` | your project id |
| `GOOGLE_CLOUD_LOCATION` | `global` — **not** a region; the models are only served there |
| `GOOGLE_GENAI_USE_ENTERPRISE` | `1` |
| `GCS_BUCKET` | `your-project-artifacts` |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | see below |
| `APP_URL` | `http://localhost:12000` |
| `ANALYZER_WORKER_SECRET` | `openssl rand -hex 24` |
| `DATABASE_URL` | Prisma CLI's channel only — local Docker or a proxy |

**The OAuth client must be made by hand.** No `gcloud` command mints a
"Sign in with Google" web client. In the Console: [Auth Platform → Branding]
(https://console.cloud.google.com/auth/branding) (audience **External**), then
[→ Clients](https://console.cloud.google.com/auth/clients) → **Create client** →
**Web application**. Authorized redirect URI must equal `${APP_URL}/api/auth/google/callback`
*exactly*, scheme included — Google compares the string, not the host.

### 4. Migrate the schema

The Prisma CLI cannot use the Cloud SQL connector — `migrate` and `studio` open
ordinary TCP. Bridge with the Auth Proxy:

```sh
# terminal 1
cloud-sql-proxy $P:$R:vibes-ai-pg --port 5432

# terminal 2
DATABASE_URL="postgresql://vibes_app:$PGPASS@127.0.0.1:5432/vibes_ai" \
  npm run db:deploy
```

The running app needs none of this — it reaches Cloud SQL through
`@google-cloud/cloud-sql-connector` with no host, port or IP allowlist.

### 5. Run

```sh
npm run dev        # http://localhost:12000
npm test           # 151 test files
npm run typecheck
npm run floor      # prove every agent is on a model ≥ 3.5, live
npm run smoke      # end-to-end against real Gemini + GCS + Cloud SQL
```

### 6. Deploy

<!-- TODO: replace with the real deploy path once decided — see note below. -->

```sh
# TODO
```

> **Note on hosting.** The web tier currently deploys to Vercel while all state,
> storage, scheduling and inference stay on Google Cloud. See
> [`docs/deployment.md`](docs/deployment.md) for the Cloud Run path.

### Ports

| | Port |
|---|---|
| Next dev server | 12000 |
| Local Postgres (Docker) | 12001 |

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

## What I learned

<!-- TODO: 4–6 bullets, first person, specific. Candidates from the build log: -->
- Gemini's trained detection format is `box_2d = [y_min, x_min, y_max, x_max]`
  normalized 0–1000, y-first. Asking for `x/y/width/height` or four corners fights
  the training and measurably degrades accuracy — convert to pixels in code
  instead.
- `config.imageConfig.aspectRatio` is a live field on the image model. Ten
  canvases are native; an asked-for shape should land on the nearest *by
  proportion*, not by numeric difference, or a portrait request lands on a
  landscape canvas.
- Burst throttling on the model endpoint surfaces as a `404`, not a `429`.
- **The hardest part of a long-running agent job is not running it, it is knowing
  where it got to.** My first instinct was a progress record updated after each
  page. It was wrong: it went stale the first time I deleted a page by hand.
  Deriving progress from the artifact itself — "is anything on this page?" — made
  resume, Stop, and partial failure all fall out for free.
- **Bounded work beats one long request.** Six mutations instead of one gave me
  honest progress, a Stop button that means it, and a failure at page four that
  keeps pages one to three. One request would have given none of those.
- A document that isn't in git isn't a document. <!-- TODO: keep or cut -->

## License

<!-- TODO -->
