# Vibes AI
**Open source AI-first design platform. Visual communication makes easier.**

## From Idea to Impact

### The Problem - Design takes time and skills. Most people don't have both.

Good design takes two things: time and skill.

Designers have the skill, but not unlimited time. They can't explore every idea, make endless variations, and iterate on every request.

Clients and managers often have the opposite problem. They know what they want, but don't have the skills to turn that idea into a design. They can say “make it modern” or “something like this”, but can't easily show what they mean.

So the problem isn't just that design takes a long time. It's that the people with the time and skills are rarely the same people.

The evidence:

- **Design eats hours.** Non-designers who create their own branding spend around **9–10 hours a week** on design work.

- **Iteration is expensive.** **88% of designers** report that a new design takes at least **3 revisions**, while **42%** say it takes 6 or more.

- **Designers spend a lot of time on small changes.** Nearly **65% of designers** spend at least half their week making small tweaks and customisations.

- **Design is a specialised skill.** Even learning the basics of Figma can take **40+ hours**, before becoming genuinely proficient.


### The Solution - a Designer Co-Pilot that automates, designs & iterates quickly on user's behalf

**Vibes AI** is a Designer Co-Pilot that lets designers and clients iterate on designs together, without the usual time and skill constraints.

Clients can describe changes in natural language — “make it warmer,” “try a different layout,” “make it more premium” — and see the result instantly.

Designers can generate multiple variations and explore different directions without manually creating every version.

The core insight: **Vibes AI** gives both sides what they're missing — clients get design skills, designers get more time.

Design more. Iterate faster. Communicate better.

<!-- TODO: replace with the real links before submitting -->
[**▶ 4-min demo**](TODO-youtube-url) · [**🔗 Live app**](TODO-live-url) · [**🏗 Architecture**](#architecture) · [**⚡ Quick start**](#quick-start)

Built for the **All Things Agentic Hackathon** — category **Taskmaster**.

`gemini-3.7-flash` · `gemini-3-pro-image` · `gemma-4-26b-a4b-it-maas` (open-weight) · Gen AI SDK (Vertex mode) · Cloud SQL · Cloud Storage · Cloud Scheduler

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


## Quick start

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
| Gemini 3.5 or newer | `gemini-3.7-flash` on the four reasoning agents (orchestrator, image editor, placer, designer), via Gemini API on Vertex. The rule is mandatory, not exclusive — agent 2 runs the open-weight `gemma-4-26b-a4b-it-maas` alongside it, on the same Vertex endpoint | `src/server/google/model-floor.test.mts` — asserts the analyzer is on `GEMMA` **and** that `FLASH` still serves the reasoning agents |
| A Google agent framework | `@google/genai` — the Gen AI SDK for TypeScript, in Vertex mode; every model call goes through it | `src/server/google/sdk-boundary.test.mts` |
| A Google Cloud infra service | **Cloud SQL** (Node connector) **and Cloud Storage** (v4 signed URLs), plus Cloud Scheduler for the analyzer queue | `src/server/google/cloud-sql.test.mts`, `storage.test.mts` |

Model IDs are pinned in one place so a mid-event rename is a one-line fix:

| Alias | Model ID | Used by |
|---|---|---|
| `FLASH` | `gemini-3.7-flash` | agents 3, 4, 6, 8 — the reasoning text and vision agents |
| `GEMMA` | `gemma-4-26b-a4b-it-maas` | agent 2 — open-weight, served managed on Vertex |
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

## Challenges

### Architecture and design challenges

- **A live agent turn is minutes long, not milliseconds.** One chat message can
  open up to `MAX_TOOL_ROUNDS = 100` rounds of tool calling, and the reply is
  streamed while it runs — `orchestrator.send` is a tRPC mutation that returns an
  async generator, so steps appear as they happen instead of after a spinner. The
  turn is then persisted in `after()`, *past* the last byte of the response.
  **Cloud Run is what makes that shape legal.** `--timeout=3600` gives the request
  room (routes cap themselves at `maxDuration = 800`), and `--no-cpu-throttling`
  is the load-bearing flag: without CPU allocated between requests, the `after()`
  write would freeze the moment the response closed and the turn would be lost on
  the way to the database. `--concurrency=30` because an agent turn is I/O-bound
  on Gemini — one instance holds thirty of them — and `--min-instances=0` means
  an idle judging night costs nothing. On a 30-second serverless cap this whole
  design would have had to become polling.

- **The unattended run outlives every request that could carry it.** "Let's
  Vibes" is up to 4 briefs × 3 takes, each page a 12-round design loop with
  vision in it — tens of minutes, with nobody watching. One long request is the
  obvious answer and the wrong one: it fails once and loses everything.
  **The queue is the `AgentRun` table** — no Pub/Sub, no Cloud Tasks, one thing
  to poll and one thing to audit — and **Cloud Scheduler is the heartbeat.**
  `vibes-worker` and `analyzer-worker` are hit every minute with a bearer secret
  out of Secret Manager (attempt deadline 1800s and 600s). A tick claims *one*
  job by compare-and-swap on `(id, status, startedAt)`, runs it, and writes the
  outcome and the next page's job **in the same transaction**, so the chain
  cannot half-advance. `VIBES_LEASE_MS = 20min` makes a dead instance's job
  re-claimable rather than stuck. When the queue isn't drained the worker
  self-kicks through `after()`, so pages chain in seconds and the next tick is
  only ever the floor. **The Gen AI SDK carries the rest**: the client is
  configured with `retryOptions` — five attempts over 408/429/500/502/503/504 —
  plus a wrapper for the throttle that arrives as a `404` with an HTML body
  rather than a `429`. That is the difference between an unattended run that
  survives a burst and one that dies at page four.

- **The model has to *see* like a director, cheaply enough to look every round.**
  The four reasoning text and vision agents run on `gemini-3.7-flash`, and the
  choice is economic as much as qualitative: the design agent looks at its own
  page after every change, up to `DESIGNER_PICTURE_LIMIT = 8` pictures per page,
  and on a pro-priced model that loop *is* the budget. Flash is good enough to
  hold up under both remaining visual jobs — a detection box tight enough to cut
  on, and a judgement about a headline sitting over a dark frame.
  **The analyzer proves the seam is real.** Agent 2 is the one job that fits an
  open model — single-shot, no tool loop, no streaming, an image in and a
  fixed-vocabulary record out — so it runs `gemma-4-26b-a4b-it-maas`, open-weight
  and served managed on the same Vertex endpoint. Swapping it took two lines:
  the model alias at the call, and a price. Nothing else in the app noticed,
  which is the point of pinning the seam rather than the provider.
  **Structured output does the discipline**: `responseSchema`
  gives each analyzer dimension an `enum` of the fixed vocabulary, so tags group
  instead of drifting because the API enforces the list, not because the prompt
  asks nicely — and Gemma honours it on Vertex exactly as Flash did. Detection comes back as `box_2d` — normalized 0–1000, y-first,
  the format it was trained on — and is then validated in code (min < max, inside
  the frame, aspect within tolerance) across three attempts. The model proposes;
  `sharp` cuts.

- **The agent had to land inside a design tool, not beside one.** The output of a
  design agent is usually a picture of a design. Here every placement is a real
  element in the Excalidraw scene — the user drags it afterwards — which means
  the agent's whole vocabulary is a tool contract over live geometry — the
  orchestrator's 19 declarations and the design agent's own 21 (`npm run floor`
  prints both), `put_on_canvas` / `transform_on_canvas` /
  `restyle_on_canvas` / `reorder_on_canvas`, boxes in thousandths of the page and
  y-first so the canvas speaks the same coordinate dialect as `box_2d`.
  **The Gen AI SDK is the single seam that makes that tractable**: one
  `GoogleGenAI` client in Vertex mode (`enterprise: true`) for declarations,
  streaming, function-call parsing and usage accounting, with one credential
  reaching Gemini, GCS and Cloud SQL. It is enforced, not assumed —
  `sdk-boundary.test.mts` fails the build if a model call escapes onto raw REST.
  Typography goes the same way: a family named in a tool call is resolved live
  against the Google Fonts metadata API and downloaded as a TTF the rasteriser
  actually draws with, so "set it in Playfair Display" is that face in the file
  rather than a fallback.

- **Giving the agent eyes on its own work.** A design agent that cannot see its
  page is guessing, and it guesses worst about exactly what matters — a headline
  over a dark photograph, a page whose bottom third is empty. So `get_page`
  rasterises the page server-side on the call: `RenderPlan` → SVG →
  `@resvg/resvg-js` → `sharp` composite, with the real font files, then the PNG
  goes to **Cloud Storage** and the model is handed a `fileData` part carrying the
  `gs://` URI. **Google Cloud makes this cheap in both directions**: Gemini fetches
  the object from GCS itself, so bytes are never base64'd through a context window
  or a serverless body limit — the same reason uploads go browser → bucket on a v4
  signed URL and every agent only ever gets a reference. The render is
  content-addressed — `renders/<dialect>/pages/<pageId>@<revision>.png` — so a
  second look at an unchanged page is an object `head`, not a re-render, and
  changing the renderer's arithmetic changes `MODEL_RENDER_DIALECT` and
  invalidates every stale picture at once. A bucket lifecycle rule drops
  `renders/` after 7 days so the cache never becomes a bill. The picture is not
  the whole answer either: the same read yields the page **in words** — every
  block as `[ymin, xmin, ymax, xmax]`, stacking order, overflow marks — plus a
  band-occupancy read and a contrast read. Both halves come off one read of the
  scene, so they can never describe different pages, and if the 8-second render
  times out the answer *says so* instead of letting the model narrate a page it
  was never shown.

- **Paying for a picture once instead of once per round.** The transcript is the
  context: a picture returned at round 3 is re-sent on rounds 4 through 12, so a
  twelve-round turn that looked four times pays for those four pictures around
  forty times between them. Worse, it is invisible — a `fileData` part is a URI,
  a few dozen characters on the wire and thousands of tokens once Google has
  fetched and tiled it, so the character-budget window that keeps text costs down
  cannot see the thing that dominates the bill. **Hence two windows, not one.**
  `pictureWindow` keeps an image part for `PICTURE_WINDOW = 5` rounds, then
  replaces it *in place* with a line naming the call that returned it and saying
  the same call brings it back — silent removal was measurably worse, because a
  model still answering about a picture it can no longer see reads as bad taste
  rather than as a missing part. On top of that, **dedupe**: pictures are keyed by
  `fileUri`, which in this system *is* identity — the same page at the same
  revision is the same object, a changed page is a different one — so a page that
  was read, worked on and read again arrives twice and the second copy becomes a
  note pointing at the first. The pass runs newest-first, so the surviving copy is
  the one nearest the answer the model is about to give. That dedupe is what paid
  for the window going from two rounds to five: the agent can now compare a page
  against how it looked four steps ago, and the request stopped growing anyway.

### Learning the Google Gen AI SDK / Vertex AI (the expected unknowns)

- **Vertex mode is chosen at client construction, not per call** — `enterprise:
  true` plus `project` and `location` in `GoogleGenAIOptions`. The Developer API
  *refuses* `project` and `location`, so the two backends need disjoint option
  shapes rather than one shape with extra fields.
- **`gs://` URIs are a Vertex-only privilege** — every picture here reaches the
  model as a `fileData` gs:// URI. Under the Developer API those are unreadable
  and each image has to be re-uploaded to the Files API and referred to by *its*
  URI. That resolver got built, then deleted: putting local development on Vertex
  against a real dev bucket was cheaper than keeping two identities for one image.
- **`GOOGLE_CLOUD_LOCATION` is `global`, not a region** — the models are served
  from the global endpoint; a regional host `404`s them. The API host is derived
  from that variable for exactly this reason.
- **Throttling arrives as a `404` with an HTML body, not a `429`** — no
  retryable-status list catches it. Discrimination is "status 404 and the body
  starts with `<`", and both transports had to be made to agree on that rule.
- **The SDK does not back off unless handed a ladder** — deleting
  `httpOptions.retryOptions` left the whole test suite green and silently removed
  every retry. It is now explicit (`attempts: 5` over 408/429/500/502/503/504)
  and pinned by `retry-ladder.test.mts`.
- **A tool-response turn may not *end* with a picture** — appending images after
  their `functionResponse` comes back `400 "Requests ending with a model turn are
  not supported"`, which names the wrong thing entirely. `[picture, response]`
  and `[response, picture, response]` are both accepted; `[response, picture]` is
  not. Related: a `functionResponse` whose `functionCall` was windowed out is
  refused, so history trimming drops whole call/response pairs or nothing.
- **`usageMetadata` repeats across stream chunks, partially** — several chunks
  carry one, and taking the last (or summing them) misprices the call. The right
  read is the chunk with the largest `totalTokenCount`.
- **A stream that has already emitted cannot be retried** — once parts have gone
  to the watcher the user has seen them, so `streamRetried` only reconnects while
  nothing has been handed out. After that a throttle is an error, not a retry.
- **Implicit caching is on, and it is invisible in the bill you compute yourself**
  — a probed orchestrator round showed 10,919 of 13,234 prompt tokens as
  `cachedContentTokenCount`, which is a *part of* `promptTokenCount` rather than a
  fifth number to add. The in-code cost model was reading its rows as an invoice;
  they are a ceiling.
- **`box_2d` is `[ymin, xmin, ymax, xmax]` normalized 0–1000, y-first** — asking
  for `x/y/width/height` or corner pairs fights the training and measurably
  degrades the boxes. Convert to pixels in code instead.
- **`imageConfig.aspectRatio` takes ten native canvases and no others** — an
  asked-for shape has to land on the nearest by *log proportion*, not by numeric
  difference, or a 9:16 request comes back on a landscape canvas.
- **Three model failures that look alike and need different answers** —
  `promptFeedback.blockReason` is the prompt refused before generation (a retry
  sends the same words to the same reader, so it is answered once, not retried);
  an empty candidate carries a `finishReason` where only `MALFORMED_FUNCTION_CALL`
  is worth retrying; a transport failure is read off the thrown value after backoff
  is already spent.

## Accomplishments

- **A multimodal agent team that ships pixels, not prose.** A brief and a folder
  of photographs go in; finished, editable pages come out — every upload read in
  six design dimensions, real crops cut, the missing picture drawn, and type,
  colour fields and images written as geometry the user can drag afterwards.
  `gemini-3.7-flash` reasons and sees on the four agents that route, cut and
  design; `gemini-3-pro-image` draws what the gallery does not have; and the
  analyzer runs on open-weight `gemma-4-26b-a4b-it-maas` — a different model
  family, same Vertex endpoint, same SDK, no second client.
- **Five agents, one voice.** The orchestrator holds the analyzer, image editor,
  image generator and design assistant as `AgentTool`s — 19 declarations of its
  own, 21 inside the design agent — so every hop is request/response and the user
  reads one reply, never a transcript of agents talking. All of it runs through a
  single Gen AI SDK client in Vertex mode, and `sdk-boundary.test.mts` fails the
  build if a model call escapes it.
- **A grounding layer that gives the agent eyes.** Every round, the page is
  rasterised server-side, written to **Cloud Storage**, and handed back as a
  `gs://` `fileData` part that Gemini fetches itself — no bytes through the
  context window. The picture ships with the same page *in words* — every block
  boxed, stacking order, overflow marks, band occupancy, text-on-background
  contrast — both off one read of the scene, so they cannot disagree. If the
  render fails the answer says so, rather than letting the model narrate a page it
  was never shown. Renders are content-addressed per revision, so a second look is
  an object `head`, not a re-render.
- **Deployed, live, and running on Google Cloud.** **Cloud Run** (gen2, 2 vCPU /
  2 GiB, 3600s timeout, concurrency 30, scale-to-zero) serving at
  <https://vibes-ai-zh4xc7b2qa-uc.a.run.app>; **Cloud SQL** PostgreSQL 18 over the
  Node connector, no IP allowlist; **Cloud Storage** for originals, crops,
  generated images and renders, signed both ways; **Cloud Scheduler** ticking the
  two queue workers every minute; **Secret Manager** for every credential;
  **Cloud Build** → **Artifact Registry** for the image, on a cleanup policy.
- **Zero-click, end to end.** One form — purpose, pages, palette, vibe, size — and
  up to 4 briefs × 3 takes go out as `AgentRun` jobs that Cloud Scheduler drives
  to completion with nobody watching. Each page is a bounded unit of work, so a
  failure at page four keeps pages one to three, Stop means stop, and progress is
  derived from the board rather than recorded, so a closed tab resumes instead of
  losing the run.
- **Held down by tests, not by prose.** 201 test files and 3,553 assertions run
  with no cloud credentials and no database, because every agent's loop is
  separable from its executor. The eligibility claims are executable too:
  `npm run floor` proves live that every agent sits on a model ≥ 3.5.

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
