# PRD — Multi-Vibes (batched, worker-driven) and the Preview tab

Written 2026-08-28, from a read of the code at `6d588ce` and the specs it cites.
Two features, decided with the user before writing:

1. **Multi-Vibes.** "Let's Vibes" grows from one form → one board into one or
   many forms → one or many boards. Each form carries a **designs** count: a
   form asking for 3 designs makes **3 separate boards** from the same brief,
   each an independent creative take. The whole batch runs as **jobs a worker
   picks up** — the browser-driven loop goes away entirely. A closed tab no
   longer stops a run.
2. **Preview tab**, beside Gallery and Design. Bottom: a slide-carousel board
   picker. Main view: a carousel of that board's pages. A floating left rail
   reorders the pages. The order is **preview-only** — a stored list on the
   board that Preview and the deck export honor, and the canvas never moves.

Feature 2 depends on nothing in feature 1; the stages interleave freely except
where marked.

Read first: `compositor-v2.md` §IX (the whole current Vibes design — this PRD
supersedes its §IX.2 execution model), `infra.md` §XIII (the analyzer queue —
the pattern the vibes queue copies), `canvas.md` §V.5 / `lib/pages/board-pages.ts`
(what a page is, and reading order), `vibes.prompt.md` (how the current build
landed).

Work in `web-app/`. Paths below are `web-app/src/`-relative unless they start
with `prisma/` or `scripts/`.

---

## Part I — What exists, and what moves

### The current Vibes execution, in one paragraph

`vibes.start` (no model call) creates one board titled from the purpose, N
empty pages painted with the theme colour, a fresh `Conversation` with one user
row, and stores the brief on `Moodboard.vibesBrief`. *(2026-08-29: two of those
three are gone — the pages arrive unpainted and the run keeps no conversation.
`compositor-v2.md` §IX.2 carries both amendments. The brief on the board is what
is left, and it is the whole record of the ask.)* The **browser** then
drives `vibes.designPage { boardId, pageId, index }` one page at a time from
`VibesRunPanel` (`_main-viewport/_design/_vibes/components/vibes-run-panel.tsx`),
each a live streaming tRPC mutation held open by `after()` under
`maxDuration = 300`. A refusal stops the walk; a closed tab stops everything,
which is why `vibes.resume` exists. Loop state is pure
(`lib/vibes/vibes-loop.ts`), announced across the editor unmount by an event
bus (`_events/vibes-run.ts`).

### The queue pattern already in the house

The analyzer (agent 2) queues through the **`AgentRun` table itself** — no
second job store (`server/agents/analyzer/analysis-queue.ts`):

- `enqueueAnalysis(client, …)` files a `QUEUED` row inside the caller's
  transaction (takes `Pick<PrismaClient,"agentRun">` for exactly that reason).
- `claimAnalyzerRun` claims by compare-and-set: `updateMany` guarded on
  `{ id, status, startedAt }`, winner takes `RUNNING` with a fresh
  `startedAt`. Stuck `RUNNING` rows past a 10-minute lease are reclaimable.
- Two drains: an `after()` **kick** (one job, spent from the request that
  enqueued), and a **Cloud Scheduler** cron hitting
  `POST /api/agents/analyzer/worker` every minute, bearer-secret gated
  (unset → 503, wrong → 404, `timingSafeEqual`).
- Pure rules live in `lib/analysis/analyzer-queue.ts`; the claim/drain in
  `server/agents/analyzer/analyzer-worker.ts` with db and model injected.

The vibes queue copies this shape file for file. Deviations are called out
below and each has a reason.

### What a "page order" is today

There is no order column anywhere. A page is a `frame` element carrying
`customData.page` inside `Moodboard.elements`; order is derived geometrically
by `pagesInReadingOrder` (`lib/pages/board-pages.ts:193`) — banded rows, then
left-to-right. Every consumer (vibes "page 3 of 6", the presenter's one slide
per page, `moodboard.pages`) reads that. The Preview order is deliberately
**not** this: it is a second, stored ordering that only Preview and the deck
export read, and it must be built so the two orderings can disagree without
anything breaking.

---

## Part II — Multi-Vibes

### II.1 The data model

One migration, two changes (plus Part III's column — land them together,
§II.9):

```prisma
enum AgentKind {
  // …existing…
  VIBES        // a queued page-design job. Not DESIGNER: agent 8 writes its
               // own DESIGNER run row per design; the VIBES row is the queue
               // ticket that asked for it, and the two must not be confused
               // by any query that counts either.
}
```

The queue **is** the `AgentRun` table, same as the analyzer. A `VIBES` row:

| column | value |
|---|---|
| `agent` | `VIBES` |
| `status` | `QUEUED → RUNNING → SUCCEEDED/FAILED` |
| `projectId` | the project — the worker has no session, so ownership rides here |
| `input` | `{ boardId, pageId, index }` — exactly `vibes.designPage`'s arguments today |
| `output` | `{ outcome }` on settle — `designed`, `empty`, or `refused` with its reason |
| `startedAt` | doubles as the lease stamp, same as the analyzer |

No new table, no `batchId`. A batch is reconstructable — every board a batch
made carries `vibesBrief`, and the progress query (§II.6) groups live rows by
board — and a batch id would be a row about a moment rather than about a thing.

### II.2 Chaining: pages of one board run in order, boards run independently

The coherence clause (§IX.3) only works if page N+1 is designed after page N
exists on the board. The queue must preserve that without a scheduler that
understands dependencies. The mechanism is **chain-enqueue**:

- `vibes.startBatch` enqueues **only page 1** of each board.
- When the worker settles a page (`designed` or `empty`), it enqueues the next
  page of that board in the same transaction as the settle — or nothing, if
  the page was the board's last.
- A **refusal does not extend the chain.** Whatever refused page 4 is almost
  always still true for page 5 (§IX.2's argument, unchanged); the resume door
  is how the rest is picked up once the reason is gone.
- A **`FAILED`** job (an exception, not a refusal) also ends the chain; the
  resume door covers it identically.

Consequences worth stating:

- Boards never wait on each other. A batch of 4 boards is 4 chain heads, and
  concurrent worker invocations (§II.5) claim different heads — cross-board
  parallelism is natural and bounded by the number of boards still running.
- Within a board, sequence is structural: page N+1's job does not exist until
  page N settled. No claim-time dependency check, no racey "lowest unsettled
  index" query.
- If the worker dies between finishing a design and settling the row, the
  lease reclaim hands the same job out again. `runVibesPage` therefore checks
  `vibesPageDesigned` first and settles as already-designed without a model
  call (§II.4) — the same read `vibesPending` already trusts.

### II.3 `vibes.startBatch`

New mutation replacing `vibes.start` (keep `start` briefly for the
`vibes:run` script until §II.8 updates it, then delete it — two doors into
board-creation is the §IX.5 failure mode).

Input:

```ts
{ projectId, forms: [{ purpose, pages, preset, palette, vibes, designs }] }
```

- `designs` joins the *form*, not the brief: `vibesBrief` stays the reader for
  one board's brief, and `vibesBatch` (new, `lib/vibes/vibes-batch.ts`) is the
  reader for the submission — an array of `{ brief, designs }` or `null`, with
  per-form refusal messages the form can put beside the field they belong to
  (`vibesRefusals` grows a per-card shape). Refused, never repaired, exactly
  as `vibesBrief` is.
- Limits, as constants beside `VIBES_PAGE_LIMIT`:

  | constant | proposed | why |
  |---|---|---|
  | `VIBES_DESIGN_LIMIT` | 3 | designs per form. Each design is a full board of `pages` design calls |
  | `VIBES_FORM_LIMIT` | 4 | form cards per submission |
  | `VIBES_BATCH_PAGE_LIMIT` | 24 | Σ forms (designs × pages). The real bill cap — the two above alone allow 72 |

  **Flag, don't tune silently**: six design calls was "the most expensive
  single action" when it was the ceiling; 24 is four times that, ~$2.50 and
  ~an hour of worker time at the measured $0.10–0.13/page. If fixture runs
  say these are wrong, report the numbers (the `vibes.prompt.md` rule).

Per form, per design `d` of `D`, in order:

1. `vibesBoard({ brief })` unchanged — pure, one board's scene.
2. Board title: `normalizedBoardTitle(purpose)`, suffixed ` — v2`, ` — v3`
   when `D > 1` (v1 unsuffixed: the common single-design case must not grow a
   tail).
3. `moodboard.create` with `vibesBrief` — the existing `vibes.start` body,
   extracted into a helper (`server/api/routers/vibes.ts` keeps it private) and
   called `F×D` times. *(As built this also opened a conversation, wrote the
   user row and stamped `conversationId`; that went 2026-08-29, and a batch no
   longer puts a thread per board at the top of the switcher.)*
4. Enqueue the board's page-1 `VIBES` row **in the same transaction as the
   board's create** — a board that exists with no job is a run that never
   starts, and the analyzer's `enqueueAnalysis` signature exists for exactly
   this composition.
5. After the response: `kickVibesWorker()` — one job, `after()`, same shape
   as `kickAnalyzerWorker`.

Returns `{ boards: [{ boardId, title, formIndex, designIndex, pageIds }] }`.
The form navigates to the **first** board and the progress panel (§II.6)
shows the rest.

**Variation between designs of one form.** Two boards from the same brief
differ only by model nondeterminism unless told otherwise. Add one clause to
`vibesIntention` when `D > 1`: "this board is take `d` of `D` from the same
brief; other takes exist elsewhere — commit to one distinct direction rather
than hedging". Pure, tested like every other clause. **Flag**: whether the
clause helps is a fixture-run eyeballing, same as the coherence clause was —
build it, run `design:fixtures` on a 2-design form, and report what the takes
look like.
*Finding, 2026-08-28: eyeballed on a real 2-design, 1-page run of "a poster
for a rustic autumn supper club" through the queue. The takes are distinct
directions, not a hedge: take 1 is a landscape editorial split — white left
text panel with a small-type hierarchy, one warm flat-lay photograph filling
the right half, asymmetric; take 2 (" — v2") is a portrait, fully centered
symmetric poster — centered display title, the photo as a middle band, a
two-column WHEN/WHERE footer. Both drew the same gallery photo (expected —
one shared gallery per project) but committed to different layout systems,
formats, and type treatments. The clause works as written.*

### II.4 `runVibesPage` — the extraction

`vibes.designPage`'s body — brief read-back through `storedBrief`, gallery
read, `vibesIntention`, `designPage(…)` unchanged, one assistant chat row via
`vibesSaid` — moves into a server function the worker can call without a tRPC
context (the chat row went 2026-08-29; the rest is as built):

`server/agents/vibes/run-vibes-page.ts`:

```ts
runVibesPage({ db, boardId, pageId, index }): Promise<VibesOutcome>
```

- **No session.** Ownership was checked when the job was enqueued (the
  enqueuer held one); the worker trusts the row, as the analyzer worker does.
- **Idempotence first**: read the scene, and if `vibesPageDesigned` already
  answers yes, return `{ outcome: "designed", alreadyDesigned: true }` with no
  model call — the reclaim-after-crash case from §II.2.
- **Outcome returned, never thrown**, refusal and all — the worker settles
  the row off it. An actual exception is the `FAILED` path with
  `runErrorMessage`-style truncation (reuse the analyzer's constant).
- **No event stream.** The streaming generator, `eventStream<VibesEvent>`,
  and the `for await` in the panel all existed to feed a watching browser
  mid-mutation. The worker has no watcher; progress is now the polled query
  (§II.6). Delete the stream plumbing with the mutation.
- The chat rows keep their exact shape (`vibesSaid`, one assistant row per
  page, each its own `turnId`) — the "board with no account of where it came
  from" reasoning in §IX.2 is untouched by who calls. *(2026-08-29: the rows are
  deleted along with `vibes-account.ts`. Nobody typed in those threads and
  nobody read them. The account of a page is its own `AgentRun` row, which the
  progress panel below already reads; the account of the ask is the board's
  title and `Moodboard.vibesBrief`.)*

Then `vibes.designPage` (the tRPC mutation) is **deleted**. Its contract test
("two doors onto agent 8, `runDesigner` nowhere outside the designer's
directory") is re-pointed: the doors are now `orchestrator` and
`runVibesPage`.

### II.5 The queue, the worker, the endpoint

Mirror the analyzer's four files:

| file | contents |
|---|---|
| `lib/vibes/vibes-queue.ts` (pure) | `VIBES_LEASE_MS = 15 min` (a page measured up to ~3 min at the round ceiling; 10 would be fine, 15 is the same argument with margin), `VIBES_WORKER_JOB_LIMIT = 1`, `vibesJob()` shape guard on `input`, lease cutoff helpers — copy `analyzer-queue.ts`'s vocabulary so the two queues read as siblings |
| `server/agents/vibes/vibes-worker.ts` | `claimVibesRun` (CAS, same guard triple), `runClaimedVibesJob` (calls `runVibesPage`, settles the row **and chain-enqueues the next page in the same transaction**), `drainVibesQueue` |
| `server/agents/vibes/vibes-queue.ts` | binds real `db`; exports `enqueueVibesPage(client, { projectId, boardId, pageId, index })` (transaction-friendly), `drainVibesQueue()`, `kickVibesWorker()` |
| `app/api/agents/vibes/worker/route.ts` | `POST`, `maxDuration = 300`, bearer secret — copy the analyzer route's 503/404/`timingSafeEqual` behaviour exactly |

Deviations from the analyzer, each with its reason:

- **`VIBES_WORKER_JOB_LIMIT = 1`, not 5.** An analyzer job is seconds; a
  design page runs to ~3 minutes at the round ceiling. Two in one invocation
  can exceed `maxDuration = 300`; one cannot.
  *Finding, 2026-08-28: one can. The four real queue-driven pages measured
  167s, 206s, 407s and 754s claim→settle ($0.09–0.12, ~200–306k tokens each)
  — two past `maxDuration = 300`. Locally nothing enforces the cap; deployed,
  such an invocation dies mid-design, the 15-minute lease makes the row a
  zombie, and the cron's reclaim settles whatever the killed call left —
  where `vibesPageDesigned` is a non-blank check that cannot tell a
  half-placed page from a finished one. (Observed benignly: one killed run
  had finished its scene work, and the reclaim settled `alreadyDesigned` in
  1s with no model spend.) Before first deploy, either raise the route's
  `maxDuration` above the measured worst page or accept that a >300s page
  may settle partial.
  Applied, 2026-08-28: the route now exports `maxDuration = 800` — Vercel's
  Fluid Compute ceiling on Pro, clear of the 754s worst page — and
  `VIBES_LEASE_MS` was widened from 15 to 20 minutes so the lease stays above
  both the new cap and the worst measured page: a live invocation can never
  be reclaimed mid-flight, and a dead one zombies for at most the 400s
  difference. The trade is a dead lease now takes 20 minutes for the cron to
  clear instead of 15.*
- **Chain-enqueue on settle** (§II.2) — the analyzer has no ordering to keep.
- **Self-kick after a settled job**: if the settle enqueued a next page (or
  other `QUEUED` rows exist), the invocation `after()`-fires one `fetch` at
  its own endpoint with the secret before it dies, so a chain advances at
  design speed rather than at cron cadence. Cloud Scheduler stays as the
  backstop that clears a dead lease and a cold queue — the kick can be lost
  (a killed function), and the cron is what guarantees eventual drain, same
  division of labour as `infra.md` §XIII's two drains. The self-URL comes from
  the same `VERCEL_URL` handling `trpc/react.tsx` uses; locally it is
  `http://localhost:12000`. **Flag** if constructing the self-URL turns out
  fragile — the fallback is living with cron cadence (a 6-page board takes
  ~6 extra minutes, not wrong, just slower).
  *Finding, 2026-08-28: the self-URL comes from `APP_URL` instead — already
  required, validated, and deployment-exact (the OAuth redirect depends on
  it), where `VERCEL_URL` is unset locally. Not fragile; no fallback needed.*
- **Secret**: new env `VIBES_WORKER_SECRET`, required in `src/env.ts` the way
  `ANALYZER_WORKER_SECRET` is handled (unset disables the endpoint, 503).
  Separate from the analyzer's on purpose — rotating one must not break the
  other. Cloud Scheduler job (deploy-time, owner action, document in
  `infra.md` as a new subsection of §XIII):

  ```sh
  gcloud scheduler jobs create http vibes-worker \
    --project=$P --location=$R --schedule="* * * * *" \
    --uri="https://<deployment>/api/agents/vibes/worker" \
    --http-method=POST \
    --update-headers="Authorization=Bearer $SECRET" \
    --attempt-deadline=300s
  ```

**Vertex throttling.** Within an invocation everything is serial. Across
invocations, parallelism = live chain heads (≤ boards in flight), worst case
`VIBES_FORM_LIMIT × VIBES_DESIGN_LIMIT` = 12 — but only if 12 boards were
started at once and the cron fanned them all out. The designer already rides
the retry ladder (`server/google/retry-ladder.test.mts` holds it), so a
throttled call is retried, not lost. **Flag** if fixture runs show HTML-404
throttling at realistic batch sizes; the lever is claiming only jobs whose
board count in `RUNNING` is under a cap, and it should not be built until a
run says so.

### II.6 Progress: the panel stops driving and starts watching

`VibesRunPanel` keeps its job (the card, the marks, Stop, the resume offer)
and loses its engine (the walk).

- **New query `vibes.activeRuns { projectId }`**: the live `VIBES` rows
  (`QUEUED`/`RUNNING`) plus rows settled in the last ~2 minutes, joined with
  each board's `vibesBrief.pages` and title. Shape it pure in
  `lib/vibes/vibes-batch.ts`: per board — total, settled count, per-page
  outcome marks, whether the chain ended in a refusal/failure, the sentence
  the user is owed. The panel's one-mark-per-page rendering carries over
  almost verbatim; it now draws one card per active board (or one card with a
  row per board — match whichever reads better against the existing card's
  markup, and keep it one component).
- **Polling**: TanStack Query `refetchInterval` ~4 s while any row is live,
  off entirely when none are — the panel is mounted in `ProjectWorkspace`
  already, which is the right lifetime. The `announceVibesRun` event bus and
  `_events/vibes-run.ts` are **deleted**: their whole reason was surviving the
  editor unmount that killed a browser-driven loop, and nothing browser-side
  drives any more. On submit, the form invalidates `vibes.activeRuns` and the
  panel picks the batch up on its next tick.
- **Board reload**: the walk called `reloadBoard` after each page; now the
  poll does — when a board's settled count rises and that board is open,
  request a reload through the existing `board-reload.ts` counter. Same
  mechanism, new trigger.
- **Stop** becomes `vibes.stop { boardId }`: delete that board's `QUEUED`
  rows (there is at most one — the chain head). The `RUNNING` page still
  finishes and is still kept — nothing can abort a model call mid-flight,
  which was already Stop's honest meaning; the button copy ("ask for no more
  pages") survives unchanged. A stopped board makes a resume offer, which is
  exactly what stopping should leave behind.
- **Resume** becomes a mutation: `vibes.resume { boardId }` reads the scene
  through the existing `vibesRun`/`vibesPending`, refuses if a live `VIBES`
  row already exists for the board (the "board being open is the trigger"
  card logic keeps its guard, now server-checked too), and enqueues the first
  pending page + kick. The offer card (`vibesResumeOffer`) keeps its two pure
  sentences; only the press's target changes.

### II.7 The form: stacked briefs, one submit

`vibes-form.tsx` becomes a list of **brief cards** with one submit:

- Opens holding one card — today's five fields plus a **designs** row
  (buttons 1–`VIBES_DESIGN_LIMIT`, default 1). The single-card, one-design
  submission must look and cost exactly like today's form: the new power is
  additive, not a tax on the common case.
- "Add another brief" appends a card seeded by `vibesDraft()` (same palette
  seed — seeded once per card at creation, per the no-reseed rule). Each card
  removable; the last card is not.
- Refusals stay per-field, now per-card (`vibesBatch`'s per-form messages,
  §II.3), and stay silent until first submit (`asked` flag, unchanged rule).
  A batch submits only when **every** card reads clean — one refusing card
  holds the batch, with the card visibly marked, because silently submitting
  the clean subset spends money on half of what was asked.
- **The bill is on the button**, now a sum: "Design 9 pages across 3 boards".
  The `VIBES_BATCH_PAGE_LIMIT` refusal renders at the button too — it is a
  property of the sum, not of any card.
- Scrolling: the dialog gets a max height and the card list scrolls;
  the button row stays pinned.
- Pure half: `vibes-form.ts` grows batch-draft helpers (`addCard`,
  `removeCard`, per-card update) so card arithmetic is tested without React,
  matching the module's existing split.

On success: close, `openBoard(first boardId)`, invalidate
`moodboard.listByProject`, `chat.conversations`, `vibes.activeRuns`.

### II.8 The script and the tests

- `scripts/vibes-run.mts` re-targets the queue: build the batch input, call
  `vibes.startBatch` through the caller factory, then loop
  `drainVibesQueue()` until drained, printing each settle — the script *is*
  the worker locally, which also makes it the integration test for the claim
  path. `--board <id> --resume` calls `vibes.resume` then drains. Delete the
  old browser-loop re-implementation.
- `lib/vibes/vibes-loop.ts` and its tests are **replaced**, not dropped:
  the batch/progress pure module (§II.6) must carry at least the behaviours
  the loop tests held (which page is next, what the last one answered, what
  sentence is owed, stop semantics). The suite-count rule from
  `vibes.prompt.md` applies: a net drop in cases is a finding to report.
- New pure tests: `vibes-batch` (reader refusals, limits, the bill sum),
  `vibes-queue` (lease math, job shape), the take-`d`-of-`D` clause in
  `vibes-brief`, worker claim/chain/idempotence against an injected fake db
  (the analyzer worker's test file is the template), the route's 503/404.

### II.9 Migration discipline

One migration carries `AgentKind.VIBES` and Part III's
`Moodboard.previewOrder`. Per `infra.md` §XVI's amendment — **a migration
lands in two places or it has not landed**:

```sh
npm run db:deploy                                            # local Docker
DATABASE_URL="$(npm run -s db:tunnel:url)" npm run db:deploy # Cloud SQL, tunnel up
```

The `vibesBrief` P2022 incident is the standing reason; do both before the
first `vibes:run`.

---

## Part III — The Preview tab

### III.1 The tab

- `_workspace/types.ts`: `WorkspaceView = "gallery" | "design" | "preview"`.
- `project-bar.tsx` `VIEWS` gains `{ id: "preview", label: "Preview" }` —
  order Gallery, Design, Preview.
- `project-workspace.tsx`'s switch renders `<PreviewView />` from a new
  private folder `_main-viewport/_preview/`.
- Board selection is **shared with Design** via the existing open-board store
  (`use-open-board-store` / `board-selection.ts`): switching to Preview opens
  on the board you were editing, and picking a board in Preview changes what
  Design opens on. One selection, two views of it — a second store would be
  the two tabs disagreeing about "the board".

### III.2 Page images — client-side export, no server render

Preview needs a bitmap per page. Use Excalidraw's own export
(`exportToCanvas` with the `exportingFrame` option) against the board's
`elements` the client already fetches — the same bytes the editor draws, so
fidelity is exact by construction, which is the standing bet
(`compositor-v2.md` §III.2.1: the browser's export is the reference; the
server renderer is for models). No new server cost, no GCS round-trip, no
staleness: re-export keyed on `(boardId, revision, pageId)`.

- Hook `_preview/hooks/use-page-bitmaps.ts`: given a board's elements +
  files, export each page frame lazily (the visible slide and its neighbours
  first), cache canvases in a ref map keyed by revision, revoke on board
  switch. Cap export width (~1600 px for the main slide, ~240 px for
  thumbnails — thumbnails export once at small scale rather than downscaling
  the big one, a 6-page board is ≤ 12 exports total).
- Image files resolve through whatever the editor already feeds Excalidraw
  (signed reads); reuse that loader rather than a second one.
- A board with zero pages renders an empty state ("no pages on this board
  yet") rather than an empty carousel.

**Flag** if `exportToCanvas` + `exportingFrame` misbehaves outside a mounted
editor (fonts or files not registered): the fallback is mounting one hidden
read-only Excalidraw per board and using its export — heavier, same fidelity.
Find out in III.3's first spike, not late.

### III.3 The main carousel — pages

`_preview/components/page-carousel.tsx`. Hand-rolled — nothing is installed
(no embla/swiper) and the house pattern is hand-rolled strips
(`board-tabs.tsx`); a dependency for scroll-snap is not worth its weight.

- A horizontal scroll container, `scroll-snap-type: x mandatory`, one
  full-width slide per page, `scroll-snap-align: center`.
- Ordered by `orderedPages` (§III.5) — **the preview order, not reading
  order**.
- Prev/next arrow buttons (`scrollTo` the neighbour), ←/→ keys while the
  view has focus, and a "3 / 6" position caption. Current index observed via
  `IntersectionObserver` on the slides (the `scrollend` event is not
  everywhere yet).
- Slides letterbox inside the viewport height minus the board strip —
  portrait and landscape presets both fit without cropping.
- Clicking a slide is inert for now (a later door could jump to Design on
  that page; not in scope, note it in the component).

### III.4 The board strip — the bottom carousel

`_preview/components/board-strip.tsx`. The user asked for a slide-carousel
picker at the bottom of the page.

- Horizontal scroll-snap strip of board cards: title + a small first-page
  bitmap (the §III.2 thumbnail path; boards render their thumb lazily as
  scrolled into view). Boards from the existing `moodboard.listByProject`
  query, `createdAt asc` — same order as Design's tab row, so the two views
  agree about "next board".
- Selected card highlighted and scrolled into view on mount (the
  `board-tabs.tsx` nudge pattern); click = `openBoard(id)`, which resets the
  page carousel to slide 1.
- Wheel-to-horizontal translation copied from `board-tabs.tsx:38-55`.
- No boards in the project → the tab renders one empty state with a "New
  board" affordance is **not** duplicated here; say "no boards yet — make one
  in Design" and leave creation where it lives.

### III.5 The stored order — `previewOrder`

The decided semantics: preview-only, honored by Preview and the deck export,
canvas untouched. The two orderings may disagree forever.

- **Column**: `Moodboard.previewOrder String[] @default([])` — page frame
  ids, in the user's chosen order. Rides the §II.9 migration.
- **Pure reader** `lib/pages/page-order.ts`:
  - `orderedPages(pages, stored)`: stored ids first (filtered to pages that
    still exist), then any page not in the list, appended in reading order.
    An empty list therefore *is* reading order — the default costs nothing
    and the column never needs backfilling.
  - `moveInOrder(orderedIds, from, to)`: the reorder arithmetic, returning
    the full explicit list (writing the complete list on first touch is what
    makes later page additions land *after* the user's arrangement rather
    than interleaved).
  - Tests: deleted ids dropped, unknown ids appended in reading order, empty
    list identity, move bounds.
- **Mutation** `moodboard.setPreviewOrder { boardId, order }`: ownership
  check, every id must be a page frame on the current scene (refuse
  otherwise — a stale client writing ids from a deleted page should hear it),
  write the column. **Deliberately not revision-guarded and not a
  `sceneWrite`**: `elements` is untouched, so the editor's optimistic-
  concurrency story doesn't apply, and bumping `revision` here would hand an
  idle editor a conflict for a reorder that moved no element — the exact
  symptom `vibes.prompt.md` Stage 3 warns about for `appState`. Last write
  wins on the column alone.
- Page deletion/duplication on the canvas needs **no** cleanup hook: stale
  ids fall out in the reader, new pages append. State it in the module
  docstring, because the absence of a cleanup call will otherwise read as a
  miss.

### III.6 The reorder rail

`_preview/components/page-order-rail.tsx` — floating left over the main
carousel (absolute within the Preview viewport, vertical, own scroll when
tall).

- One numbered thumbnail per page, in preview order (same 240 px bitmaps).
- **Reorder by drag**, hand-rolled on pointer events (no dnd lib, and HTML5
  drag-and-drop's ergonomics are poor for vertical lists): pointerdown arms,
  pointermove past a slop lifts the item (transform, not reflow), midpoint
  hit-testing decides the drop index, pointerup commits. Pure hit-math in
  `page-order.ts` beside `moveInOrder` so it is testable.
- **Up/down buttons on each row** as the keyboard/a11y path and the cheap
  first implementation — build the buttons first, the drag second; the rail
  is fully functional after the first.
- Commit = optimistic `setPreviewOrder` (TanStack `onMutate` cache patch,
  rollback on error), so the rail and the main carousel reorder instantly.
- The current slide's row is highlighted; clicking a row scrolls the main
  carousel to that page.

### III.7 The deck follows

The presenter (product item 5 — not an agent) currently maps pages one slide
each in reading order. Point its page read at `orderedPages(pages,
board.previewOrder)` — one call-site change, plus its test growing the case
where stored order and reading order disagree.

> **Stage 6 finding (2026-08-28): the presenter does not exist in code.**
> `src/server/decks/` was never built — the `Deck` model is schema-only and
> `build_deck` lives only in `agent-tools.md`. There is no call site to
> re-point; the doc amendment below was made instead, so whoever builds the
> presenter reads `orderedPages` from day one. The rest of this section
> (rail, mutation) landed as written. The tool description /
`agent-tools.md` line about "reading order" gets amended to "preview order,
which defaults to reading order" — append, don't renumber, per the standing
docs rule.

> **Closed 2026-09-01: the presenter exists, and it read `orderedPages` from
> its first line.** `src/server/decks/` is built — a Google Slides export on the
> user's own OAuth, and a client-side PDF deck beside it — both driven from the
> Preview tab's `orderedPages(boardPages(scene.elements), scene.previewOrder)`.
> So the sentence this section was written to protect is now asserted twice, in
> `deck-plan.test.mts` and in `deck-export.test.mts`: the slides come out in the
> rail's order and never in `pagesInReadingOrder`. `build_deck` on agent 6 is
> still unwired — see `agent-tools.md` §12's amendment for what is left.

Anything else that *says* "reading order" to a model (`page-brief`, vibes
"page 3 of 6", `inspect_board`) **stays on reading order** — agents work the
canvas, and the canvas did not move. Only the two user-facing consumers
(Preview, deck) read the stored order. This line is the whole reason
preview-only ordering is safe; keep it in the `page-order.ts` docstring.

---

## Part IV — Stages, in landing order

Each stage green (`npm run typecheck && npm test && npm run lint && npm run
floor && npm run build`, then `npm run cites`) and committed before the next.
The suite is 2,949+ cases at HEAD; a net drop is a finding.

| stage | contents | proves |
|---|---|---|
| **1. Migration** | `AgentKind.VIBES` + `previewOrder`, deployed to both databases (§II.9) | `db:deploy` × 2, `vibes:run` still green on the old path |
| **2. Extraction** | `runVibesPage` extracted; `vibes.designPage` calls it; no behaviour change | suite green, `npm run vibes:run` output identical in shape |
| **3. Queue + worker** | pure queue module, worker, endpoint, `enqueueVibesPage`, chain + self-kick, `vibes.stop`/`vibes.resume` re-target, `vibes.activeRuns`; `vibes.start` enqueues instead of returning steps; panel → polling; browser loop, event bus, `vibes.designPage` mutation deleted; `vibes:run` re-targeted | `npm run vibes:run` drives one single-form run end-to-end through the queue; kill the drain mid-run and resume picks it up |
| **4. Batch** | `vibesBatch` reader, `startBatch`, stacked-card form, limits + bill, take-`d`-of-`D` clause; `vibes.start` deleted | `npm run design:fixtures` on a 2-form, 2-design batch; eyeball the takes; `npm run design:runs` for the bill |
| **5. Preview skeleton** | tab, `PreviewView`, page bitmaps hook, main carousel in preview order (empty `previewOrder` = reading order), board strip | open a real project: every board browsable, portrait + landscape presets letterbox correctly |
| **6. Reorder + deck** | `page-order.ts`, `setPreviewOrder`, the rail (buttons then drag), presenter re-pointed | reorder a board, export its deck, slides come out in the rail's order; canvas unmoved; Design tab unaffected |
| **7. Deploy notes** | `VIBES_WORKER_SECRET` to env store, Cloud Scheduler `vibes-worker` job, `infra.md` §XIII amended | worker drains a queued run with no browser open |

Stages 5–6 depend only on stage 1 and can interleave with 3–4.

## Part V — What to flag rather than decide

- **The batch ceiling** (`VIBES_BATCH_PAGE_LIMIT` 24, §II.3) — cost and
  wall-clock of a full batch, measured, before the number is trusted.
  *Measured basis, 2026-08-28, from the four real queue-driven pages:
  $0.09–0.12 and 167–754s per page (mean ~$0.11, ~6.4 min). A full 24-page
  batch extrapolates to ~$2.60 — the ceiling holds on cost. Wall-clock: a
  board's chain is serial (~51 min for 8 pages at the mean), boards parallel
  only as cron kicks overlap, and the local script drain is one worker, so
  ~2.6 h serial there. The wall-clock and the >300s pages (§II.5 finding)
  are what a real full batch still needs to confirm.*
- **The take-clause** (§II.3) — does "take 2 of 3" produce distinct boards or
  a hedge? Eyeball a real 2-design run.
- **Self-kick URL construction** (§II.5) — if fragile on Vercel, fall back to
  cron cadence and say so.
- **Cross-board parallelism vs. Vertex throttling** (§II.5) — build nothing
  until a fixture run shows HTML-404s.
- **`exportToCanvas` outside the editor** (§III.2) — spike first; the hidden
  read-only editor is the fallback.
- **Anything in this PRD that loses to the code.** The code wins — fix this
  doc and say so in the commit, per the standing rule.

## Part VI — Constraints carried over

- Commit per stage, never red.
- `context/` is gitignored; doc edits won't show in `git status` — expected.
- Layering: `lib/` pure with sibling `.test.mts`, `server/` is `server-only`,
  components under `app/`. `///` comments say *why* and cite sections by
  number; read `object-put.ts` and `analyzer-worker.ts` before writing prose.
- No section of the existing specs gets renumbered; amendments append.
