<!--
RECONSTRUCTED 2026-08-22 (night). This file was truncated to zero bytes by an
agent's bad `open(p,"w").write(open(p).read()...)` — the write handle truncates
before the read runs. `context/` is gitignored, so there was no git copy and no
editor history; what follows was recovered verbatim from Claude Code session
transcripts (~/.claude/projects/...-vibes-ai/*.jsonl), which hold the reads and
the edit commands that built it.

Text here comes from three places and they are not the same evidence:

1. **Verbatim recovered** from transcripts — §I, §II, §VI, §VII, §VIII in full,
   and most of §III. This is the original wording. A second recovery pass on
   2026-08-22 (night, later) added §III.3's "Step 4, as built" in full, §III.4's
   head through the layout table, §III.4's layout-reader heading, §III.7's first
   paragraph, and §VII's transport-boundary subsection with its mutation table —
   all verbatim, most of them out of the `python3 - <<'PY'` heredocs that wrote
   them rather than out of a read.
2. **RECOVERY GAP** blocks — never read or written inside a recorded session,
   and lost. Treat a GAP as "unknown", never as "nothing was there". There are
   none left: the last two, §III.4's closing sentence and the rest of §III.7,
   were rebuilt from code on 2026-08-22 (night, later) and carry a banner of
   kind 3 instead. A GAP going away is not the original text coming back.
3. **RECONSTRUCTED FROM CODE** — 2026-08-22 (night). §IV and §V, which were lost
   entirely, rebuilt from the code that cites them by number (~270 call sites
   cite `§V.1`–`§V.5`) and from the decisions those call sites record. Their
   subsection numbering is the original's, recovered from a heading list in a
   transcript, so citations of `§V.3` and `§IV` still land where they meant to.
   The later passes added §III.4's `RANDOM` resolution, its layout reader's body
   and its closing loose-fit paragraph, and the whole of §III.7 below its first
   paragraph — from `moodboard-layouts.ts`, `layout-reader.ts`,
   `custom-layout.ts`, `slot-fit.ts`, `image-generator.ts` and `agent-tools.ts`.
   The wording is not the original's, and where it disagrees with the code the
   code is right. Each carries its own banner saying so.

`context/tech-spec.recovery-fragments.md` holds the raw transcript fragments
the verbatim recovery was built from.

**2026-08-30: every § citation was removed from the code**, along with all
prose comments, by decision — the code carries the what, these docs carry the
why, and nothing cross-references by section number any more. Statements in
this directory about call sites citing sections describe history, not the
current tree, and the redundancy that once let §IV/§V be rebuilt from comments
no longer exists: these docs are the only copy of the why, now tracked in git
(committed 2026-08-30, the same day, as the safeguard replacing the comments).

`npm run cites` (web-app) resolves every `§` a comment in `src/` or `scripts/`
writes against the headings in this directory, and is the standing guard on the
failure this incident actually caused: `§III.4` lost its heading in the rebuild
and the fourteen comments citing it pointed at nothing, silently. Run it after
renumbering, renaming or removing anything here. The resolving cannot be a test
— this directory is gitignored, so a suite that read it would fail on a fresh
clone — but the parsers it answers from are one (`src/lib/util/citations.ts`,
16 cases), because twelve of fourteen mutations planted in the script left it
reporting that every citation resolved. tech-spec §VII, "the guard on the
numbers could not fail".
-->

# TECH SPEC

## I. Tools & Frameworks

- Models: Gemini on Vertex AI — now Gemini Enterprise Agent Platform (infra §XI)
- Model access: `@google/genai`, the Gen AI SDK for TypeScript, in Vertex mode — §VII
- Storage: GCS, browser→bucket on a v4 signed URL (§III.1)
- Database: Cloud SQL for PostgreSQL, through the Node connector — §VIII
- App: one Next.js deployment holding both the UI and the agent tier — Prisma 7,
  tRPC, zod, tanstack query
- Deploy: Vercel (infra §II)

This list is what the project *is*. It used to describe a Python ADK tier
(`google-adk`, vendored at `../../adk-python`) deployed to Agent Engine, cutting
crops with Pillow and reaching GCS through `GcsArtifactService`, with the UI on
Cloud Run. None of that tier was ever built: every agent is a TypeScript module
under `src/server/agents/` calling one model function, the cropper cuts with
`sharp` and in the browser, and GCS is reached with `@google-cloud/storage`.
`src/server/google/agent-runtime.ts` and the dormant `agent.start` path are the
only things still pointed at Agent Engine, and nothing has been deployed behind
them.

### Eligibility constraints

The event requires all three of:

1. **Gemini 3.5 or newer**, through the Gemini API or Vertex AI.
2. **At least one Google agent framework** — ADK, Gen AI SDK, Antigravity SDK,
   or GenKit.
3. **At least one Google Cloud infrastructure service** — Cloud Run, Cloud SQL,
   Firestore, GKE, Pub/Sub and the like.

Where each stands as of 2026-08-22:

| Requirement | Met by | State |
|---|---|---|
| Gemini ≥ 3.5 | `gemini-3.7-flash` on the text and vision agents | **met** — landed 2026-08-22; all five text/vision agents call `FLASH`, verified live (§II) and held by `model-floor.test.mts`, with all five now readable at a seam as well — the analyzer's and the compositor's answered by `analyzer.test.mts` and `compositor.test.mts` |
| Agent framework | `@google/genai` in Vertex mode | **met** — landed 2026-08-22; every model call goes through the SDK, verified live (§VII), with the boundary held by `sdk-boundary.test.mts` (the SDK's, the host's, and the three that keep a model call off the REST transport that stayed), the positional seam by `generate-seam.test.mts`, the retry policy by `retry-ladder.test.mts`, the readers and defaults `vertex.ts` supplies when a caller supplies none by `parts.test.mts` and `vertex-defaults.test.mts`, the credential the SDK's client is built from by `auth.test.mts`, and the `global` location and enterprise flag that put that client on Vertex by `env.test.mts`; the two agents that were reading the SDK's answer with nothing asserting what they read are held by `analyzer.test.mts` and `compositor.test.mts`; the tree walk all six source-text rules ask their question through is itself held by `source-tree.test.mts` |
| Cloud infrastructure | GCS and Cloud SQL | **met twice over** — landed 2026-08-22; the schema is deployed to `vibes-ai-pg` and every query the app makes goes through the connector, verified live (§VIII), with the connector itself held by `cloud-sql.test.mts`, the pool above it by `once.test.mts`, what that pool is made of by `db.test.mts`, the one database path by `db-path.test.mts`, and the four `CLOUD_SQL_*` keys the whole path hangs on by `env.test.mts` |

All three are done and are described in §II, §VII and §VIII. The third already
passed on Cloud Storage alone — §VIII was about not resting a whole requirement
on the one service that is easiest to read as incidental, and it is now landed:
the schema is deployed to `vibes-ai-pg`, `server/db.ts` reaches it through
`@google-cloud/cloud-sql-connector` on the same service-account credential that
reaches Vertex and GCS, and the seven projects that were in local Docker were
copied across so the cutover landed behind a working app rather than an empty
one. **No eligibility requirement is outstanding.**

## II. Model IDs

Verified against `ai.google.dev/gemini-api/docs/models` on 2026-08-16.

| Alias | Model ID | Status |
|---|---|---|
| `PRO` | `gemini-3.1-pro-preview` | preview |
| `FLASH` | `gemini-3.7-flash` | stable |
| `IMAGE` | `gemini-3-pro-image` | stable |

There is no GA Gemini 3.x Pro. `gemini-3.1-pro-preview` is the only Pro-tier
option and it is preview — pin it in one place so a mid-hackathon rename is a
one-line fix.

### The 3.5 floor

`PRO` is **below the eligibility floor in §I**: 3.1 is not 3.5 or newer, and
`PRO` was what every agent in the codebase called — `MODELS.FLASH` and the flash
tier generally were declared and unused. `IMAGE` is 3.0 and is likewise below it.

**Landed 2026-08-22.** All five text/vision agents call `FLASH`; `PRO` is
declared, priced and called by nothing. See "What the move actually looked like"
at the end of this section for the live readings.

There is no way to fix this on the Pro tier. Gemini 3.5 Pro has not shipped;
as of 2026-08 the newest Pro-class id is still `gemini-3.1-pro-preview`
(2026-02-19). The models at or above the floor are all flash:

| Model ID | Released | Status |
|---|---|---|
| `gemini-3.7-flash` | 2026-08-13 | GA, straight to GA with no preview |
| `gemini-3.6-flash` | 2026-07-21 | GA |
| `gemini-3.5-flash-lite` | 2026-07-21 | GA |

So the floor is cleared by routing real work to `gemini-3.7-flash`, not by
waiting for a Pro id. The routing decision:

- **Orchestrator (§III.6), analyzer (§III.2), cropper (§III.3), compositor
  (§III.4), layout reader** → `FLASH`. 3.7 Flash is GA and was released against
  agentic and tool-calling workloads, which is exactly the orchestrator's round
  loop; the other four are structured-output vision reads that were never
  buying Pro-tier reasoning. It is also about a seventh of the price
  (`MODEL_PRICES` in `lib/agent/model-cost.ts`), which matters because the
  orchestrator re-sends the whole conversation every round.
- **`PRO`** stays defined and stays priced, as the fallback if a flash read
  measurably degrades — most likely on the layout reader, the one call whose
  failure is quiet (§VI).
- **`IMAGE`** stays `gemini-3-pro-image`. It is the image model; there is no
  ≥3.5 replacement (`gemini-3.1-flash-image` is 3.1). The floor is a statement
  about the project, not about every call in it, and it is cleared by the five
  agents above.

Model ids are read from `MODELS` in one place, so this is a constant change plus
a rates row per id in `MODEL_PRICES` — but it is a **behavioural** change to
five agents, so it lands with its own eyeballing of the boards and crops that
come out, not as a silent constant bump.

It is also more than the `MODELS` constants. Three carried-cost attributions
name the model in prose rather than reading it off the agent's answer — the
cropper's failure branch and the layout reader's in `src/server/agents/orchestrator/tools.ts`,
and the crop panel's in `src/server/api/routers/reference.ts` — and a fourth
place, `scripts/floor.mts`, counts the orchestrator's prompt against a model id
of its own. All four moved with the agents. Every other `spentColumns` call
already reads `answer.model`, which is why they needed nothing.

### What the move actually looked like

Landed 2026-08-22, all five agents at once, verified by live `npm run smoke`
runs against `global` rather than by reading the diff. Nothing went back to
`PRO`; five of five is the answer, not four.

- **Orchestrator** — a 3-round turn (`crop_reference` → `show_references`) and a
  4-round one (`list_references` → `compose_moodboard` → `show_references`).
  Function calls parsed, tool results fed back, replies coherent. This was the
  one genuinely at risk: the round loop is the only agentic workload here.
- **Cropper** — one attempt, `box_2d` `[434, 0, 1000, 316]`, y-first and
  normalized 0–1000 as §III.3 requires, correctly the bottom-left corner for
  "keeping the darkest corner". Same format and same one-attempt cost as the
  `PRO` crop sitting next to it in `AgentRun`.
- **Layout reader** — the agent §VI flags as failing *quietly*, so it was probed
  deliberately: a generated sketch of one wide rectangle over two squares came
  back as three slots (`img-1`/`img-2`/`img-3`) in one attempt, composition read
  as "a wide panoramic header frame spanning the top above two side-by-side
  rectangular frames across the bottom". No decoration read as a placeholder, no
  slot dropped.
- **Compositor** — placed into both boards, and noticed unprompted that a 16:9
  frame sits loose in a 4:3 opening.
- **Analyzer** — one queued reading drained clean: palette, lighting, texture,
  composition and depth all populated from the fixed vocabulary.

The bill moved as predicted. A routing turn that read ~$0.03 on `PRO` reads
$0.0084 on flash at 24,855 in / 392 out, and the run rows price against
`gemini-3.7-flash` — which is the thing the attribution fix above was for.

### What holds the floor down — added 2026-08-22

The move above is a set of call sites, and a call site is a one-word edit away
from going back. Three of the five agents are pinned at their seam — the
cropper, the layout reader and the orchestrator take `generate` as a parameter,
so a fake reads the model they ask for, and those tests assert the literal
`gemini-3.7-flash` rather than `MODELS.FLASH` so a repointed alias cannot
satisfy them. **The analyzer and the compositor have no seam.** They import
`generateContent` directly, their test files cover pure helpers only, and until
now nothing in the suite would have noticed either of them moving back to `PRO`.

**Amended 2026-08-23:** they have one now — both take `generate` as a parameter
too, and both new test files assert the literal `gemini-3.7-flash` the way the
other three do (§VII, "The two agents nothing could watch"). The rules below
still stand and are still the floor's own test: a fake answers for the agent it
is handed to, and the question here is about the app.

`src/server/google/model-floor.test.mts` closes that, over the source text
rather than over a seam — the same technique §VII's `sdk-boundary.test.mts`
uses, and now sharing its tree walk (`source-tree.ts`, a plain `.ts` so it is
not itself collected by the `*.test.mts` glob; a test file imported by another
test file registers its cases twice and inflates the count this migration is
measured by):

- The aliases the app names are exactly `FLASH` and `IMAGE`. `PRO` is called by
  nothing — which is what covers the two agents with no seam, and what keeps
  "declared and priced as the degradation fallback" from quietly becoming
  "called again".
- The generation is *parsed* off the id and compared against 3.5, so the test is
  about the eligibility requirement and not about a string. Repointing `FLASH`
  at `gemini-3.4-flash` fails it.
- A model id is spelled in `vertex.ts` where it is declared and in
  `model-cost.ts` where it is priced, and nowhere else in the app — the alias
  cannot be bypassed with a literal.
- The five agent paths are asserted to be in the scan, because a walk that
  silently found nothing would satisfy "nobody calls `PRO`" forever.

Mutation-checked, four ways: compositor back on `PRO` (killed by the two new
alias tests and by nothing else *at the time* — the seam tests did not fire,
which was the whole point; as of 2026-08-23 the compositor's own seam case kills
it too), `FLASH` repointed below the floor, a literal id written at a call site,
and the walk stubbed to return no files. 1,920 -> 1,925 cases.

### The attribution, held the same way — added 2026-08-22

The three carried-cost branches above were fixed by moving them from `PRO` to
`FLASH`, which corrected the numbers and left the defect: a failed row was still
priced against a model *the caller named*, one file away from the agent that
chose it. Two copies of a model decision agree only until the next move, and
the last move needed all three found by hand.

They now name none. Each agent's error carries the model its reads were billed
against — `CropperError`, `LayoutReaderError` and `ImageGeneratorError` each
declare it beside the `usage` they already carried — and the writers price the
row with `spentThrown(cause)`, which reads both off the throw the way
`usageThrown` already read the tokens, structurally rather than by
`instanceof` (that module's own comment says why: the error crosses a module
boundary and a class loaded twice makes a nominal check quietly false exactly
where the bill is). `MODELS` is no longer imported by `tools.ts` or by
`reference.ts` at all.

`spentThrown` returns null unless the throw carries *both*, which is the
distinction the ledger wants: an agent that refused after reading has a price,
and a `VertexError` that never reached the model has none — a default model
there would file the app's guess as the row's fact.

Held down two ways. Per agent, `cropper.test.mts`, `layout-reader.test.mts` and
`image-generator.test.mts` each assert that a refusal prices against the literal
id the fake was actually asked for — including the image generator, the one
agent not on the text tier and therefore the one a caller-named model would
misprice worst. Over the source, `src/server/agents/run-price.test.mts` asserts
that no file naming `spentColumns(` also names a `MODELS.` alias, which is the
half no unit test reaches: the four doors onto `AgentRun` all sit behind a
database call. Mutation-checked four ways — the caller re-hardcoding `PRO`
(killed by the source rule alone), an agent dropping its `model` field, the
image generator naming the text tier, and the walk stubbed to no files. 1,925 ->
1,932 cases.

### What the move did to the bill — probed 2026-08-22 (night)

`orchestrator.ts` carried a cost model in a comment: every model call re-sends
the instruction, the declarations, the brief and the conversation, "and nothing
about it is cached (Vertex reports no `cachedContentTokenCount`, measured on
`PRO` and unprobed since the move to `FLASH`)". The move made that false and
nothing noticed, because `usageOf` never reads the field.

Probed by instrumenting `generateContent` to print `usageMetadata` and running
one real turn — `npm run smoke -- "what have I got in here?"`, three model calls
over two tool rounds. The instrumentation was reverted; the payloads are now
fixtures in `model-cost.test.mts`.

| call | prompt | cached | output (candidates + thoughts) | total |
|---|---|---|---|---|
| 1 | 12,720 | — | 16 + 176 | 12,912 |
| 2 | 13,234 | **10,919** | 117 + 240 | 13,591 |
| 3 | 13,669 | — | 177 + 0 | 13,846 |

So implicit caching is live on `gemini-3.7-flash` and was not on
`gemini-3.1-pro-preview`: 83% of the second call's prompt was served from cache.
It is best-effort — the third call re-sent a longer prefix and reported none —
so it is a discount that arrives, not a budget that can be planned against.

Two consequences, and only one of them is acted on here.

**The comment was corrected**, because a cost model that says "nothing is
cached" is what a later reader would size `MAX_TOOL_ROUNDS` against.

**The rows were not.** `cachedContentTokenCount` is a slice of
`promptTokenCount`, not a fifth count to add: every call above sums exactly to
the total the API reported, so `usageOf` loses nothing by ignoring it. What it
loses is the *rate* — Vertex bills a cached token below the input rate, and an
`AgentRun` has three token columns with nowhere to keep a fourth. Pricing it
properly is a schema change plus a rates row plus the four write doors, which is
a change to the ledger and not to the migration, and the direction of the error
is the safe one: these rows are the ceiling on a turn, never under the invoice.
`spendSummary` overstates the orchestrator and nothing else, because the
orchestrator is the only agent that re-sends a long prefix within a turn.

Held by two cases in `model-cost.test.mts` (1,951 -> 1,953) reading the three
payloads above: the calls sum to the API's own totals, and the cached slice
stays inside `promptTokens` at the full rate. Mutation-checked with the obvious
"fix" — subtracting the cached count in `usageOf`, which makes the number
smaller and prices the turn under the invoice: the two new cases are its only
killers in the whole suite.

No open-weights tier. A `TRIAGE` alias on Gemma 4 E4B used to exist to filter
the 50–200 candidates agent 1 scraped per browse; uploads arrive pre-filtered
by the user, so the volume that justified a cheap first pass — and the
Ollama or Model Garden serving dependency behind it — is gone.

## III. Agent Topology

The orchestrator (`FLASH`) holds agents 2–4 as `AgentTool` — it needs their
results back. There are no `sub_agents`: every remaining agent is a
request/response call, and intake is a UI action rather than an agent to
transfer to.

Two of the seven numbered items are not agents and never call a model: **1**,
intake, which is a UI action, and **5**, deck export, which is a mapping
(amended 2026-08-23). They keep their numbers — see `product.md`. Where this
section says "agents 2–5" of a shared input or a shared call shape, read it as
2–4 plus 8; item 5 is named separately wherever it still takes part.

### 1. Reference intake — not an agent
The user uploads their own references. The browser `PUT`s bytes straight
to GCS with a v4 signed upload URL, so image data never passes through a
Vercel function and never counts against the request body limit. The row lands
with a `gcsUri` and no provider, licence or attribution fields — the user
owns what they upload, so there is nothing to credit and nothing to hotlink.

This is the same GCS artifact reference agents 2–4 already expected as input,
so the pipeline below is unchanged from the browsing design; it just starts
from an upload instead of a scrape.

### 2. Property analyzer — `FLASH`
Vision call with a pydantic `output_schema` over the six spec dimensions:
color palette, lighting, texture/grain, composition, subject/context,
contrast/depth. Fixed vocabulary per dimension so the tags group rather than
drift — which is what lets §III.5 read them straight into speaker notes with no
model in the path, and what agent 8 sorts a gallery by.

Runs per upload, fanned out across a batch. This is now the first model to see
an image and the main latency sink — see infra §X on backoff.

### 3. Image editor — `FLASH` + sharp — widened 2026-09-01

Called only by the orchestrator, as an `AgentTool`. The orchestrator infers
the inputs from the user's message:

- image: GCS artifact reference
- `intention`: what to crop, e.g. "crop the middle sunflower"
- `ratio`: target aspect after cropping — a specific ratio, or loose
  `square`/`rectangle`

Box format: the model returns `box_2d = [y_min, x_min, y_max, x_max]`, normalized
0–1000, y-first — Gemini's trained detection format. Asking for
x/y/width/height or four corners fights the training and degrades accuracy;
convert to pixels in code.

Loop:

1. Prompt with image + intention + ratio; model returns `box_2d` via
   `output_schema`.
2. Deterministic validation: min < max, box inside the image, box aspect
   within tolerance of the requested ratio.
3. On failure, re-prompt with the validation error appended. Max 3 attempts,
   then the agent reports failure instead of a box.
4. On success, a `FunctionTool` crops and writes the result to GCS, recorded as
   a modified version row linked to the original. That `gcsUri` + row id is the
   pointer the rest of the system uses.

The model never touches pixels — box detection is trained Gemini behavior,
cropping is arithmetic.

The agent ends with a short text result (what was cropped, or why it failed)
plus the pointer, so the orchestrator can answer the user. The chat renders
the cropped image from the pointer via a signed read URL; clicking it opens
the original image's properties tab, scrolled to the modified-versions
section with the crop highlighted (see §IV).

**Step 4, as built.** For a long time it was not built at all. There is no
Pillow and no Python tier: the pipeline is Node, and nothing in it decoded an
image — so `crop_reference` stopped at step 3 and handed back an *offer*, the
four numbers and the frame they were numbers of, which the browser turned into a
row on a canvas, the only thing in this app that could cut pixels (§II.6). The
crop existed a column away and a turn later, and the model could not name the
row it had just asked for.

The codec landed and the step reads as written. `sharp` is a direct dependency,
`src/server/references/cut.ts` reads the *original* out of GCS and cuts the
region, and `makeCrop` files the modified-version row itself — bytes, thumbnail
made in the same pass, `sourceReferenceId`, the edit columns and the analyzer job
in one transaction — then makes the board swap when the cut was asked for a slot,
and answers with the picture and its id. Both doors file through one function
(`src/server/references/file-version.ts`), so the panel's cut and the assistant's
cut cannot drift. The box arithmetic is unchanged and shared verbatim with the
browser's cut; the properties panel keeps its own plan-then-keep flow, because a
user framing a crop by hand is choosing a box and wants to see it first. What
filing a cut nobody wanted costs, how that is paid for, and the five places the
build decided differently from the design are
`orchestrator-tool-reference.md` §IV.

**It is no longer only a cropper — widened 2026-09-01.** The invariant above is
what made the widening cheap: the model answers with numbers and `sharp` does the
pixels, so adding an op is adding a small structured field, not a new capability.
The agent moved to `src/server/agents/image-editor/`, the door is `editReference`
and the tool is `edit_reference` (`edit_image` on the designer). One model call
answers with an ordered *list* of edits rather than one box:

    [{ op: "crop", box, shape? }, { op: "turn" }, { op: "flip" }, { op: "grade" }]

at most one of each, always in that order. `src/lib/edit/edit-ops.ts` is the whole
vocabulary and the validator; `src/server/references/edits.ts` is the only new
sharp importer. Turns are quarter turns said as words (`left`/`right`/
`upside-down`) because sharp's `rotate` is clockwise and humans say "rotate left";
grade knobs are zero-centred integers (−100…100, hue −180…180) so that "leave it
alone" is 0 on every knob, which is why `gamma` is not in the vocabulary.

The crop is first and the order is canonical for three reasons: a box after a turn
is in post-transform coordinates and every overlay would mis-draw it; sharp
reorders anyway (`flip`/`flop` are documented to happen after rotation); and
nothing is lost, because quarter turns and axis flips form D4, so a flip written
before a turn is re-expressible as that turn followed by the other axis. A crop
that is not first is a fault; a shuffled turn/flip/grade is silently canonicalised.

Only a grade earns a second look. A turn and a flip are exact and a crop is already
checked deterministically and shown to the user, but a grade's result cannot be
predicted from its own numbers — so when the accepted list contains one, the agent
renders a ≤768px JPEG preview of the edit and asks again, at most `EDIT_LOOKS = 2`
times. The preview reaches the model as `inlineData` and is never filed: storing it
would put bytes in the bucket the user may never see. Four rules hold the loop
down — a preview that cannot be made means the planned edit simply stands
(`looks` is 0), a fault on a look is swallowed rather than re-prompted, the crop is
not re-openable (the planned crop is re-inserted at the head in code), and the last
look says it is the last. The median edit therefore costs exactly what a crop costs
today; only grading pays. The preview is cut from the model's own box rather than
the aspect-fitted one, so it is judged for colour and not for framing.

The row storage moved with it: `cropBox Int[]` and `editAspect String` became one
`edit Json @default("[]")` (migration `20260901120000_reference_edit_ops`, which
backfills every existing crop into a one-op list). `editIntent` and `editRationale`
stay columns — `relabelVersion` is an atomic column update that would otherwise
become a read-modify-write racing the crop path. `AgentKind.CROPPER` deliberately
stays; see `Metering.md`.

### 4. Moodboard compositor — retired 2026-08-24

**Nothing calls this any more.** `compose_moodboard` is out of
`orchestratorTools`, which is what actually removes it from the model, and out of
the tool layer's dispatch. `compositor.ts` and its only reader
`layout-reader.ts` (agent 9) are under `server/agents/deprecated/`, unmodified;
the declaration is under `lib/agent/orchestrator/deprecated/`, and the executor
`makeMoodboard` is still in `server/agents/orchestrator/tools.ts` and unreachable.

The reason is not that it was wrong. It is that agent 8 (§III.8) does the same
job strictly better: this one is blind and fits blocks into slots of a template
chosen before the call, and that one looks at the page it is making and decides
the arrangement itself, so a page a template could produce is a subset of the
pages a design can. Two accidents were keeping it alive, and both were fixable
without touching agent 8's loop — agent 8 could not *make* a board (now
`add_board`, §III.6's own tool: code, no model call, a row and one empty page),
and agent 8's answer was thinner than this one's (now a read-back report of the
page it left, `server/agents/designer/report.ts`).

The section stands as written below, because the reading behind it — what a
compositor has to be told, why the layout was settled before the call, why the
block list is properties and not pixels — is the record of a design the code no
longer holds.

Called by the orchestrator as an `AgentTool`. Input schema:

- `layout`: enum, one of the 10 layouts below or `RANDOM` (default)
- `layoutImage`: optional — a reference id of a *layout image* to read the
  slots from instead of naming a template (see "Layout reader" below).
  Mutually exclusive with `layout`: the two are both an answer to "what shape
  of page", and a call carrying both is refused rather than guessed at.
- `intention`: the user's intent, passed through by the orchestrator
- block properties: all current blocks (id, type image/text, agent 2 tags,
  aspect ratio)

A layout is a fixed template: page size plus slots, each slot an image or
text block with position and scale. Slot coordinates live in one constants
file, not in the model. The `Page` column below is the page (§V) the
compositor draws around the slots — a composed board opens as one page rather
than as loose elements on a canvas.

| Enum | Page | Slots | Composition |
|---|---|---|---|
| `SPLIT` | 1920×1080 | 2 img | half-and-half diptych |
| `TRIPTYCH` | 1920×1080 | 3 img | three vertical panels |
| `FILMSTRIP` | 1920×1080 | 4 img | one row of cinema frames |
| `GOLDEN_RATIO` | 2048×2048 | 5 img | Fibonacci spiral, shrinking blocks |
| `POLAROID_SCATTER` | 2048×2048 | 5 img + 1 text | tilted, overlapping instant photos |
| `HERO_LEFT` | 1920×1080 | 5 img + 1 text | large hero, supporting column right |
| `MASONRY` | 1080×1920 | 7 img | Pinterest-style staggered columns |
| `EDITORIAL_SPREAD` | 1920×1080 | 5 img + 2 text | magazine spread, headline + captions |
| `MOSAIC` | 2048×2048 | 8 img | full-bleed mixed-size tiles, no gutters |
| `GRID_3X3` | 2048×2048 | 9 img | classic uniform grid |

`RANDOM` resolves before the model is called: a deterministic function maps

> **RECONSTRUCTED FROM CODE — 2026-08-22 (night).** The sentence above is cut
> where the transcript is: everything from "a deterministic function maps" to
> the layout reader's heading (about seventeen lines — the 2026-08-21 heading
> list puts `#### Layout reader` at 165 and the table ends around 148) is lost.
> What follows is that span rebuilt from `src/lib/layout/moodboard-layouts.ts`,
> which implements it and cites `§III.4`. The code wins any disagreement.

the blocks onto a template, so the compositor is never asked to pick a page and
assign to it in the same breath. One rule: seat the most blocks, on the tightest
template that seats them, and break a genuine tie by chance — `resolveLayout`,
with its `pick` injected so a test can say which and a caller that wants the same
board twice can have it.

Seating is counted per kind, not by block count, because a line of text cannot go
in an image slot: only three of the ten templates hold text at all, and the two
that seat six blocks seat *five pictures and a line*. Counting heads alone lost a
photograph off a six-picture board and dropped the headline off a diptych.

`layoutForBoard` is where a rebuild meets that: a template the model named wins,
`RANDOM` means "choose me a new one" and overrides the template on the row, and
otherwise the board keeps the template it was composed at for as long as that
template has room. An empty slot is a board the user recognises; one silently
reshaped is not.

#### Layout reader — `FLASH` vision, optional

> **RECONSTRUCTED FROM CODE — 2026-08-22 (night).** The heading above is
> verbatim and so is the opening of its first bullet, which a transcript holds
> cut mid-line: "- model: `FLASH`. Placeholder detection is the same trained box
> behavior the". The rest of the subsection — about forty lines, line 166 to the
> fragment that resumes below — is lost, and what follows is rebuilt from
> `src/server/agents/deprecated/layout-reader.ts` and `src/lib/layout/custom-layout.ts`,
> both of which cite `§III.4`. The code wins any disagreement.

- model: `FLASH`. Placeholder detection is the same trained box behavior the
  cropper leans on, asked of a drawing instead of a photograph.
- input: the reference id of the layout image, and the `intention` passed
  through. The intention decides nothing here — it is context for the one line
  of prose the reader writes.
- output: one `[ymin, xmin, ymax, xmax]` per mark, normalized 0–1000 y-first,
  each tagged `image` or `text`, plus a `composition` line saying what the page
  *is* for a reader who cannot see it.

A placeholder is a box drawn to *hold* a photograph — an empty rectangle, a
frame with a cross or a mountain glyph through it, a block of flat grey, or a
photograph already sitting on the page, because that is where the next one goes.
The page's own border, rules, margins, logos, ornaments and folios are not, and
a box around the whole page is not a layout.

It sits in front of agent 4 and is invisible to it. The compositor's whole
economy is that no pixel ever reaches it, so the pixels stop here: this file ends
at a list of boxes, `custom-layout.ts` turns them into a page, and from there a
`CUSTOM` layout is briefed exactly as `HERO_LEFT` is — shapes and shares, never
coordinates.

Turning boxes into a page is arithmetic and happens without the model. The page
rect is the preset (§V.1) whose shape is nearest the layout image's own *by
ratio*, and the boxes scale straight onto it rather than being letterboxed
inside it: the picture is the page, and fitting it in would leave a margin the
user never drew. Slots are numbered in reading order (§V.4) — banded by y, then
left to right — because reading order is the whole of what `img-1` means to a
compositor that is told nothing about where a slot is.

The same deterministic validation the cropper's loop runs, with the fault written
for the model because the re-prompt appends it: a box that is not a rectangle, a
side under 2% of the page (a ruled line rather than an opening), more boxes than
a board holds (12), a box tagged neither `image` nor `text`, and a page with text
areas and no image placeholder at all. Three attempts, like the cropper's — a
model that cannot read a page will not read it on the fourth, and each attempt
re-sends the picture — and a re-read that answers with the boxes it was just
told were wrong stops the loop early rather than buying the same answer twice.
Temperature 0.2: reading a page is a reading, not a creative act, and two composes
off one sketch drifting apart would be two different pages under one board.

> **RECONSTRUCTED FROM CODE — 2026-08-22 (night, later).** The last sentence of
> the reconstruction above and the opening of the sentence the surviving fragment
> resumes mid-word at ("slot,") are lost. What follows is rebuilt from
> `src/lib/layout/slot-fit.ts` (`looseFits`, `LOOSE_IN_SLOT_NOTE`) and the three
> places `src/server/agents/orchestrator/tools.ts` reports it. The code wins any disagreement.

A compose answers with what it did rather than only that it was done: what went
on the board, what came off, what was named that the board never carried — and,
only where there is one, so a board that fits costs nothing to say so, which
pictures ended up with page showing around them inside their
slot, and the loose-fit report offers agent 3's cut at the slot's own shape.

Worst fit first, since one board can have several and the orchestrator is being
asked to name them in a sentence. Two pictures are deliberately left out of it: one
whose size was never recorded — nothing to measure, and it is drawn to the whole
slot anyway — and one the cut would not buy meaningfully more of the slot for,
which is the photograph read that changes nothing. The gain is measured against
the *slot* rather than against the nearest of the six crop names, because that is
the shape the cut is now held to (§V), which closes the loop by construction: a
picture cut to its slot fills it, so it is never mentioned again.

A board composed this way stores its slots on the row (`CUSTOM` in
`Moodboard.layout`, the geometry in a new `Moodboard.layoutSlots` column),
because `CUSTOM` names no constants file: a rebuild keeps the custom layout
for as long as it has room, exactly as a template is kept, and cannot
re-derive it from an id. The layout image itself is not stored on the board —
it was the ask, not the arrangement — and it is never a block: a reference
named as the layout image is not also a photograph on the board.

### 5. Deck export — not an agent — amended 2026-08-23

**No model call. One slide per page.** The previous design made this an agent —
`PRO` driving `google.adk.tools.google_api_tool.SlidesToolset`, writing a slide
narrative out of agent 2's tags. It was never built, and it should not be: by
the time a board has pages on it, every judgement the deck could make has
already been made. Which references, which crop, where on the page, what
background, in what order — those are the pages, and the pages exist. A model
asked to "build a deck from this board" has nothing left to decide, so what it
would actually be doing is *re-deciding*, non-deterministically, work the user
already approved. That is not a feature, it is a way to lose the board.

So the deck is a mapping:

| Board | Deck |
|---|---|
| a page, in reading order (`pagesInReadingOrder`) | a slide, in the same order |
| the page's server-side render | the slide's full-bleed image |
| the analyzer tags of the references on that page | the slide's speaker notes |
| the page's own background colour | the slide's background |

It lives in `src/server/decks/`, **not** `src/server/agents/` — the directory is
the claim. The invariant is that nothing on this path imports
`server/google/vertex.ts`, and that is a test rather than a habit (§VII's
pattern): `decks/no-model.test.mts` walks the module graph from the export entry
point and fails if a model function is reachable from it.

**The picture is the one already drawn.** §III.8 built `renderForModel` — a
server-side raster on `sharp`, cached in GCS under `renders/` and keyed by page
id, board revision *and* the renderer's fingerprint. The deck reads that same
object. It does not draw its own, because two rasterisers for one page is the
disagreement `render:check` exists to hunt, and because a deck of an unchanged
board should be byte-identical every time it is exported. **Export is a pure
function of (board revision, renderer fingerprint).**

**Slide size, when pages disagree.** A Slides presentation has one page size for
the whole deck, fixed at `presentations.create`. A board's pages need not agree.
The deck takes the board's **most common** page size; a page of any other size
is fitted inside it, centred, on that page's own background colour. Modal rather
than first, because a six-page set with one odd cover should size to the six.

**Speaker notes carry the why, without a model writing them.** Each slide's
notes list the references standing on that page and their agent 2 tags —
palette, lighting, texture, composition, subject, contrast. This is the value
the old design wanted from `PRO` (a deck that explains *why* each reference is
there), and it turns out the explanation was already structured data. Reading it
out is a template.

**One `create`, one `batchUpdate`.** The deck is created empty, then every slide
request goes in a single `batchUpdate`, so a failure leaves either an empty deck
or a complete one — never a deck missing page four. Images are handed to the
API as v4 signed read URLs on the cached render objects (`SIGNED_URL_TTL_SECONDS`
is 900, comfortably longer than the batch).

**Auth — this closes infra §VIII.** That decision defaulted to a service account
"unless deck ownership matters". It matters. Everything else in this app is the
user's own content — they upload it, they own it, nothing is hotlinked or
credited — and a deck of their work owned by our service account and shared by
link contradicts that. The export runs on the **user's** OAuth credential, which
the app already mints for sign-in (§IV), widened by two scopes:
`presentations` and `drive.file`. `drive.file` is per-file and covers only what
this app created, so the consent screen is not asking to read the user's Drive.
The deck lands in their Drive, owned by them, and the app keeps only its id.

The service-account path is dropped rather than kept as a fallback: two auth
paths to one API is two things to get wrong, and the SA's Drive quota was
already a stated reason not to accumulate decks there.

**What the orchestrator sees.** `build_deck` stays a tool on agent 6, but as a
`FunctionTool` rather than an `AgentTool` — agent 6 decides *when* to export and
says the sentence about it; it does not delegate a judgement, because there is
none to delegate. See `agent-tools.md` §12.

**`PRO` is now called by nothing, permanently.** It was already uncalled (§II);
this was the last design that named it. It stays declared and priced so §II's
floor argument still has its subject, and `model-floor.test.mts` is unaffected —
that test asserts what the *called* models are.

**Amended 2026-09-01 — built, and three things above are wrong.** The export
landed as `src/server/decks/` plus a Preview-tab panel. The mapping held, the
no-model invariant held (`decks/no-model.test.mts` walks the graph from
`deck-export.ts` and is green), and `previewOrder` rather than
`pagesInReadingOrder` is the slide order — the rail is where the user says what
the deck is. Three claims did not survive contact.

*The picture is the browser's, not `renderForModel`'s.* "The picture is the one
already drawn" pointed at the `renders/` object. That object is the
**model-facing approximation** — `compositor-v2.md` is explicit that it draws
unsupported elements as bounding outlines, and that nothing it draws is ever
shown to a user "because labelling an approximation as their export is the one
way this becomes a bug report about a font". A deck is the most user-facing
artifact in the app. It takes the Preview tab's own `exportToCanvas` render,
PUT to the revision-keyed page path Design already writes
(`moodboard.pageRenderUploadUrl`), so the deck and the PDF and the preview are
all one picture. The cost is stated plainly: **export is no longer a pure
function of (board revision, renderer fingerprint)** — it is a function of
(board revision, the browser that drew it), and `render:check` no longer covers
this path. That is the price of the deck matching what the user approved, and
the preview is what they approved.

*There is no modal page size to pick.* `presentations.create` ignores every
field but `title` — *"Other fields in the request, including any provided
content, are ignored"* — and no `batchUpdate` request mutates presentation page
size. An API-made deck is permanently Google's default 10 × 5.625 in
(720 × 405 PT). So every page is fitted and centred, not just the odd ones. In
practice this is mild: `PAGE_PRESETS.LANDSCAPE_HD` is 1920×1080, exactly 16:9,
and is the fallback preset, so a typical board is full-bleed; portrait and
square pages get pillarbox bars. If portrait decks ever matter, the escape is a
PPTX — which *can* carry any slide size — converted by Drive on upload, covered
by the same `drive.file` scope. Recorded, not built.

*And the background under those bars is the board's, not the page's.* "That
page's own background colour" has no source in this codebase: `pageBackground()`
finds a full-bleed *image*, and the only colour anywhere is board-wide
`appState.viewBackgroundColor` via `canvasBackgroundColour`. Frame elements
carry a `backgroundColor` Excalidraw never paints, so reading it would put the
slide and the render into exactly the disagreement this section exists to
prevent. `deckSlides` still takes a colour per call, so the day a per-page
colour exists only the caller changes.

*One `create`, one `batchUpdate` became four calls.* `speakerNotesObjectId` is
auto-generated on a slide's notes page and is readable only from
`presentations.get` after the slides exist — it cannot be supplied on
`createSlide` or predicted. So: `create` → `batchUpdate` (the whole visual deck)
→ `get` (notes ids only, `fields`-limited) → `batchUpdate` (the notes). The
atomicity this paragraph was defending is untouched, because the deck itself is
still exactly one batch — never a deck missing page four. The only new partial
state is a complete deck without notes, and the export reports it as
`notesWritten: false` rather than swallowing it.

*Two smaller notes.* `webViewLink` is constructed as
`https://docs.google.com/presentation/d/{id}/edit` rather than read back from
Drive, which saves a fifth call; if Google changes that URL shape, that is the
line that breaks. And a **PDF deck** landed alongside the Slides one, built
entirely in the browser from the same `pageCanvas`: one PDF page per board page
at that page's own aspect, so the fitting problem above simply does not arise
there.

### 6. Orchestrator — `FLASH`
Multi-tool routing over agents 2–4 and 8 as `AgentTool`, plus the plain
`FunctionTool`s — `generate_image` (§III.7), the board reads and edits, and
`build_deck` (§III.5). The distinction is not cosmetic: an `AgentTool` is a
judgement delegated and its result is another model's answer, a `FunctionTool`
is work done. Agent 6 decides *when* to export a deck and writes the sentence
about it; the export itself decides nothing.

### 7. Image generator — `IMAGE`

Called by the orchestrator as a tool (`generate_image`). The one capability in
the system that makes a picture out of nothing, and it exists for the picture
the gallery never holds: the background. A composed page puts photographs in
slots on a bare white rect; when the user wants a mood the gallery cannot
supply — a paper texture, a dusk gradient, a wash behind the grid — the
orchestrator can buy one instead of explaining that it cannot.

> **RECONSTRUCTED FROM CODE — 2026-08-22 (night, later).** The `description`
> bullet below is verbatim as far as "the user's" and is cut there by the
> transcript; the rest of §III.7 — about twenty-four lines, since the 2026-08-21
> heading list runs the section from line 221 to §IV at 259 — is lost. What
> follows is rebuilt from `src/server/agents/image-generator/image-generator.ts`, from
> `generateImageFor` in `src/lib/agent/agent-tools.ts`, and from
> `context/orchestrator-tool-reference.md`'s `generate_image` entry, which
> documents the same tool from the model's side. The code wins any disagreement.

- input: `description` — what the picture should show, carrying the user's
  intent and what the brief says the project looks like: the subject, the light,
  the colour, the mood and the style, written out. Nothing else is sent — the
  model drawing this cannot see the project, the board or the conversation, so a
  line that only makes sense beside them makes no sense to it.
- input: `shape` — optional, and already read out of `crop_reference`'s dialect
  by the executor rather than here: a *format* is a ratio the user names, a
  *loose* shape is a word for a kind of shape. An unreadable one is refused with
  a sentence before anything is spent, the way `makeCrop`'s is.
- model: `IMAGE`. The one agent whose model is not the text tier, which is why
  the answer and the refusal both carry the model they were bought on rather
  than leaving the caller to name it.
- output: the picture's own bytes and mime type, the attempts they cost and the
  tokens. This file ends at bytes: the bucket, the reference row, the analyzer
  job and the catalog are the executor's half, which is what lets the loop
  around the model be exercised without a bucket or a database.

**The shape is a canvas where the API has one, and a sentence only where it has
not.** `config.imageConfig.aspectRatio` is a live field — verified 2026-08-18 on
the REST body's `generationConfig`, which is where the SDK's flat `config` puts
it: an invalid value is refused as a value rather than as an unknown name, and
`16:9` came back 1376×768. Ten canvases are native, 21:9 through 9:16, and an
asked shape lands on the nearest by *proportion* rather than by difference, so
2.39:1 lands on 21:9 and a portrait misses every landscape canvas by as much as
its mirror image. A loose word names a kind of shape rather than a ratio, so it
gets the moderate canvas of its kind rather than the extreme. Only what the
canvas cannot say then rides the prompt — an exact ratio the API does not take
natively, or a loose shape no canvas represents — because the user's dialect is
wider than the list of ten.

**Two attempts, not three.** A failed generation is not charged, the prompt is
not improved between attempts, and a second refusal in a row is the model saying
no to this description rather than to this throw of the dice. Where the cropper
and the layout reader re-prompt with the fault they found, there is no fault to
send back here: the prompt is what it is.

Three answers are told apart, because the orchestrator is about to write a
sentence to the user about each. A block decided on the description alone
(`promptFeedback`) is the one refusal a second attempt cannot change — the same
words reach the same reader — so it is answered once, and the answer steers at
the description rather than at another go. An answer that arrives with no image
is the model refusing rather than the pipeline failing, and the sentence kept is
the model's own: the text it wrote, else its `finishMessage`, else its
`finishReason`. The call not landing at all is neither, and by then the transport
has already exhausted its own backoff (infra §X), so "busy" means busy for the
whole turn — which is why that one is read off the thrown value's `retryable`
flag rather than through `instanceof`, the way a refusal's tokens are.

### 8. Design assistant — `FLASH` vision + a tool loop

Agent 8, added 2026-08-22. Alongside agents 4 and 6 rather than in place of
either: nothing above changes, and `compose_moodboard` stays the way a moodboard
gets made. Full spec, including the system instruction and every tool contract,
is `compositor-v2.md`.

What it is: a **design assistant on this platform**, for the work that is not a
moodboard — a wedding welcome sign, a banner, an album spread, a concept sheet, a
poster. It differs from agent 4 on three axes and every other decision falls out
of them.

| | agent 4 | agent 8 |
|---|---|---|
| sight | none — "no pixel ever reaches it" | pages, boards and photographs, as pictures |
| geometry | code's; the model emits pairs of ids | the model's; it writes boxes |
| call shape | one call, one answer | a tool loop, many rounds |

- Called by the orchestrator as an `AgentTool` — `design_page`, gated on
  `boards > 0`, no per-turn ceiling (`compositor-v2.md` §VI: one design a turn
  turned "a poster and a banner" into two messages, and `TURN_TOKEN_CEILING` is
  the bound that reads the bill instead of counting calls) — so the sentence the
  user reads is still agent 6's, exactly as agent 4's `note` is.
- **And by the user directly** — "Let's Vibes" (`compositor-v2.md` §IX): a form
  on the canvas taking a purpose, a page count, a palette, a vibe and a page
  size, which makes a new board with that many empty pages and runs one design
  call per page, browser-driven and sequential because this app has no job queue.
  The only place an agent runs without a chat message asking it to, and the
  reason the run is still written into the conversation. Both doors build an
  `intention` and call the same `designPage`; two doors are allowed and two
  prompts are not. Both are built: `vibes.designPage` reads the brief back off
  `Moodboard.vibesBrief` — the nullable `Json` column "Let's Vibes" writes and
  no other board carries — and the contract test that used to say "one door
  opens onto agent 8" now names both and asserts that neither assembles the
  agent out of its parts.
- Toolsets: the five canvas tools unchanged (`canvas.md` §XI) plus a sixth,
  `restyle_on_canvas`; the page tools plus a new `get_page` that answers with
  §V.4 *and the page's picture*, and `set_page_background`; a gallery read side
  (`list_gallery`, `get_image`, `get_modification`), the two byte-making tools
  (`generate_image`, `crop_image`), and `get_skill`.
- **It can say what things look like, which agent 4 never could** (`canvas.md`
  §XI, "the style dialect" — designed, not built). A fourth object kind, `shape`:
  rectangles, ellipses and lines with a fill, a stroke and an opacity, which is
  what a colour field, a scrim behind a headline, a border or a rule is made of.
  Type gains a colour, a family named rather than numbered, an alignment and a
  size that is not clamped to the box. Pages gain a background, which is a real
  rectangle rather than the frame's own unfilled `backgroundColor`. The whole
  dialect is agent 6's too — a door that forks is a board that drifts — with one
  exception: `set_canvas_background` paints the desk the user's pages sit on and
  is the orchestrator's alone.
- **The renderer has been ahead of the read.** `render-plan` has always drawn
  rectangles, ellipses, lines and arrows; `object-read` has always dropped them.
  That was harmless while no model could see, and is a straight contradiction now
  that one can — so shapes become readable in the same change that makes them
  writable, and the kinds that stay unwritable are *named* in an `unaddressable`
  remainder rather than silently missing (`canvas.md` invariant 13).
- **`get_skill` is the new idea.** Thirteen named files of written expertise —
  seven occupations (wedding, banner, album, photographer, digital artist,
  concept artist, environment artist) and six foundations (colour theory,
  composition, typography, visual hierarchy, light and shadow, grid systems) —
  returned whole, no model call. They are what replaces the ten templates: agent
  8 places freely, so the knowledge that used to be baked into a constants file
  has to arrive as text it can read.
- Model: `FLASH`, like every text and vision agent (§II). `PRO` is 3.1 and below
  the floor, so a design read that degrades has no better model to fall back to.
- A generation is **not complete until the bytes are in GCS and the `Reference`
  row is filed** — the id in the answer is one `put_on_canvas` accepts on the next
  round. Agent 2's job is the one thing not awaited, since the analysis is not
  what the next tool call needs and `drawnFrom` covers the gap.

**Pictures are drawn on demand, and that is new.** Every picture in this system
until now was made by a browser at a revision — a page at send time (§V.5.1), a
board after 20 s of autosave idle — and every write agent 8 makes moves the
revision, so the "look at what you just made" step would ask for an object nobody
had drawn. `renderForModel` (`compositor-v2.md` §III.2) closes it: a server-side
raster built on `sharp`, which is already a dependency, drawing the elements
directly rather than driving a headless browser, cached per revision under a
`renders/` prefix of its own. The invariant it exists for is that **no vision
tool ever sends a picture of a revision other than the one it read the scene at,
and it reads at call time** — so the words and the picture in one answer can
never describe different scenes. It is a prerequisite rather than a follow-up.

It also retires §VI's "a page can only be pictured by a tab with a canvas in
it": pages of other boards become picturable. Whether it should then *replace*
the browser's send-time render is settled at `compositor-v2.md` §III.2.1 and the
answer is not yet — the browser's page render turns out never to be shown to a
user, so replacing it is tempting, but it would move an approximation and a
cold-render latency onto agent 6's ordinary turns to save code. Build it for
agent 8, diff the two on real boards, then decide.

## IV. Web App

> **RECONSTRUCTED FROM CODE — 2026-08-22 (night).** The original §IV is lost (see
> the banner at the top of this file). What follows is not it: it is this section
> rebuilt from the code that cites it and from the decisions those call sites
> record. Sentences in quotation marks are verbatim §IV text preserved inside a
> code comment; everything else describes what is built, in this file's voice,
> and may say in different words what the original said. Treat a disagreement
> between this section and the code as the code being right.

One page per project, `/projects/[id]`, server-rendered with the project and its
references prefetched and handed to a client workspace. Two views of the same
project — the reference gallery, where photographs arrive and are inspected, and
the moodboard, where they are arranged — with the orchestrator's column beside
both. The column is collapsible, so it does not own the conversation: it reads
the project's chat log and drives turns through it.

**The model works blind.** It has no view of the page and no view of a board's
scene except through a tool call — "the model cannot see what is on a board". Two
things follow, and both are load-bearing:

- a destructive call says in words what it is about to remove. "Shall I drop page
  2" with nothing after it is a question about a rectangle the user cannot see
  the model looking at;
- every tool the project can answer at all is declared, and on a project holding
  nothing that is exactly one: `generate_image` takes no id, so there is nothing
  a project could be missing that would make the call impossible. A user talking
  about the look before they have uploaded anything is who it is for.

**A reply is a way into the work, not a picture of it.** "A result the user cannot
open is a result they have to go find again by hand." So an attachment rendered
in the chat carries what it takes to draw it *and* what it takes to walk to it:

| clicked | opens |
|---|---|
| a photograph | its properties panel |
| a crop | the original frame's properties, "with that version highlighted" |
| a board | the board, as a board |

A crop is the case that needs two facts rather than one. A cut has no tile and no
panel of its own — it is a row in the versions list under its frame — so the
frame id alone is the right panel and the wrong answer: a frame with nine cuts
under it leaves the user hunting the row the assistant just showed them. The cut
id rides with it, the list scrolls to that row, marks it, and draws its box on
the frame above. The mark is taken once and cleared, so a user who opens the
frame again an hour later is not dragged back to a cut they already read.

Image bytes never pass through a Vercel function: the browser `PUT`s to GCS with
a v4 signed URL (§III.1) and reads back through signed read URLs.

### The column holds many conversations — designed 2026-08-23

The paragraph above says the column "reads the project's chat log", and that was
one log. It is now several: a project holds many conversations, the column shows
one of them, and a conversation can be emptied without being deleted. The design,
the entity, the migration and the reasoning are
`orchestrator-tool-reference.md` §VII; what belongs here is what changes about
this page.

The column grows a **header** — the open thread's name, the switcher that lists
the project's threads newest-spoken-in first, "New chat", and the two destructive
doors behind a confirm. Everything below the header is what it already was.

Three things about it are decided here rather than there, because they are
properties of the workspace and not of the format:

- **A conversation is a thread of talk, not a partition of the project.** The
  gallery, the boards, the pages and the brief are the project's, and every
  thread sees all of them. A picture drawn in one conversation is in the grid the
  other one is looking at; a board composed in one is on the tab row for both.
  What is per-thread is what was *said*.
- **Which thread is open is the window's, not the project's.** It is remembered
  in `localStorage` per project and validated against the list on load. There is
  no column on `Project` naming it: two tabs on one project would write it
  against each other, and the loser would have its column swapped out from under
  a half-written message.
- **Clearing a conversation destroys the record and none of the work.** The
  boards, pages, cuts and generated pictures the cleared turns produced all
  stand — the conversation is the account of the work. What the confirm has to
  say is the part that is genuinely lost: after a board or a picture has been
  deleted, the tile's snapshot in the chat is the only place its title survives.

The chat store (`chat-log.ts`), which already lives outside React so the collapse
arrow cannot delete the conversation, keys by conversation instead of by project
— and so does everything it holds that is not a stored row, the draft included.
Switching threads mid-sentence costs nothing, for the same reason collapsing the
column costs nothing.

## V. Pages

> **RECONSTRUCTED FROM CODE — 2026-08-22 (night).** The original §V is lost (see
> the banner at the top of this file). What follows is not it: it is this section
> rebuilt from the ~270 places in `src/` that cite `§V.1`–`§V.5` by number and
> from the code those citations sit on. Sentences in quotation marks are verbatim
> §V text preserved inside a code comment; everything else describes what is
> built, in this file's voice, and may say in different words what the original
> said. The subsection numbering is the original's, recovered from a heading list
> in a session transcript, so `§V.1`–`§V.5` and `§V.5.1`–`§V.5.3` still mean what
> the code comments citing them mean. Treat a disagreement between this section
> and the code as the code being right.

A board is an unbounded excalidraw scene. That is right for arranging and wrong
for reading: a board handed to the orchestrator as one flat list of eight ids
says nothing about what sits beside what. A page is the unit that fixes it —
"one page is one picture, so what the board looks like — what sits beside what,
at what size, cut off by which edge — can reach the prompt. Nothing else in the
prompt carries arrangement."

Pages are also what the user already means. A spread is pages; a compose lays out
one page; "put this on the exteriors page" is a sentence about one.

### 1. The entity

A page is a **frame carrying `customData.page`**. Not a new element type and not
a Prisma row:

- a frame already is a named rectangle that owns what it contains, and every
  host-side edit is already frame-aware, so a page inherits tidy, drop-joins and
  export-the-section "for the price of a marker";
- geometry stays in the scene. A `Page` table with x/y/width/height would be a
  second copy of numbers the user changes by dragging, and the copy is the one
  that goes stale.

So there is exactly one authoritative fact stored — that this frame is a page —
and everything else is read off the rectangle: its size, its name, its position,
and which pictures are on it.

**The rectangle is authoritative** — "the size it actually is", not the preset it
was created at. Pages come at three preset sizes (`LANDSCAPE_HD` 1920×1080,
`PORTRAIT_HD` 1080×1920, `SQUARE` 2048×2048), named in the layout module rather
than the page module because they are the sizes the templates are cut to: a
fourth size with no template behind it is a page the compositor has nothing to
lay out on. The size *label* is derived from the rectangle every time it is read
and is "Custom when resized", within a pixel of tolerance so a page dragged onto
fractional pixels does not read as Custom for a rectangle nobody touched. The
marker keeps the preset it was created at, which is the only thing a stored
preset can still honestly say — "it was a LANDSCAPE_HD before I dragged it" —
and is null on a frame promoted to a page in place.

"Resizing a page is allowed and changes nothing else." Nothing is laid out again,
nothing is re-composed, no model is called.

**The name is the frame's, and it is "the user's to edit."** Renaming a page is
the same ask as renaming a board, one level in. An unnamed page is `""`, so the
board's name array stays positional and a page's index is its ordinal.

**A page may never contain a section.** "Excalidraw does not nest frames, so a
page cannot contain a section — a board uses one or the other." A page drawn over
a section the user drew is allowed to *look* like that and is not allowed to
become it: a `frameId` naming a frame is a scene excalidraw has no rendering for.
The consequences run right through the module — a page drawn around a section
does not adopt its photographs, a discard leaves both behind, a copy does not
take them, a tidy leaves the section's own photos to the section, and the export
rewrites no frame's ownership.

**Sections keep `frameId`; pages do not.** A section owns what it *contains*, by
`frameId` — that is what a section is here. A page holds what is geometrically on
it (§V.3). The two are asked in opposite ways on purpose, and a tidy that asked
both by `frameId` contradicted every page read twice over.

**The board row's page fields.** `Moodboard.widthPx`/`heightPx` stopped being the
board's page and became the board's *default* page size — what agent 4 draws a
first page at and what `add_page` falls back to on a board holding no pages. Two
derived columns ride beside them, rewritten by the same statement that writes the
scene so they cannot drift from it: `pageCount` and `pageNames`. They are not a
second copy of the geometry this section refuses to store — the rectangle, the
name and the contents stay in the frame — only what the *priming* needs, because
a board's scene is megabytes and the boards brief is built from small columns.
`layout` names the template *the board's first page* was composed at, which is
why a page read never takes the board's word for its own template (§V.4).

### 2. Create another page

A page arrives with **nothing laid out**: a rectangle, a name, and no model call,
no slot, no picture chosen and no picture moved. Three hands make one — agent 4
draws a page under an arrangement it decided, the model calls `add_page`, and the
user presses the board's own control — and all three land on this same
deterministic geometry.

**Where it goes.** On a board that already has pages: to the right of the
*rightmost* page, one fixed `PAGE_GAP` (120px) clear of it, top-aligned with and
the same size as the source page — the selected one, else the last created. The
rightmost rather than the source, because a page landing on top of one further
right is a page the user cannot see; the source's size rather than the board's
default, because a spread is pages of one size. The gap is a fixed number rather
than a share of the page, so a spread reads as a spread at any zoom and two pages
of different sizes need one gap rather than each their own.

**On a board with no pages**, the page is drawn *around* what is already on the
board, at the board's default size, centred on the existing content. This is the
one gesture that moves nothing and changes what everything on the board belongs
to: the two boards this subsection exists for are the hand-made board that has
never been composed and must not be, and the board that wants an empty page to
work on. Adoption is not optional decoration — geometry already says those
pictures are on the page and every page read agrees, but excalidraw's own drag
reads `frameId`, so a page that did not adopt them would be a rectangle the user
drags out from under their own board. Sections and the photographs inside them
are stepped over (§V.1), which is why a hand-made board's first page can be drawn
around everything and still own less than everything.

**Promotion in place.** A frame the user already drew is marked as a page where
it stands. Nothing moves. A board divided into sections before pages existed is
one gesture away from being readable a page at a time, rather than being
rebuilt to get there.

### 3. Which images are on a page

**Membership is geometric, and it is never `frameId`:** a page holds the elements
whose **centre** falls inside its rectangle. "An element's `frameId` can name a
frame it no longer sits inside, and a photo can sit on a page without ever having
been adopted by it." The description of a page has to agree with its render, and
the render is geometry.

The centre rather than the box, so a photograph overlapping two pages is on one
of them; **topmost wins** where pages overlap, which is the page the user sees it
on. Both halves matter: the render's own rule answers yes for every page a centre
falls in, which is right for drawing — excalidraw draws a picture once wherever
it lies — and wrong for describing, because "a photograph described as being on
two pages is a board where a page is a query rather than a unit."

One rule, written once, and used by every reader and every writer: the page
read, the page-scoped edits, the tidy, the render, the export, the canvas object
read, the reference-usage read and the drop-join all ask it. An element with no
readable rectangle is on no page rather than on the first one.

**What a page's own elements are**, for an act on the page: what geometry puts on
it, minus frames, minus anything a section owns. Discard and duplicate share the
definition, because "a copy that included what a discard leaves behind would be a
page the user cannot get back to."

**Drop-join precedence.** A photo landing on the board — dropped, pasted,
imported — joins a section if the section *contains* it, else the page it is
geometrically on. Sections are asked first, and that is a precedence rather than
a preference: asked by containment alone the page would win, being the later and
so topmost frame.

**Reading order is the page's own**, not the board's. The board decides two
things are one row by overlap, which is the least wrong answer on an unbounded
canvas and the wrong one on a page: a column-height picture down the left chains
every other block into one row, so "the third one" walks across the page rather
than down it. A page has a height to divide by, so it is banded — a band is a
tenth of the page height, measured from the topmost block still unread rather
than off fixed tenths, by the block's *top* edge — then left to right within a
band. Content-anchored bands cannot chain, and a fixed grid would put two blocks
the user sees as one row a band apart.

Text is on the page as much as the photographs are: a template's headline and
captions are part of what the page says.

**The export is the one place ownership is rewritten**, and only in a copy made
for the exporter. Excalidraw draws a frame's picture from what overlaps it and is
not owned by another frame, so a photograph squarely on this page whose `frameId`
still names the page it was dragged off would be missing from the picture and
present in the description. Geometry adopts it for the drawing; nothing is
written back; frames are never rewritten.

### 4. `PageAIRepresentation`

A page as the model reads it. Three parts, and they are sent together or the
model is guessing: "a page the model was handed but whose blocks were left out is
a picture it has to guess about; the properties without the picture are a list
with no arrangement."

**The picture.** The page rect drawn by a canvas (§V.5.1) — the one thing about a
page the browser is authoritative for.

**The page's own line.** Which board, which page of how many, its name, the
rectangle as it stands, the derived size label, and `layout?` — "the template, if
composed". The template is a claim about *this page*, never the board's: the row
carries one id describing its first page (§V.1), so on a spread it is as often as
not the wrong word. Silence is the honest answer, since a template name that does
not describe the boxes is a model reasoning about slots nobody is using. The two
tool ids ride on this line too, so "put the stairwell on this page" does not cost
a round of `inspect_board` to find out which page "this" is.

*Amended — two readings of the page ride on that line at the asked door.* Both
come off the render plan rather than off the blocks, so neither exists at the
attached door, where the picture is the browser's and there is no plan on this
side of it: `occupancyNote`'s sentence says how much of the frame the work
stands on band by band, and `contrastNote`'s says which lines of type stand too
close in colour to what they are laid on, by the id `restyle_on_canvas` takes
(`compositor-v2.md` §IV.2, §VIII). Neither is a block and neither can be read
off one — the blocks carry boxes and words and no colour at all.

**The blocks.** Every element on the page as a box, in the page's reading order,
in the catalogue's own line format so a picture on a page and a row in the
catalogue describe a reference the same way and the model is not learning a
second dialect mid-prompt.

Blocks are pictures and lines of type, and — once the style dialect lands
(`canvas.md` §XI) — shapes: a filled rectangle behind a headline is not
decoration a page read can leave out, it is the composition. Shapes compete for
the same `PAGE_BLOCK_CAP` and the omitted count already accounts for what did not
fit. The page's own line grows its `background` for the same reason; a page
printed on charcoal and a page printed on white are two different design
problems, and nothing else in the representation says which one this is.

**Built (shapes).** A shape block carries the shape, the colour it is standing
in and its opacity when that is not whole — `rectangle · #0c111c · 45% opaque ·
[0,0,1000,1000]`. Which colour is said depends on the shape: a rule is drawn in
its stroke, and a rectangle with a transparent fill is `outline in #f4efe6,
nothing behind it`, because a border round the type and a field under it are the
same element wearing two different fills and the model puts the headline in the
wrong place if it cannot tell them apart. Stroke width, dashes and rounded
corners stay out: they are what a restyle takes, not what an arrangement is made
of, and `read_canvas` carries them. The page's `background` is still to come
with `canvas.md` §XI.4.

*Amended — the fade is not a shape's field.* `45% opaque` was said of a shape
block alone, and both style doors write `opacity` on a photograph and a line of
type as well. It is arrangement rather than appearance on the split above — what
a scrim is *over* is still on the page, and a reader told a picture stands there
reads the page a 40% photograph hides rather than the page it is — so it is now
said of whichever block carries it: `text · “under it” · 30% opaque ·
[0,0,100,900]`. A text block's own colour, family and size stay on the other
side of that line, in `read_canvas`, because this brief rides under a picture
that shows all three and the pairs a reader has to act on arrive named in the
legibility note (`compositor-v2.md` §VIII). `canvas.md` §XI.5's last
**Corrected** block is the whole reading.

The box is `[ymin, xmin, ymax, xmax]`, **normalized 0–1000 against the page rect,
y-first** — the format Gemini returns boxes in (§III.3) and the one the crop rows
are stored in, so it is a dialect already being read in this prompt. Normalizing
is what lets a 1920×1080 page and a 2048×2048 one be described in one vocabulary:
"half the width" is 500 on both.

Every block carries `z`, the stacking order with 0 at the back, "because a
collage's overlap is the thing array order was carrying" — reading order drops it
on the floor. It is *said* only for the blocks it disambiguates, on the rule that
a fact is worth a line only where it disambiguates, which in practice means
POLAROID_SCATTER and the pages the user dragged together by hand. A block running
over the page edge is marked clipped, because the box is the part the page shows
and without the mark an overflowing picture reads as a small one against the
edge.

Not here, deliberately: the *properties* of the pictures — the catalogue already
carries those, and a page read that restated them buys the same paragraph twice.

**Two caps**, and they are two different questions:

| cap | bounds |
|---|---|
| `PAGE_BLOCK_CAP` = 24 | how many things are described. A page holding more than two dozen things is a page whose arrangement is not what the model is missing |
| the render's own size cap | the picture. A page is a fraction of a board, so it inherits the board render's |

A block past the cap is said rather than silently dropped — something is on this
page they have not been told about — in one omitted line. The first block line is
always kept: a page answered with no blocks is a page the model can say nothing
about.

*`PAGE_BRIEF_CHAR_BUDGET` was the third and is removed.* It capped how *long* the
description could run — 3,000 characters, derived as
`HISTORY_CHAR_BUDGET / PAGES_PER_MESSAGE` so that two attached pages cost at most
what the conversation behind them does.

The reason to drop it is that the two caps were doing the same job at different
levels of honesty. `PAGE_BLOCK_CAP` bounds the description by *things on the
page*, which is a fact about the page and reads as one — twenty-four blocks and a
line saying how many were left out. The character budget bounded it by *how much
was written about them*, which cuts in the middle of a set of blocks that are all
individually worth describing, and produces a page the model believes it has been
shown and has only been shown most of. A user attaches a page precisely because
they want it read; a half-read page is the failure the attachment exists to
prevent.

What bounds it now: `PAGE_BLOCK_CAP` 24 blocks, `PAGES_PER_MESSAGE` 2 pages a
message, and the turn's own `TURN_TOKEN_CEILING`. That leaves the page brief as
**the one input to a turn with no size ceiling of its own** — it rides in the
user's message, so no window touches it, and it is re-sent on every round of the
turn. Twenty-four richly-tagged blocks is the worst case and it should be
measured rather than assumed: `npm run floor` and the spend rows are where a
regression would show, and the honest answer if it does is a wider
`PAGE_BLOCK_CAP` argument rather than the character budget coming back.

*Measured.* The worst case as built — one page, `PAGE_BLOCK_CAP` blocks, every
one of them a cut of a photograph carrying all six tag dimensions plus a keeps
line, under a head carrying the standing and legibility notes and the stacking
sentence — is **6,559 characters, 2,375 tokens**, and at `PAGES_PER_MESSAGE`
**4,750 tokens** a round. Against the orchestrator's floor of ~15.3k a round
that is a third again on the rounds a page rides, and against
`TURN_TOKEN_CEILING` 300k it is not close to anything. The old budget cut that
page at 3,000 characters, so the price of reading a page whole rather than
mostly is a little over double, paid only on the turns a user attaches one. Not
alarming; the number to watch is the spend rows on turns with two pages
attached, since it is the round count that multiplies it.

*Amended — the caps say how many blocks are described; `byReach` says which*
(`lib/pages/page-blocks.ts`; 2,955 → 2,959 cases). Both cuts used to spend in
reading order, which is the order the blocks are *said* in and runs top to
bottom: taking the first two dozen of a 49-block page takes a horizontal slice
of it. Measured over the 82 pages on the development database, 10 are over the
cap and 72 blocks go undescribed — and on the two densest, both agent 8's, the
described two dozen were 16 and 18 blocks from the top third, 8 and 6 from the
middle, and none at all from the bottom third that twelve blocks stand in. So
the second look was telling a design its page stops halfway down. Both cuts now
spend on the blocks that reach furthest across the page — the longer of a box's
two sides, so that a rule with no area at all is measured by its length rather
than sorted below every caption — and the survivors are still said in reading
order: the same two pages come out 7/7/10 and 9/7/8 across the thirds. The
omitted line says which they were rather than only how many: *"17 more blocks
are on this page and are not described — the smallest things on it."* The
character budget followed the same order for the same reason and bit on no page
here, which is part of why it went: a second cut that never fires is a second
way to read a page wrong.

Nothing stores this. It is not a wire DTO and not what the chat draws a page
chip from; it exists for the length of one prompt.

### 5. How a page reaches the prompt

Every other page read in this codebase is one the *model* asked for —
`inspect_board` names a board and gets its pages back. This is the other
direction: the user picks a page in the chat and the message carries it.

The picker lists the pages of the board the tab is showing, off a second read of
the stored scene rather than off the editor's copy — the editor's is fetched once
and never refetched, because excalidraw owns the scene from the moment it mounts.
Reading the stored scene is also the honest list: what goes up is built from it,
so a page drawn a second ago and not yet saved is not one of the pages the model
could be handed. The chip under the composer says the two facts a page is chosen
between by — how big it is and how many blocks are on it — counting blocks rather
than pictures, because that is what the model will be handed.

**`PAGES_PER_MESSAGE` = 2.** Two, because the user picking pages is comparing
them — "this one against that one" — and because each page is an image part plus
a text block on *every tool round of the turn*. Clicking a picked page takes it
back off; a third pick drops the oldest rather than being ignored, because at two
a message the third pick is the user changing their mind about the first, and a
picker whose tiles stop responding reads as broken.

The attachment is **per-message, not sticky**: the send empties it.

A page is addressed by **board and id, never id alone** — duplicating a board
copies its element ids verbatim, so two boards in one project can carry the same
page id.

#### 5.1 The picture

The browser is authoritative for exactly one thing about a page — what it looks
like — because a canvas is the only place an element array can be drawn.
Everything the model *reads* is built on the server from the stored scene.

The tab flushes its pending save, reads what the autosave landed on, then draws
and uploads the page at that revision through a signed `PUT` the server refuses
to sign when the board has already moved past it. The object is named
`.../pages/<pageId>@<revision>.png` — per revision, never overwritten in place,
unlike a board's render — because a page attached to a message is a picture of
the board as it stood when that message was sent, and a later render landing on
that object would rewrite what the model was shown out from under the row that
recorded it.

"The tab re-renders once, and if it still disagrees the page goes up as text
only." Two attempts and never a third: the user pressed send, and a board being
edited while it is being sent can disagree forever. Only an idle board is
pictured. A *failed or conflicted* save is the case the rule exists for — there
the revision has stopped moving while the canvas keeps changing, so a picture of
what is on screen would go up labelled with a revision the server does match, and
be handed to the model as a picture of a scene nobody stored.

Only pages of the board the tab is showing can be pictured at all. A page of any
other board has no canvas mounted on it, so it goes up as text alone.

#### 5.2 What the message carries

A **pointer**, not a description: board id, page id, the revision, and the render
uri if one was taken. Nothing said about the page is decided in the browser.

A pictured page is carried at the revision the picture is *of*, not the one it
was picked at — the flush usually moves the board on a revision, and the picture
and the number the server holds it against have to be the same moment. A page
with no picture keeps the revision it was listed at, which is the scene the user
was looking at when they chose it. The page's name is dropped on the way out: it
is the user's label for a tile on screen, and the server reads the name off the
scene it is describing.

#### 5.3 What the server does with it

Every field is client input and none of it is trusted: the board is re-read
against the project, the page against the board's own scene, and the uri against
the one this server would have signed for that upload. A page whose board is not
this project's, or whose id names no page on it, is not attached and is not in
the turn's row.

The server builds §V.4 from the stored scene and emits, per page in pick order,
the picture part and then the page in words. Those parts are **prepended to the
user's own sentence** rather than sent as a turn of their own: they are context
the user chose *for* what they are about to say, and a message whose words arrive
before the thing they are about is a question about nothing.

Whether a picture rides above the text is **said in the text**, never left to be
assumed — a page that went up without its render says so, because a model told
nothing would answer about a picture it was never shown.

## VI. Risks
- `PRO` is preview: rename risk mid-event. Single-constant indirection. Since
  2026-08-22 nothing calls it — it is the fallback for a flash read that
  degrades (§II) — so a rename is now a stale constant rather than an outage.
- The demo now depends on the user having reference images to hand. Keep a
  fixture set to upload on stage — this replaces the cached-references fallback
  that used to cover a flaky live browse.
- Upload is a new failure surface: HEIC and other non-web formats, phone-sized
  files, and a signed URL that expires mid-upload. Constrain accepted MIME
  types at mint time rather than validating after the bytes have landed.
- A page can only be pictured by a tab with a canvas in it, which is why the
  chat's picker is scoped to the board being shown. Pages of other boards need
  their scene loaded and their images hydrated before anything can be drawn —
  out of scope until the first version is standing. **Retired by `renderForModel`**
  (§III.8, `compositor-v2.md` §III.2) once that lands: a server-side raster can
  draw any page of any board, and the picker's scope becomes a UI choice rather
  than a limit.
- A page render is an image on every tool round of a turn. Two pages on a
  three-round turn is six copies of it. Measure it against Cloud Monitoring
  before deciding the per-message cap is two.
- A generated image is a ~1.8 MB PNG from the priciest call in the system,
  and the failure mode is a redecorating loop — the per-turn cap
  (`GENERATE_CALL_LIMIT`) is the only thing between that loop and the bill.
  Keep it low and watch the `AgentRun` costs once real turns use it.
- The layout reader is a second Pro vision read on the composes that use it,
  and its failure mode is quiet: a decoration read as a placeholder is a slot
  nobody drew, visible only as a board that looks wrong. The validation loop
  catches malformed boxes, not misread ones — keep a couple of layout images
  in the fixture set and eyeball the boards they produce.

- `renderForModel` is a second renderer for the same scenes, and a shape it
  draws differently from excalidraw's export is a page agent 8 judges differently
  from the user. The subset is small and this app writes all of it; a scene
  pasted in from elsewhere is not the subset, which is why anything outside it is
  drawn as an outline and named as undrawn rather than left out.
- **The board has a style vocabulary the agents have never had, and it is a
  taste surface with no test on it** (`canvas.md` §XI). Free placement made bad
  arrangement possible; fills, strokes and type families make bad *colour* and
  bad *type* possible on top of it. The `colour-theory`, `composition` and
  `typography` skills carry the weight, and they were written for an agent that
  could not set a hex.
- **The page background is a rectangle that has to be invisible to eight other
  code paths** (`canvas.md` §XI.4). It is an ordinary element so that excalidraw,
  the exporter and `renderForModel` all draw it for free — the price is that
  every read must exclude it, every write must refuse it, tidy must skip it and
  resize must carry it. `arrangeableUnits` today collects every live element with
  an id, so the miss that costs the most is the cheapest to make: one press of
  tidy sweeps a page's own ground into the photo grid.
- **`set_canvas_background` is the first agent write that is not an elements
  write.** `appState` is a separate column and none of the scene conflict story
  reaches it — no revision guard, no keyed queue, no no-op detection. Written
  naively it silently acquires none of the three, and the symptom is an idle tab
  handed a conflict for a repaint that changed nothing. **Built** with all three
  brought to it by hand (`canvas.md` §XI.3): the write carries `appState`,
  `revision` and `renderRevision` and deliberately not `elements`, and the no-op
  is asked against the colour the board is *drawn* on rather than the one its row
  carries — a row with no colour and a row carrying `#ffffff` are the same pixel.
  The tool is agent 6's alone and agent 8's floor did not move for it.
- Agent 8 places freely, so nothing in the system can make a bad arrangement
  impossible the way agent 4's constants file did. The guards are a skill, a
  picture and a second look, and none of them is a test. Keep a fixture set of
  asks — a welcome sign, a banner, a three-photo spread — and eyeball the pages.
- Agent 8's cost is pictures, and pictures are what it will always want more of.
  The picture window and the per-call picture cap are the only backstops; watch
  the `AgentRun` rows before raising either.
- The skills are unversioned prose reaching the model with system-prompt
  authority — a bad paragraph in `colour-theory` is a bad paragraph in every turn
  of every project. They are code files for that reason; review them as code.
- One board can now carry both agents' work: a page composed by agent 4 and then
  adjusted by agent 8 stops standing as composed, and `inspect_board` will say
  so. Correct, and it will read as a bug the first time somebody sees it.

## VII. Model Access — Gen AI SDK

Every model call in the project is a hand-rolled `fetch` in
`src/server/google/vertex.ts`. That satisfies "Gemini through Vertex AI" and
fails "a Google agent framework" (§I), and it is the whole of the second
unmet requirement. The fix is to put `@google/genai` — the Gen AI SDK for
TypeScript, one of the four frameworks named — underneath `vertex.ts`.

ADK was considered and rejected for the same reason it was never built: it is
Python, and adopting it means a second runtime, a packaging step and an Agent
Engine deploy, for a checkbox that one npm package clears. If a stronger agent
story is wanted later, the cheap version is to put **only** the orchestrator
(§III.6) behind Agent Runtime, since `server/google/agent-runtime.ts` and the
`agent.start` row already exist for it.

### What the SDK actually is

Read off `@google/genai@2.18.0` as installed, not from docs:

- **Node ≥ 20**, deps `google-auth-library ^10.3.0`, `p-retry`, `protobufjs`,
  `ws`. The project pins `google-auth-library ^11` directly, so npm will nest a
  second copy — harmless, but the `GoogleAuthOptions` type we hand the SDK comes
  from v11 and is checked against v10. Confirm `npm run typecheck` before
  believing it.
- **Constructed** `new GoogleGenAI({ vertexai: true, project, location,
  googleAuthOptions })`. `enterprise: true` is the same flag under the platform's
  new name (infra §XI) and is the one the SDK now recommends; setting both to
  different values throws.
- **Credentials**: `googleAuthOptions` is `GoogleAuthOptions` from
  google-auth-library, so the inline service-account credentials this project
  already parses (`env().GOOGLE_SERVICE_ACCOUNT_JSON`) pass straight through.
  This is the thing that makes the SDK usable on Vercel at all — infra §VI:
  there is no metadata server and therefore no ambient ADC.
- **`location: "global"`** is handled exactly as `apiHost()` handles it: the SDK
  branches to `https://aiplatform.googleapis.com/` for `global` and to
  `https://${location}-aiplatform.googleapis.com/` otherwise. Our host rule can
  be deleted, not ported.
- **The request shape is flatter.** What the REST body nests under
  `generationConfig` the SDK takes at the top of `config`.
- **Retries are off unless asked for.** The SDK's fetch wrapper returns the
  response unretried when `httpOptions.retryOptions` is absent — the defaults
  (5 attempts, 1s initial, 60s cap, base 2, jitter 1, on 408/429/500/502/503/504)
  only apply once the object is passed. Passing nothing is not "keep the
  defaults", it is "no backoff", which would silently delete the thing §X of
  infra exists to describe.
- **Errors** are `ApiError { message, status }`. On a non-JSON error body the
  SDK puts the raw text — the throttling HTML — inside `message` as
  `{"error":{"message":"<html>…","code":404,…}}`. So the HTML-vs-JSON signal
  survives the SDK and can still be read; it is just read off a string instead
  of a `content-type` header.

### The seam that must not move

`generateContent(model, contents, config)` — positional, in that order — is
injected as `generate` into the cropper, the layout reader, the image generator
and the orchestrator (and, since 2026-08-23, the analyzer and the compositor),
and is faked under `typeof generateContent` in five test files. **Keep that signature.** The SDK's parameter-object call
(`ai.models.generateContent({ model, contents, config })`) belongs inside
`vertex.ts` and nowhere else. Adopting it at the call sites turns a one-file
change into a rewrite of every agent and every fake for no behavioural gain.

### Field mapping

| Today | Under the SDK |
|---|---|
| `config.systemInstruction: string` wrapped into `{parts:[{text}]}` | `config.systemInstruction` — takes a bare string |
| `config.tools: [{functionDeclarations}]` | `config.tools` — same shape |
| `config.generationConfig.responseMimeType` | `config.responseMimeType` |
| `config.generationConfig.responseSchema` | `config.responseSchema` |
| `config.generationConfig.temperature` | `config.temperature` |
| `config.generationConfig.responseModalities` | `config.responseModalities` |
| `response.candidates[].content.parts` | unchanged |
| `response.candidates[].finishReason` | now the `FinishReason` enum, not `string` |
| `response.candidates[].finishMessage` | unchanged |
| `response.promptFeedback` | unchanged |
| `response.usageMetadata.{promptTokenCount,candidatesTokenCount,thoughtsTokenCount}` | **unchanged** — `usageOf` and the whole cost ledger keep working untouched |

The flattening is the one change that reaches outside `vertex.ts`: five agents
build a `generationConfig` object and two test files assert on one.

### `GeneratePart` becomes a flat type

Our `GeneratePart` is a discriminated union and the code narrows it with
`"text" in part`. The SDK's `Part` is a single interface with every field
optional — `text?`, `inlineData?`, `fileData?`, `functionCall?`,
`functionResponse?`, plus `thought?` and `thoughtSignature?`. Two consequences:

- `"text" in part` still works at runtime (the wire object only carries the keys
  it has) but stops narrowing a type, so every read becomes `part.text ?? ""`.
  The narrowing sites are `vertex.ts` (3), `lib/agent/tool-window.ts` (3),
  `orchestrator.ts` (2), and 19 more across six test files.
- `FunctionCall.name` is optional in the SDK, so `functionCallsIn` hands back a
  possibly-nameless call and the orchestrator's round loop has to say what it
  does with one. It already treats an argless call as an emission to preserve
  rather than obey; a nameless one is the same case.

Worth taking rather than resisting: `thoughtSignature` is a real field on the
SDK's `Part`, and Gemini 3 tool-calling requires signatures to be echoed back.
The `wire` field added in the conversation-format work preserves them
byte-for-byte today by keeping the raw part — under the SDK that preservation
becomes typed instead of incidental.

`lib/agent/conversation.ts` and `lib/agent/tool-window.ts` import these types
into browser-loaded code. They are type-only imports and erase, which is why
importing from a `server-only` module is safe there today; importing the same
types from `@google/genai` is safe for the same reason. Either keep re-exporting
through `vertex.ts` or import from the SDK directly — but pick one, because the
`ToolDeclaration` in `lib/agent/agent-tools.ts` is a third structural copy of
`FunctionDeclaration` that exists only to dodge the `server-only` import, and it
can now go.

### Behaviour that has to survive the swap

1. **The HTML-404 throttle** (infra §X). 404 is not in the SDK's retry ladder
   and must not simply be added to it — a genuine missing model returns a JSON
   404, and blanket-retrying would turn a config error into four wasted calls and
   a slower failure. Keep the discrimination: pass the SDK the default status
   ladder, catch `ApiError`, and retry a 404 only when its `message` carries an
   HTML body.
2. **`VertexError.retryable`.** Callers use it to write the sentence a user
   sees — "the service was busy" vs "the request was wrong". Whatever wraps
   `ApiError` has to keep answering that question; `image-generator.test.mts`
   imports `VertexError` and asserts on the real class.
3. **`finishReason` comparisons.** `lib/agent/model-finish.ts` compares against
   string literals (`MALFORMED_FUNCTION_CALL` and the `FINISH_REPLIES` keys).
   Against the SDK's enum those comparisons need the enum or a widening — a
   silent `false` here costs a round-trip retry the orchestrator counts on.
4. **The empty-candidate path.** A candidate with no parts plus a
   `finishMessage`, and a whole-request refusal arriving as `promptFeedback`
   with no candidate at all, are both live-observed and both tested. Neither
   shape changes under the SDK, but both must keep flowing through — do not
   "simplify" the response read to `response.text`.
5. **Injected fakes stay honest.** The fakes return plain objects shaped like a
   response. The SDK's `GenerateContentResponse` is a *class* with `text` and
   `functionCalls` getters. Do not start reading those getters in agent code, or
   every fake in the suite becomes a lie that still typechecks.

### What stays on REST

`src/server/google/agent-runtime.ts` — `:query` and `:streamQuery?alt=sse`
against a `reasoningEngines` resource — has no equivalent in the SDK's model
surface and keeps using `vertexFetch`. So `vertexFetch` stays exported even
after `generateContent` stops using it. It is reached from `agent.start` and
throws while `AGENT_ENGINE_RESOURCE` is unset, which is the current state.

**Amended 2026-08-22 (night):** "stays exported" is a licence and is now bounded
by a test. `agent-runtime.ts` is the only file that may call `vertexFetch`, and
no file at all may spell a model endpoint's verb — see "The boundary, as a test
rather than a habit" below for why the host rule alone left that door open.

**Known undefended, 2026-08-22 (late night):** *where* this module may call is
held; *what it sends and how it reads the answer back* is not. Six mutations
leave all 1,982 cases green — the `AGENT_ENGINE_RESOURCE` guard deleted, either
`class_method` renamed, the `:query` verb renamed, `alt=sse` dropped, the
`data:` prefix left on the line before `JSON.parse`, and blank lines yielded as
parse errors. Two of the six are `streamQuery`'s SSE reader, which has no caller
at all today; `query` has one, `agent.run`. Neither function takes an injected
transport and `vertexFetch` is imported directly, so closing these needs either
a seam or the SSE line-reading extracted as something pure — a decision, not a
test to write, which is why this is recorded rather than done. Worth noting
while it is open: the reader has no `finally` releasing its lock, so a consumer
that breaks out of the `for await` early leaves the response body open.

**Closed 2026-08-23:** the decision above went to the seam, on the precedent
this section already sets for the model calls — `generateContent` is injected
into four agents as a positional default and faked in five test files, and the
transport here is injected the same way. `query(input, send = vertexFetch)` and
`streamQuery(input, send = vertexFetch)`; `AgentTransport` is exported as
`typeof vertexFetch` so a fake is held to the real signature. Nothing at the
call sites moved — `agent.run` still calls `query(input)`.

`src/server/google/agent-runtime.test.mts`, 7 cases (1,982 → 1,989), each
verified as the sole killer of the mutation it was written for:

| Mutation | Killed by |
|---|---|
| the `AGENT_ENGINE_RESOURCE` guard deleted | no request goes out, and the message names the key |
| `class_method: "query"` renamed | the blocking call's body read back |
| `class_method: "stream_query"` renamed | the streamed call's body read back |
| `:query` renamed | the blocking call's path read back |
| `?alt=sse` dropped | the streamed call's path read back |
| the `data:` prefix left on before `JSON.parse` | three spellings on the wire — with a space, without one, and none |
| blank lines yielded | the frame separators and a keep-alive are not events |
| `buffer += value` → `buffer = value` | an event split across two reads |
| `reader.cancel()` → `releaseLock()`, or removed | an early `break` leaves the body open |

The lock note above is fixed rather than recorded: the reader loop is inside a
`try` whose `finally` cancels. `releaseLock()` — the obvious reading of the note
as written — is not enough and is one of the mutations above: it unlocks a body
that is still open. Only the cancel closes it, and it has to be the generator's
job because a caller that breaks has no handle on the reader.

**What the seam broke, and what that says about source rules.** Injecting the
transport took `vertexFetch(` out of `agent-runtime.ts`'s source text — it names
the transport at its import and as a default, and calls the *parameter*. The
boundary rule "the REST transport that stayed is called by the one surface it
stayed for" was anchored on `/vertexFetch\(/` and so went green reporting one
file, having lost the entry it exists to hold. It now matches a call *or* a
binding import, which is what "reaches the transport" means and is the one
spelling prose cannot produce by accident — five files name `vertexFetch` in
comments and none of them may hold it. A source-text rule is coupled to the
shape of the code it scans, not only to its behaviour, and a refactor that keeps
every test green can still hollow one out.

### What the swap actually looked like — landed 2026-08-22

`@google/genai@2.18.0`. Every model call in the app now goes through
`ai.models.generateContent`; the only hand-rolled `fetch` left is `vertexFetch`,
and it serves Agent Runtime alone. Verified live through `npm run smoke` against
`global`, one agent at a time:

| Agent | Live reading |
|---|---|
| Orchestrator | "what have I got in here?" — 3 model calls over 2 tool rounds, `list_references` + `show_references`, 3 attachments, 12.3s, $0.01 |
| Cropper | a 1:1 cut on a named corner — 2 model calls over 1 tool round, the cut filed and captioned, 20.4s, $0.01 |
| Compositor | "make me a moodboard from everything in here" — `compose_moodboard` over 2 rounds, a 4-photograph filmstrip board, 18.6s, $0.02 |
| Image generator | a 16:9 lamp room — `generate_image` + `show_references`, the PNG filed as a reference, 59.7s, $0.18 |
| Analyzer | `--drain` over the three queued pictures — 3 processed, 3 succeeded, 0 failed |

The layout reader was not probed again: its call is the cropper's call with a
different schema, and the flattening it took is the same three lines.
`npm run floor` runs through the SDK's `countTokens` too and comes back with the
same shape it did on REST — the tokenizer did not move under the swap.

**Six places where the section above met the code and the code won:**

1. **`auth.ts` is not unchanged.** The SDK's `googleAuthOptions` is
   google-auth-library's *options object*, not a built `GoogleAuth` — it
   constructs its own client from it. So `auth.ts` grew a `googleAuthOptions()`
   that `googleAuth()` now builds from, and the credentials are still derived in
   one place. Its return type is deliberately left to inference: the SDK nests
   its own google-auth-library v10 beside this project's v11, and the two
   spellings of `GoogleAuthOptions` are not assignable to one another even
   though the same object satisfies both. Annotating it is the one way to make
   this fail to compile.
2. **`apiHost` survives; `modelPath` does not.** `vertexFetch` still needs a
   host for Agent Runtime. `modelPath` had one caller left — `scripts/floor.mts`
   POSTing `:countTokens` — and that moved onto a new `countTokens(model,
   contents, config)` export beside `generateContent`, on the same positional
   seam.
3. **`ToolDeclaration` cannot go.** The SDK's `FunctionDeclaration.parameters`
   is its own `Schema`, whose `type` is the `Type` *enum*; every declaration in
   `agent-tools.ts` is plain JSON Schema written as string literals, and
   `"OBJECT"` is not assignable to `Type.OBJECT`. The wire takes both spellings,
   the compiler takes one. So a structural declaration stays, and the cast to
   `GenerateContentConfig` is made once, inside `generateContent`.

   *Amended 2026-08-22 — see "The two names for one shape" below.* The swap as
   first landed kept **two** of them: `agent-tools.ts`'s `ToolDeclaration` and a
   character-identical `FunctionDeclaration` in `vertex.ts`, meeting at the
   orchestrator's `tools` parameter. That is one declaration more than the enum
   problem asks for.
4. **`ApiError` cannot be caught with `instanceof`.** The SDK ships a CJS build
   and an ESM build of the same module, and `.ts` and `.mts` files in this repo
   resolve to different ones — two `ApiError` classes, each failing the other's
   identity check. The throttle retry tests `name === "ApiError"` and a numeric
   `status` instead, which is what it reads off the error anyway.
5. **`finishReason` needed no widening.** `FinishReason` is a *string* enum, so
   it assigns to `string` and every literal comparison in `model-finish.ts` keeps
   working untouched. There is now a test that compares against the real enum
   members, so a rename would fail loudly rather than answer `false`.
6. **`vertexFetch`'s ladder gained 408**, because it is now shared with the one
   handed to the SDK and a request-timeout is worth a second ask on both.

Two things went exactly as written: `usageMetadata` needed no edit anywhere, and
the `generateContent(model, contents, config)` seam did not move — no agent and
no test fake changed shape, only the config object they build.

One new thing on the console: the SDK `console.debug`s "The user provided Google
Cloud credentials will take precedence over the API key from the environment
variable" on every client construction. It is unconditional when `credentials`
are passed and means nothing here.

### Change list

| File | Change |
|---|---|
| `package.json` | `+ @google/genai` — **done**, 2.18.0 |
| `src/server/google/vertex.ts` | **done** — SDK client behind the same exports; `modelPath` deleted and `apiHost` kept for `vertexFetch`; `VertexError` now wraps `ApiError`; retry policy re-expressed as `retryOptions` + `throttleRetried`; `+ countTokens` |
| `src/server/google/auth.ts` | **done** — `+ googleAuthOptions()`, which is what the SDK is handed and what `googleAuth()` now builds from (see 1. above) |
| `src/server/agents/analyzer/analyzer.ts` | **done** — `generationConfig` flattened. Model already `FLASH` — §II landed 2026-08-22 |
| `src/server/agents/deprecated/compositor.ts` | **done** — same |
| `src/server/agents/cropper/cropper.ts` | **done** — same |
| `src/server/agents/deprecated/layout-reader.ts` | **done** — same |
| `src/server/agents/image-generator/image-generator.ts` | **done** — `responseModalities` and `imageConfig` flattened; stays `IMAGE` |
| `src/server/agents/orchestrator/orchestrator.ts` | **done** — `functionCallsIn` nameless-call handling, part reads. Model already `FLASH` |
| `src/server/agents/orchestrator/tools.ts` | **done** — no edit needed; its `GeneratePart` construction sites are all assignable to the SDK's `Part` as written |
| `src/lib/agent/tool-window.ts` | **done** — part reads under the flat type, and a `functionResponse` with no name skipped rather than named `undefined`. `conversation.ts` needed no edit: it only ever builds parts |
| `src/lib/agent/agent-tools.ts` | **done** — `ToolDeclaration` stays and is now the only copy of it (see 3. above and the amendment below) |
| `src/lib/agent/model-finish.ts` | **unchanged** — a string enum needs no widening (see 5. above); covered by a new test |
| `src/lib/agent/model-cost.ts` | **unchanged** — no new model id, and `usageMetadata` survived the swap field-for-field |
| `src/server/api/routers/reference.ts` | **unchanged** — attribution already moved with §II |
| six `*.test.mts` files | **done** — config shape in two fakes, part reads in six. `+ vertex.test.mts` (the HTML/JSON 404 line, `VertexError.retryable` on both sides) and a `FinishReason` case in `model-finish.test.mts`: 1,910 → 1,917 |

The `model → FLASH` rows above landed with §II, ahead of this section, because
§II had to land first and had to land alone: a model swap and a transport swap
in one commit leaves no way to say which of the two a worse crop came from. What
this section landed is the transport.

It came to 11 source files and eight test files. One module changed
meaningfully; the rest was the config flattening and the part-type read, and
four of the rows above turned out to need nothing at all.

### The two names for one shape — landed 2026-08-22

`vertex.ts` no longer declares a `FunctionDeclaration` of its own. It imports
`ToolDeclaration` from `agent-tools.ts` and uses it in `GenerateConfig.tools`
and `CountConfig.tools`; the orchestrator's `tools` parameter, the only place
outside `vertex.ts` that named the other spelling, now names this one too. One
declaration, in the module where every value of it is written.

The direction is the only one that works, and it is not the direction 3. above
assumed. `agent-tools.ts` is loaded in the browser to render what a tool
answered, so it cannot reach a `server-only` module *at runtime* — but a type
import is erased, so `vertex.ts` reaching the other way costs nothing and breaks
nothing. `tool-window.ts` has done exactly this since before the migration; its
comment cited `agent-tools.ts` as the counter-example for the wrong reason, and
now says the real one.

### The boundary, as a test rather than a habit

`src/server/google/sdk-boundary.test.mts` (three cases, 1,917 → 1,920) walks
`src/` and `scripts/` and asserts that `@google/genai` is named by `vertex.ts`
and by the two test files that assert against the real SDK, and that
`aiplatform.googleapis.com` is named by `vertex.ts` alone.

Both are requirements this document states in prose and nothing in the type
system defends. The next agent that needs a model call can `import {
GoogleGenAI }` into its own file and get a working answer — and a second client
is a second auth path, a second retry ladder, and a burst throttle (infra.md §X)
that only one of them knows how to read. The second case is the same
requirement from the other end: a hand-rolled `fetch` at a model URL has to
spell the host, and `apiHost()` is the one place that does.

A third case asserts the walk found more than a hundred files, because a
boundary test that silently scans nothing passes forever.

**Amended 2026-08-22.** The walk itself now lives in
`src/server/google/source-tree.ts` and is shared with §II's
`model-floor.test.mts`, which asserts the eligibility floor the same way. It is
a plain `.ts` and not a `.test.mts` on purpose: the test glob is
`src/**/*.test.mts`, so a helper written as a test file and imported by another
test file would register its own cases a second time and inflate the count the
migration is measured by. It also resolves — `tsx` finds `./source-tree` as
`.ts` and does not try `.mts`.


**Amended 2026-08-22 (night, later): the floor under every rule, asserted.**
Six test files now ask their question by walking this tree and grepping what
comes back — `sdk-boundary.test.mts`, `model-floor.test.mts`,
`generate-seam.test.mts`, `db-path.test.mts`, `auth.test.mts` and
`run-price.test.mts`. None of them can be stronger than the walk, and nothing
asserted the walk. Eleven mutations planted in `source-tree.ts` against the
2,039-case suite:

| Mutation | Before | After |
|---|---|---|
| `SOURCE` narrowed to `/\.ts$/` — `.mts` and `.tsx` stop being source | 4 rule cases fail | killed, +2 here |
| `GENERATED` pointed at a directory that does not exist | 1 rule case fails | killed |
| `walk` stops at directories instead of recursing | 15 rule cases fail | killed, +3 here |
| `search(needle) >= 0` → `> 0` — a needle at the file's first character | **survived** | killed |
| `search` → `test` — a needle carrying `g` answered from `lastIndex` | **survived** | killed |
| `.sort()` dropped from the returned hits | **survived** | killed |
| `readFile` without `"utf8"` — bytes where a rule expects text | 7 rule cases fail | killed, +5 here |
| `webApp` root off by one directory | 21 rule cases fail | killed, +10 here |
| string needle matched with `startsWith` instead of `includes` | 8 rule cases fail | killed |
| `TEST` loosened to `/\.mts$/` | 1 rule case fails | killed |
| `sourceFiles` walks only its first directory | 1 rule case fails | killed |

Three survived a green suite outright, and all three are behaviours the file's
own comments claim. The `>= 0` one is the sharpest: a rule's regex that happens
to match at a file's first character reports that file clean, which is the one
answer a boundary rule must never give by accident. The `test` one is the
comment's own stated reason for using `search`, unasserted; and because the
match happens inside an async `map`, a global needle's `lastIndex` carries in
*completion* order, so the multi-file form of that mutation is not
deterministic. The case is written against a single file with `lastIndex`
pre-set to the file's length instead — a caller's leftover state, stated
directly.

The other eight were already fatal *somewhere*, which is the second reason this
file exists: a rule failing because the walk beneath it broke says nothing about
which of the two is wrong. Three of those (recursion, the missing `"utf8"`, the
wrong root) fail most cases here too — a foundation has no small breakages —
and the two needle-fixture cases were deliberately moved off the `/^import /`
anchor so the index-0 mutation is killed by exactly the case written for it.

`src/server/google/source-tree.test.mts`, 11 cases (2,039 → 2,050). Each case
asserts its own premise where it depends on a real file's contents — that the
module opens with an import, that the generated client holds source at all, that
the fixture list did not arrive already sorted — so a case cannot rot into a
vacuous pass when the tree around it changes.

Verification: `npm run typecheck && npm test && npm run lint && npm run floor &&
npm run build` all green at 2,050. No live proof applies and none is claimed —
this file reads the repo and never leaves the process.


**Amended 2026-08-22 (night, second): the host rule did not finish the job.**
The two cases above read as a complete statement of "no model call is a
hand-rolled `fetch`", and they are not. `vertexFetch` is exported — it has to
be, Agent Runtime has no SDK equivalent (see "What stays on REST" above) — and
it already knows the host, the `/v1/` prefix and the bearer token. A model call
written through it names neither `@google/genai` nor `aiplatform.googleapis.com`
and passes both cases. Adding a `readAgain()` to `cropper.ts` as a `vertexFetch`
POST at `.../models/${model}:generateContent` left both green.

Three cases (1,948 -> 1,951) close it, each saying who may hold one piece of a
hand-assembled request:

| Rule | Allowed | Killed the mutation |
|---|---|---|
| `vertexFetch` is called or imported by | `vertex.ts` (declares it), `agent-runtime.ts` | the `cropper.ts` call above |
| `accessToken` is named by | `auth.ts` (mints it), `vertex.ts` (the one `Authorization` header the app writes) | a bare `fetch` carrying a bearer token in `analyzer-worker.ts` |
| a model endpoint's verb is spelled by | nothing at all | the `:generateContent` in the `cropper.ts` call |

The third has no allow-list, which is what makes it the strongest of the three:
the SDK composes those paths itself and the app never sees one, so any file
spelling `:generateContent`, `:countTokens`, `:predict` and their neighbours is
assembling a model call by hand whatever transport it then hands it to. The
pattern is anchored on the character before the colon — a resource path's last
character — because unanchored it also matches its own alternation syntax and
reads `generate-seam.test.mts`'s `(?:generateContent|countTokens)` grep as a
violation. `vertex.ts`'s comment about the floor script's old hand-rolled POST
was reworded for the same reason: prose naming what a rule forbids is a text
hit like any other.

The first is matched at the call rather than by name, because `image-generator.ts`
explains its retry budget by naming `vertexFetch` in a comment, and a comment is
not a second transport.


**Amended 2026-08-23 (later): the guard on the numbers could not fail.**
`npm run cites` is the standing guard on this spec's own hard constraint — do
not renumber a section, 469 call sites cite them — and it is the one instrument
here that had nothing under it. Fourteen mutations planted in `scripts/cites.mts`
against the real `context/`, each run through the script itself:

| Mutation | `npm run cites` said |
|---|---|
| `## VII.` loosened to any heading depth — `### III.` opens a section | every one resolves |
| a `##` line read as a sub-id — `§V.3` invented from a heading | every one resolves |
| `headed` never set — a headed section's list items become ids | every one resolves |
| `if (!headed)` dropped — list items always become ids | every one resolves |
| a numbered line before any section counted | every one resolves |
| a citation read one level deep — `§V.5.1` becomes `§V.5` | every one resolves |
| a heading read one level deep | every one resolves |
| a named doc resolved against every doc — `infra §III` passes on `tech-spec.md`'s | every one resolves |
| only a citation's section resolved — `§III.4` answered for by `§III` | every one resolves |
| `infra` removed from the doc-name table | every one resolves |
| the walk narrowed to `.mts` | **144** citations, every one resolves |
| the generated client walked | **427** citations, every one resolves |
| the section's own id not defined | 166 unresolved — caught |
| the last section never closed | 1 unresolved — caught |

Twelve of fourteen. The last two rows are the only reason the script has ever
been believed: a mutation that makes it *narrower* than the docs shows up as
dangling citations, and every mutation that makes it wider or blinder reads
exactly like success. The two count rows are the sharpest — scanning only
`.mts` took 423 citations down to 144 and the report did not change a word, so
the number in the output is not evidence that anything was looked at.

The split is between what is a function of the checkout and what is a function
of text:

- `src/lib/util/citations.ts` — `sectionIds` (what a doc defines), `citationsIn`
  (what a comment cites, with the doc-name table) and `resolves` (whether a
  citation lands). Pure text in, ids out; no `fs`, so it costs the bundle
  nothing and can be asserted against inline fixtures.
- `scripts/cites.mts` keeps the checkout half — reading `context/`, walking the
  tree, printing. The resolving still cannot be a test case, for the reason it
  always could not: `context/` is gitignored, so a suite that read it would fail
  on a fresh clone. That was never a reason the *parsers* could not be.

`src/lib/util/citations.test.mts`, 16 cases (2,050 → 2,066). All 16 mutations
above that survive in the parsers are killed, 11 by exactly one case. The
cascades are honest and small: the section-id mutation fails 4 cases because
most fixtures assert a section, and "any word is a doc name" fails 3 because a
prefix that is not a doc is how most citations in this repo are written.

The two walk mutations are closed by deletion rather than by a case. `cites.mts`
had its own `walk` — a second tree walker, with its own idea of what a source
file is — beside the one six test files already ask their rules through. It now
calls `sourceFiles("src", "scripts")`, so both mutations are the ones §VII's
`source-tree.test.mts` table already kills ("only `.mts` walked" fails 15 cases,
"generated walked" fails 1).

That reuse also closed a gap nothing had noticed: the old walk read `src` alone,
so a citation written in a script resolved against nothing. `floor.mts` cites
`§VI` and `db-tunnel.mts` cites `tech-spec §VIII.2`, and neither had ever been
checked. 423 → 442 citations on the same docs, all resolving; 469 with this
subsection's own new files.

Verification: `npm run typecheck && npm test && npm run lint && npm run floor &&
npm run build` all green at 2,066, and `npm run cites` at 469. No live proof
applies — the script reads the repo and never leaves the process.

### The retry policy, held as a test — added 2026-08-22 (night)

Behaviour 1 above ("the HTML-404 throttle") was covered on one side only.
`vertex.test.mts` drives `throttleRetried` and holds the 404 discrimination for
the SDK transport well — six cases, against the real `ApiError`. What nothing
held was the *other half* of the same policy: the ladder handed to the SDK.

`GoogleGenAI` gives no reading of the options it was constructed with, so a
ladder written straight into the constructor call is a policy nothing can ask
about. Deleting `httpOptions` entirely left all 1,941 cases green — and that
deletion is precisely the mistake the SDK invites, because absent that object
the SDK hands back the first response whatever it says. It is "no backoff", not
"the defaults".

The fix is one extraction and one new file:

- `clientOptions()` is split out of `client()` in `vertex.ts` and exported. It
  is built fresh on each call; `client()` still caches the one `GoogleGenAI` the
  process holds, so the token caching that motivated the cache is unchanged.
- `RETRYABLE_STATUSES`, `RETRY_ATTEMPTS`, `isThrottle` and `isThrottledCall` are
  exported. The last two are the same decision made twice — `vertexFetch` still
  has the response headers, and the SDK has thrown them away by the time an
  `ApiError` reaches us and re-wrapped a non-JSON body as
  `{"error":{"message":"<the raw text>",…}}`, so that transport reads the first
  character of the text instead. Two readings of one signal, and a drift between
  them would give one transport a retry the other refuses.
- `src/server/google/retry-ladder.test.mts`, 7 cases (1,941 -> 1,948).

What the seven hold, and the mutation that is the sole killer of each:

| Rule | Mutation it kills |
|---|---|
| the client is handed a retry ladder, with the SDK's attempt count | `httpOptions` deleted from `clientOptions()` |
| the ladder is the *same array* `vertexFetch` reads, by identity | the status list rewritten as a literal in the client options |
| 404 is on neither ladder, and the ladder is exactly the six statuses | 404 added to `RETRYABLE_STATUSES` |
| both transports classify the throttling HTML page, the missing-model JSON and an HTML 503 identically | either throttle rule reduced to the status alone |
| a 404 with no `content-type` at all is throttling to both | the header rule rewritten to name `text/html` instead of *not* JSON |

The identity assertion is the one worth explaining: a `deepEqual` against a
literal would pass forever while `vertexFetch` went on reading a different list,
which is exactly the disagreement between the two transports the shared constant
exists to prevent.

`retry-ladder.test.mts` names `@google/genai` (it builds real `ApiError`s), so
it joins `MAY_IMPORT_SDK` in `sdk-boundary.test.mts` — the boundary test caught
its arrival on the first run, which is the allow-list working.

### The defaults nobody passes — added 2026-08-22 (night)

Every rule held so far is one a caller states. What went unheld in `vertex.ts`
is the opposite kind: the values the module supplies when a caller supplies
none, and the readers that sit between the SDK's answer and the agents. Six
mutations left all 1,959 cases green and the typecheck clean:

| Mutation | What it costs live |
|---|---|
| `apiHost()`'s region branch deleted | every regional deployment's Agent Runtime calls go to the wrong domain |
| `textOf`'s `.trim()` dropped | the model's leading newline reaches `JSON.parse` and the crop reads as a refusal |
| `inlineDataOf` accepting a part with a media type and no bytes | `Buffer.from(undefined, "base64")` inside the image generator |
| `functionCallsIn` keeping a call that names no tool | the executor looks `undefined` up in the tool table |
| `throttleRetried`'s `retries = 4` default set to `0` | the HTML-404 throttle retry buys nothing, on the transport every model call uses |
| `client()`'s `??=` made an unconditional construction | a `GoogleAuth`, and so an access token, minted per model call |

All six are stage-2 ground. Four are the direct consequence of `Part` becoming
one all-optional interface (§VII, "`GeneratePart` becomes a flat type"): before
the swap `"text" in part` narrowed a union and the compiler stood behind these
three readers, and after it they are the only thing that does. The other two are
defaults, which no existing case reaches because every case states its own —
`vertex.test.mts`'s six all pass `retries` explicitly so the ladder is one step
long, and nothing at all called `apiHost()`.

Landed as one small source change and two test files:

- `THROTTLE_RETRIES = 4` exported from `vertex.ts`, and read as the default by
  **both** transports. It was written as the literal `4` twice — once in
  `vertexFetch`, once in `throttleRetried` — and the two have to agree, because
  `image-generator.ts` tells the user the drawing service is "busy" on the
  strength of that number and a call goes out over one transport or the other.
- `src/server/google/parts.test.mts`, 8 cases: what the three readers of a
  `Part[]` do with a part the flat type permits and the app never means.
- `src/server/google/vertex-defaults.test.mts`, 7 cases: the host branch, the
  retry budget, the one client.
- `image-generator.ts`'s comment on `DRAWING_BUSY` corrected — it still said
  `vertexFetch` had already backed off by the time a failure reached it, which
  has been untrue of the image path since the swap put it on the SDK.

1,959 -> 1,974. Each of the six mutations above is killed, and by exactly the
case written for it. Two details are worth keeping:

- The tests do not write the Vertex domain down. `sdk-boundary.test.mts` holds
  that exactly one file in the tree spells it — the rule that makes a
  hand-rolled model call visible — and a second speller would have to be
  allow-listed onto the strongest rule in the directory to hold the much weaker
  fact that a string is the string it is. What is worth holding is the *branch*,
  so the region case asserts that a region's host is the `global` host with the
  region prefixed onto it, and names neither.
- `vertexFetch`'s own default cannot be counted behaviourally: it needs a live
  bearer token to make a call at all. So the pair is held at the source instead
  — a case asserting that `retries = ` occurs in `vertex.ts` only ever followed
  by `THROTTLE_RETRIES`, which kills a literal written back into either default.
  That is the drift the constant exists to prevent, and it is the one mutation
  the behavioural cases cannot reach.

`client()` is now exported, for `clientOptions()`'s reason: a singleton nothing
can ask about is a policy nobody keeps. It has no other caller.

### The credential nothing asserted — added 2026-08-22 (late night)

`auth.ts` is the module the task says outright not to touch, and until now that
was a sentence rather than a guard. It is on the path of every Google call the
deployment makes — the SDK builds its client from `googleAuthOptions()`
(§VII, "What the SDK actually is"), the Cloud SQL connector is handed the
`GoogleAuth` from `googleAuth()` (§VIII), and `vertexFetch`'s one
`Authorization` header is minted by `accessToken()` — and it had no test file at
all. Five mutations left all 1,974 cases green:

| Mutation | What it costs live |
|---|---|
| `credentials` dropped from `googleAuthOptions()` | no ambient ADC on Vercel (infra §VI), so every Vertex and GCS call fails at the first request |
| `projectId` dropped | the library infers the project from the key, so calls are quietly addressed to whatever project the service account was created in |
| `scopes` emptied | a token good for nothing, on all three services at once |
| `googleAuth()`'s `??=` made an unconditional construction | a second token cache per call, so a warm instance re-mints instead of reusing |
| `accessToken()`'s empty-token throw deleted | `Bearer undefined` goes out, Vertex answers 401, and the throttle ladder asks four more times before anyone sees a message about the request rather than the credentials |

The same probe over the two modules beside it — `cloud-sql.ts` and
`agent-runtime.ts` — found ten more that survive. They are recorded as
known-undefended rather than closed here; see §VIII "Environment" and §VII
"What stays on REST".

**Amended 2026-08-23:** all ten are now closed, both by the same move. Six were
`agent-runtime.ts`'s — the module took an injected transport, seven cases, §VII
"What stays on REST". The other four were `cloud-sql.ts`'s, recorded as blocked
on a seam that turned out to be a default parameter as well: it takes the
connector's constructor, eight cases, §VIII "Environment". Twice now a module
filed as needing a network to assert needed one argument instead; "needs a seam"
is worth re-costing before it is written down as blocked.

Landed as `src/server/google/auth.test.mts`, 8 cases, 1,974 -> 1,982:

- The three fields, each asserted against the environment rather than against a
  literal, and `credentials` asserted twice across a move of the env value — a
  key frozen at import satisfies a single read and is a stale credential on the
  first rotation.
- One scope, and it is `cloud-platform`. That is the reason one client can be
  shared by the SDK, the connector and the REST transport instead of each
  holding a differently-scoped one.
- `googleAuth()` returns the same client twice.
- Three cases on the mint, each stubbing `getAccessToken` **on the shared
  client**. If the cache went away the stub would be invisible to
  `accessToken()` and the call would go to the network, so the three hold the
  caching a second way as well as holding what they say — and the third holds
  the empty string specifically, because `getAccessToken()` resolves rather than
  rejects when the refresh produced nothing, and a check written against `null`
  alone lets `""` through.
- A source rule: the service-account key is read by `env.ts`, `auth.ts` and
  `storage.ts`, and by nothing else in the app.

That last one is the correction this pass makes to the file's own comment.
`auth.ts` said two places deriving the same credentials from one env is one
place too many, and there are two: `storage.ts` builds its `Storage` from the
key directly, because that client takes `credentials` itself and adds its own
storage scopes. The comment now names it, and the rule holds the count at two —
a third reader is a third auth path, and is the one addition that would pass
every existing rule in `sdk-boundary.test.mts`. Test files are excluded from the
scan: several write the key into `process.env` to give `env()` something to
return, and a fixture is not a derivation.

`auth.test.mts` had to be allow-listed onto `MAY_HOLD_A_BEARER_TOKEN`, for the
same reason three test files sit on the SDK's own list — it asserts against the
real thing, and there is no way to assert what a failed mint does without naming
the function that mints.

### The two agents nothing could watch — added 2026-08-23

The seam is injected into four agents and imported by two: the analyzer (§III.2)
and the compositor (§III.4) called `generateContent` directly, so nothing in the
suite could hand them an answer. `model-floor.test.mts` says so in its own
comment — "there is nowhere to observe their model from except the source that
names it" — and that is the shape of the hole: both are *one* call and one read
of what came back, and the read is the whole agent. Fifteen mutations across the
two of them left all 1,997 cases green:

| Mutation | What it costs live |
|---|---|
| analyzer: `mimeType` guard deleted | a `.txt` uri is sent to Vertex as a picture, and the failure arrives as a 400 on the run row instead of as a message naming the file |
| analyzer: `temperature` 0.2 -> 1 | two reads of one photograph disagree, and those tags are grouped on downstream — by agent 8's gallery sort and by §III.5's speaker notes — so one look becomes two groups |
| analyzer: `responseMimeType`/`responseSchema` dropped | the answer comes back as prose, `parse` throws "non-JSON" on every upload, and the whole property pipeline is dark |
| analyzer: reads `parts[0].text` instead of `textOf(parts)` | an answer split across parts parses as nothing; the picture is filed with no properties |
| analyzer: `usageOf(response)` -> `usageOf({})` | the pipeline's largest bill by volume reports zero tokens, and the ledger under-reports the one agent worth measuring |
| analyzer: `normalizeAnalysis` skipped | a free-text tag and an invented hex go into the row; a tag outside the vocabulary is a group of one |
| analyzer: empty-answer throw deleted | `JSON.parse("")` throws, and the run row says "non-JSON: " — the two failures the message exists to tell apart |
| compositor: empty-assignment throw deleted | a page of empty slots is materialized and shown to the user as a moodboard |
| compositor: `note` untrimmed | the line read out to the user is the model's whitespace |
| compositor: no-blocks guard deleted | a call is paid for to be told there is nothing to place |
| compositor: reads `parts[0].text` | same as the analyzer's, and the board is refused rather than drawn |
| compositor: `usageOf(response)` -> `usageOf({})` | "the cheapest agent in the pipeline" is a claim about a bill nobody is measuring |
| compositor: `temperature` 0.2 -> 1 | two runs over one set of blocks are two different boards under one intention |
| compositor: `Page:` dropped from the request | the model lays out a page as if it were the board — the other pages become fair game |
| compositor: `Already on the board` dropped | "put neighbours beside each other" is asked about a half-full board whose other half is invisible |

Closed the way iterations 18 and 19 closed theirs, and for the third time the
seam was one default parameter: `analyzeReference({ …, generate = generateContent })`
and `composeMoodboard({ …, generate = generateContent })`, typed
`generate?: typeof generateContent` like the other four. No call site moved.

Landed as `src/server/agents/analyzer/analyzer.test.mts` (7 cases) and 10 more appended
to `src/server/agents/deprecated/compositor.test.mts`, 1,997 -> 2,014. Each of the fifteen
mutations is killed by exactly one case.

Two things the pass changed beyond the two agents:

- `generate-seam.test.mts`'s `INJECTED` and `FAKED_IN` lists are six and six.
  The `INJECTED` rule is a `deepEqual` against the files naming
  `generate?: typeof generateContent`, so adding the seam *fails* that test
  until the list is updated — which is the rule working: a new injection site is
  a new thing the positional shape has to survive.
- `model-floor.test.mts`'s comment no longer says the two agents have no seam.
  The file is not redundant now that they do: a fake answers for the agent it is
  handed to, and that file's question is about the app — that no caller anywhere
  reaches a model below the floor, including one nobody wrote a fake for.

### Verification

`npm run typecheck`, `npm test` (1,917 cases as of the swap — the suite is the
migration's real spec), `npm run lint`, `npm run floor`, `npm run build`, then
`npm run smoke`, which is the one path that actually reaches Vertex and is
therefore the only thing that proves the swap. A live crop and a live orchestrator
turn with at least one tool round — the round loop is where thought signatures,
function calls and the retry ladder all meet. All green on 2026-08-22; the
readings are in the subsection above.

Re-run after the two follow-ups: typecheck, 1,920 cases, lint, `floor` and
`build` all green. `smoke` was **not** re-run for them and deliberately so —
both are type-only. A type import erases, so what ships is byte-identical to
what smoke already proved, and `floor` reaches Vertex through the same client
and came back with real token counts, which is the part of the wiring a compiler
cannot check.

Same again for §II's floor tests: typecheck, 1,925 cases, lint, `floor` and
`build` green on 2026-08-22, `smoke` not re-run. Nothing in that change reaches
the app at all — one new test file, one extracted tree walk, no source edit —
so there is no shipped byte for a generation to prove.

Same again for the seam tests above: typecheck, 1,941 cases, lint, `floor` and
`build` green on 2026-08-22 (night), `smoke` not re-run. That change is one new
test file and nothing else — no source edit, no shipped byte — and `floor` still
reaches Vertex through the seam it pins, positionally, and came back with real
token counts.

And again for the retry policy above: typecheck, 1,948 cases, lint, `floor` and
`build` green on 2026-08-22 (night). `smoke` was **not** re-run; `floor` was,
and it is the right proof here rather than the cheap one — `clientOptions()` is
the object `floor`'s `countTokens` calls are constructed from, so a live floor
run with real token counts is a live run of the extraction itself. A generation
would prove the same client twice over.

And again for the three transport rules above: typecheck, 1,951 cases, lint,
`floor` and `build` green on 2026-08-22 (night). The only source edit is one
reworded comment in `vertex.ts`, so `smoke` was not re-run; `floor` was, and it
goes out over the SDK client the rules are drawn around — the rules say the app
has exactly one way to reach a model, and `floor` is that way, run live.

And for the defaults above: typecheck, 1,974 cases, lint, `floor` and `build`
green on 2026-08-22 (night) — and `smoke` **was** re-run, because unlike the
five re-runs above this one carries a real source edit on the live path
(`THROTTLE_RETRIES`, the exported `client()`). One turn, two model calls over
one tool round: it listed the project's three references and four boards and
cut the lighthouse frame to a square, 28,511 in / 2,024 out for $0.01 across an
`ORCHESTRATOR` and a `CROPPER` row, both priced against flash. Criterion 6 on
the current tree.

Worth recording from that run: the SDK writes `The user provided Google Cloud
credentials will take precedence over the API key from the environment
variable.` to `console.debug` on every client construction. It is true and
uninteresting — `googleAuthOptions()` always carries `credentials` — and it is
one line per process precisely *because* `client()` caches. The new test
silences it around its own assertion rather than leaving a stray line in the
suite output.

And for the caching probe (§II, "What the move did to the bill"): typecheck,
1,953 cases, lint and `build` green on 2026-08-22 (night). Here `smoke` **was**
the work rather than a re-proof of it — the measurement needed a real multi-call
turn and nothing else produces one. It ran on HEAD, three model calls over two
tool rounds, 39,623 in / 726 out for $0.01, and came back with a real answer
naming the project's five references and four boards. That is criterion 6
standing on the current tree rather than on the tree stage 3 landed with, and it
exercised the whole migration end to end in one command: the SDK's transport, the
positional seam, the round loop, and the run rows read back out of Cloud SQL
either side of the turn.

And for the credential above: typecheck, 1,982 cases, lint, `floor`, `build` and
`npm run cites` (404 citations, all resolving) green on 2026-08-22 (late night).
`smoke` was **not** re-run. The only source edit is one amended comment in
`auth.ts` — the module's code is byte-identical — and `floor` is the right proof
here rather than the cheap one: it mints a real token through `googleAuth()` and
spends it on live `countTokens` calls, so a green floor run *is* a live run of
every field the new cases assert.

And for the REST surface above: typecheck, 1,989 cases, lint, `floor`, `build`
and `npm run cites` (407 citations, all resolving) green on 2026-08-23. No live
proof exists for this one and none is claimed — `AGENT_ENGINE_RESOURCE` is unset
in every environment this app has run in, so there is no engine to send a
`:query` to. That is the whole reason the module was undefended, and the seam is
what replaces a live run here: the request it assembles is now readable without
one.

And for the two agents above: typecheck, 2,014 cases, lint, `floor`, `build` and
`npm run cites` green on 2026-08-23. `smoke` **was** re-run, because the change
is a source edit on the live path of two agents and the one thing a fake cannot
prove is that the default still resolves to the real call. One turn, three model
calls over two tool rounds: it composed a five-photograph Editorial Spread —
42,161 in / 2,554 out for $0.02 across an `ORCHESTRATOR` and a `COMPOSITOR` row
— and `--drain` then ran the analyzer over the one queued picture, 2,153 in /
915 out for $0.0029. Both agents went out through their own defaults, which is
the half of the seam a fake never touches.

## VIII. Database — Cloud SQL

**State, amended 2026-08-22 (night): landed.** The schema is deployed and
`server/db.ts` is on the connector; what the rest of this section describes as
future work has happened. What it actually looked like is recorded in "What the
cutover actually looked like" at the end of the section, including the two
things it turned out to need that nothing here predicted — a tunnel written in
this repo, because the Prisma CLI has no driver-adapter route in v7, and a data
copy, because "nothing to preserve" and "a cutover that can read a project back"
are not the same claim.

The paragraph below is the state it landed *from*, kept because the rest of the
section is written against it.

**State, amended 2026-08-22 (evening): the instance exists; the cutover does
not.** The earlier reading of this paragraph — `SERVICE_DISABLED`, no instance,
gated on the owner — held until the owner ran it. `mtd-hackathons:us-central1:vibes-ai-pg`
is live with `vibes_ai`/`vibes_app` and `max_connections = 50`; infra §XVI is
rewritten against the running instance and is the measured record. What is left
is code, and it is two things rather than one: **the schema is not deployed** —
`vibes_ai` is empty — and `server/db.ts` still opens `DATABASE_URL` directly.
Everything below describes that cutover. The schema step is the one this
section historically left open, and it is the harder half: `prisma migrate
deploy` reads `DATABASE_URL` through `prisma.config.ts` and opens ordinary TCP,
which the connector never provides, and `cloud-sql-proxy` is not installed on
this machine (checked).

Postgres is external today: `DATABASE_URL` points at whatever the deploy was
given, `docker-compose.yml` runs `postgres:18-alpine` locally, and infra §IX
records the decision to use Neon/Supabase/Vercel Postgres because Cloud SQL was
"a slow, paid instance". That decision was made when the only question was
convenience. It is now also the difference between the project resting its
infrastructure requirement (§I) on one bucket and resting it on a database and
a bucket.

### Shape

- **Cloud SQL for PostgreSQL, Enterprise edition**, smallest instance that
  clears the connection math below. Same project and region as the bucket
  (`mtd-hackathons`, infra §I).
- **Reached with `@google-cloud/cloud-sql-connector`** (1.11.x), not with a raw
  host and port. The connector mints short-lived certs against the Cloud SQL
  Admin API, so there is no database password on the wire and no IP allowlist —
  which is what makes this workable from Vercel, where egress IPs are not
  stable enough to allowlist.
- **`new Connector({ auth })` takes a `GoogleAuth` instance**, so it is handed
  the exact object `server/google/auth.ts` already builds from the inline
  service-account key. One credential reaches Vertex, GCS and now Postgres.
- **`connector.getOptions({ instanceConnectionName, ipType: "PUBLIC" })`
  returns `{ stream }`** — a socket factory, not a host and port. Measured
  against the live instance on 2026-08-22; the connector's own README describes
  a `{host, port, ssl}` return, and that is not what 1.11.3 hands back for
  Postgres. It matters only in that nothing in the config is a hostname to eyeball:
  `pg`'s `ClientConfig.stream` is where the TLS'd socket arrives, and a config that
  looks empty of connection details is correct.
- **`PrismaPg` accepts `pg.Pool | pg.PoolConfig | string`**, so `server/db.ts`
  changes from `new PrismaPg({ connectionString })` to
  `new PrismaPg({ ...clientOpts, user, password, database, max })` and nothing
  downstream of the client moves. (That object is assembled by the exported
  `poolConfig()` as of 2026-08-23 — see "What the pool is made of" below.)
- **IAM database authentication** (`authType: "IAM"`, user = the SA email minus
  the `.gserviceaccount.com` suffix, no password) is available and is the
  better end state — it deletes the last stored secret. Take it second: it is a
  separate failure surface from the connector itself, and debugging both at once
  on the day is how an afternoon goes.

### Connection math — the thing that actually bites

Cloud SQL caps connections by instance memory: the smallest tiers sit around 25
by default, and Managed Connection Pooling is an Enterprise **Plus** feature.
The instance now provisioned (`db-g1-small`) reports `max_connections = 50`,
read off the server rather than off the docs.
Vercel spawns a function instance per concurrent request and each one holds its
own pool, so the default `pg` pool of 10 needs three warm instances to exhaust a
small instance, and Prisma will start reporting connection errors that look like
database faults.

So: pick the instance for its connection ceiling rather than its CPU, keep
`max` at 2–3 per pool, and remember the analyzer worker (infra §XIII) is a
second concurrent client draining jobs while the UI serves requests. If that
proves too tight, the honest answers are Enterprise Plus with MCP, or moving the
app to Cloud Run — which infra §VII already keeps as the fallback for the
function-duration risk, and which would let the connector talk over a Unix
socket instead.

### Migration

1. ~~`gcloud services enable sqladmin`; create the instance and database; grant
   the app SA `roles/cloudsql.client`.~~ **Done 2026-08-22 — infra §XVI.**
2. `npm run db:deploy` against the new instance. The schema is already
   migration-managed and the data is a hackathon's worth — there is nothing to
   preserve, so this is a create, not a move.

   **This step does not come free from step 3.** The connector is wired into
   `server/db.ts`, and the Prisma CLI does not go through our client: `migrate`
   and `studio` read `DATABASE_URL` through `prisma.config.ts` and open an
   ordinary TCP connection, so they need a host and port the connector never
   hands out. The Cloud SQL Auth Proxy is what bridges it, as a local dev tool
   and not as a deploy dependency — the exact invocation is in infra §XVI.
3. Switch `server/db.ts` to the connector. `DATABASE_URL` **stays**: the Prisma
   CLI reads it through `prisma.config.ts` for `migrate`/`studio`, which do not
   go through our client, and `docker-compose.yml` stays the local story.
4. Deploy, then check the instance's connection count under real traffic before
   calling it done.

### Risk

Every request now depends on the Cloud SQL Admin API being reachable and on a
cert refresh, where before it depended on a connection string. That is a new
failure mode on the hottest path in the app, taken on for a requirement rather
than for the product. Do it after §VII lands and is green, keep the previous
`DATABASE_URL` to hand, and do not do it on demo morning.

### What the cutover actually looked like — 2026-08-22 (night)

Landed as one change: schema, client, environment, and the data that was
already in the app.

**The Prisma CLI has no driver-adapter route in v7.** This section's step 2 left
*how* open and infra §XVI answered it with `cloud-sql-proxy`, which is not
installed here. The alternative worth checking first was a driver adapter in
`prisma.config.ts` — the Prisma 6 shape where `migrate` runs through the same
adapter the app uses. It is gone: `PrismaConfig` in `@prisma/config` 7.9.1
declares `datasource`, `schema`, `migrations`, `tables`, `enums`, `views` and
`typedSql` and no `adapter`, and the string `adapter` does not occur anywhere in
`prisma/build/index.js`. The CLI wants TCP, and that is not negotiable.

**So the tunnel is written here instead** — `scripts/db-tunnel.mts`,
`npm run db:tunnel`. It listens on `127.0.0.1:5433` and hands every accepted
socket to `clientOpts.stream()`, which is the whole of what the proxy binary
does. Two things recommend it over installing the binary: it is the connector
already in the dependency tree, so the bridge exercises the cutover's own
credential path rather than a parallel one, and there is nothing to install on
the next machine. `npm run db:tunnel:url` prints the `DATABASE_URL` to point the
CLI at, `sslmode=disable` because the loopback hop is inside the connector's
mTLS rather than beside it. Both migrations applied on the first run.

**`server/db.ts` keeps its synchronous export.** `getOptions()` is async and
`db` is a singleton every caller imports directly, which is the one real
friction in this section's step 3. The await lives behind the adapter factory
Prisma calls on first query — a plain object with `provider`, `adapterName`,
`connect` and `connectToShadowDb` that resolves a cached `PrismaPg`, built by
the exported `poolAdapter()` as of 2026-08-23 — so nothing
downstream moved and a process that never queries never dials the Admin API.
Top-level await would have worked too and was not taken: it makes every importer
of `db` wait on the Admin API at module load, including routes that never query. How
that cache is held turned out to matter on its own; see "The cached pool is not
`??=`" below.

**The connector's `GoogleAuth` is not this project's `GoogleAuth`.** It nests
google-auth-library v10.9.1 under itself against the project's v11.0.2, and the
two classes brand with different private fields, so the object `auth.ts` builds
is not assignable to `ConnectorOptions["auth"]` even though it is exactly what
the connector wants at runtime. This is the same trap §VII hit with the Gen AI
SDK's `GoogleAuthOptions`. The cast lives once, in the new
`src/server/google/cloud-sql.ts`, which also holds the single `Connector` for
the process — a second one is a second cert-refresh loop for the same instance.

**The CLI scripts moved with the app.** `floor`, `smoke` and `spend` each built
their own `PrismaClient` from `DATABASE_URL`. Left alone they would have read
the database the app no longer writes — `npm run spend` in particular would have
reported a ledger that stopped growing. They now import the app's `db`, and
`closeDb()` was added for them: the connector holds a cert-refresh timer, so
disconnecting Prisma alone leaves the process hanging on an empty event loop.
`npm run spend` also had to gain `--conditions=react-server`, which `floor` and
`smoke` already carried — importing `db` means importing `server-only`, and
without the condition that package is a module that throws on sight.

**The data came across.** This section says the data is a hackathon's worth and
there is nothing to preserve; that is true of the *rows* and false of the
demo. 3 users, 7 projects, 38 references (9 of them versions), 29 analyses, 18
moodboards and 156 agent runs were copied from local Docker into `vibes_ai`
through both Prisma clients, references inserted with `sourceReferenceId` nulled
and relinked on a second pass so a version could not land before its source. The
GCS objects the references name did not move and did not need to — one bucket
serves both. The source database was not touched and is the rollback.

**Verified live, not asserted.** `npm run floor` reads its project out of Cloud
SQL and exits cleanly; `npm run smoke -- "what have I got in here?"` ran a real
orchestrator turn against Vertex on the copied project — `show_references`, 2
model calls over 1 tool round, 25,858 in / 502 out, $0.0090 — and read the
ledger back through the connector afterwards ("project to date: $0.76 over 28
runs"). Typecheck, 1,935 tests, lint and build are green — 1,932 plus the
three `db-path.test.mts` cases the cutover added.


### The cached pool is not `??=` — amended 2026-08-22 (late)

The cutover cached the pool with `connecting ??= cloudSqlPool()`, which is the
idiom this codebase uses for every other process-lifetime singleton — the
`GoogleAuth` in `auth.ts`, the `GoogleGenAI` in `vertex.ts`, the `Storage` in
`storage.ts`, the `Connector` in `cloud-sql.ts`. Those four are all synchronous
constructors and `??=` is right for them. This one is not: it awaits
`getOptions()`, which dials the Cloud SQL Admin API.

A rejected promise is not nullish. So a first query that lost its Admin API call
— a dropped packet, a token refresh that timed out, IAM propagation on a cold
start — left that rejection in the slot, and every later query on that Vercel
instance re-threw it for as long as the instance stayed warm. No deploy caused
it, no retry could clear it, and nothing about the error would have said the
database was reachable.

The fix is `buildOnce` in `src/lib/util/once.ts`: the same one-build-shared-by-
everyone contract, except the slot is cleared when the build fails, so the next
caller starts a fresh one. It also runs `build` behind `Promise.resolve().then`
so a synchronous throw — `env()` on a missing `CLOUD_SQL_*` key is the live one —
fails the same way rather than escaping past the clear. `keyed-queue.ts` already
states the general rule for this codebase ("a task that throws must not poison
the queue for the next one"); the database path was the one place a promise cache
outlived the request that filled it.

Six cases in `src/lib/util/once.test.mts` (1,953 -> 1,959), mutation-checked:
reverting to `??=` fails two of them, dropping the memoisation entirely or
assigning unconditionally fails all six, and dropping the `Promise.resolve()`
wrapper fails the synchronous-throw case alone. Verified live with `npm run
spend`, which is the right proof here rather than `npm run smoke`: it is a real
read of the ledger through the new pool — 159 runs, $4.44 — and the process
exits cleanly, so the cert-refresh timer is still released.

### Environment

`DATABASE_URL` stays required and changes meaning: it is the Prisma CLI's
channel and the local Docker story, and nothing in the running app reads it.
`CLOUD_SQL_INSTANCE`, `CLOUD_SQL_USER`, `CLOUD_SQL_PASSWORD` and
`CLOUD_SQL_DATABASE` are now required in `src/env.ts` — required rather than
optional because `server/db.ts` has no other path to a database, so a missing
key is an app with no storage and should fail at boot rather than on the first
query.

**Known undefended, 2026-08-22 (late night):** `cloud-sql.ts` has no
behavioural test — `db-path.test.mts` holds *who* may name the connector
package, and iteration 15's `once.test.mts` holds how the pool above it is
cached, but nothing holds the connector module itself. Four mutations leave all
1,982 cases green: the one-connector-per-process `??=` made unconditional (a
second cert-refresh loop against the Admin API for the same instance),
`IpAddressTypes.PUBLIC` switched to `PRIVATE` (this instance has no private IP —
infra §XVI), and either half of `closeCloudSql` deleted (a `close()` that does
not close, or one that leaves the closed connector in the slot for the next
caller to reuse). All four need a fake `Connector`: `cloudSqlOptions()` reaches
the Admin API on its first call, so unlike `auth.ts` this one cannot be asserted
against the real library without a network. That is a seam decision, which is
why it is recorded rather than done.

**Closed 2026-08-23:** the seam is a default parameter, the same shape the
agents' `generateContent` and `agent-runtime.ts`'s transport already use.
`cloudSqlOptions(instanceConnectionName, make = dialingConnector)` takes the
connector's *constructor*, not the connector, so `db.ts` still passes one
argument and still gets the real one; the fake is held to
`SqlConnector = Pick<Connector, "getOptions" | "close">` — `Pick` and not the
class, because `Connector` brands with private fields and nothing structural can
be assignable to it. The default is named (`dialingConnector`) rather than
written inline, so the one place that constructs a real connector reads as the
one place.

`src/server/google/cloud-sql.test.mts`, 8 cases, 1,989 -> 1,997. Eight
mutations, each verified against the new suite:

| mutation | what it costs live | killed by |
|---|---|---|
| `connector ??= make()` -> `connector = make()` | a second cert-refresh loop against the Admin API per query | one connector, whatever instance |
| `IpAddressTypes.PUBLIC` -> `PRIVATE` | every query fails — no private IP on this instance (infra §XVI) | asks for the public IP |
| `connector?.close()` deleted | `closeDb` returns and the process hangs on the cert timer | closing closes the connector |
| `connector = undefined` deleted | the next caller queries through a closed connector | closing empties the slot |
| `connector?.close()` -> `connector!.close()` | `npm run floor` on a run that never queried throws at exit | closing without a connector is a no-op |
| default -> `new Connector()` | no ambient ADC on Vercel (infra §VI) — fails at first query, not at boot | the default is handed the credential |
| the options object copied rather than returned | a `pg` config assembled here is the shape that puts a hostname back on the wire | what the connector answers is what the caller gets |
| the instance connection name hardcoded | one instance name in two places, drifting | the instance asked for is the instance asked about |

Two notes on the table. The last mutation survived the first draft, because the
forwarding case asserted the *production* name from infra §XVI and the mutation
hardcoded exactly that — a case that names the value the app happens to pass
cannot tell forwarding from a constant. It asserts a deliberately different name
now. And the two `closeCloudSql` mutations fail five and seven cases rather than
one: the module-level connector outlives a case, so every case starts by calling
`closeCloudSql()` to empty the slot, and a broken close breaks the file's own
reset. That cascade is honest — it is the same thing going wrong — but it means
the one-case-per-mutation reading holds for six of the eight.

The default cannot be exercised from a test at all, since constructing it dials
the Admin API, so the eighth case reads it off the source the way
`vertex-defaults.test.mts` reads `vertexFetch`'s retry budget. What it holds is
the `auth`: a connector left to find its own credentials finds none on Vercel.

Live proof is `npm run spend`, not `npm run floor` — it performs a real read
through the pool built by the default connector and exits cleanly, which is also
the check that `closeDb`/`closeCloudSql` still release the cert-refresh timer.
Run after this change: 162 runs, $4.46, clean exit. Verification gate:
`npm run typecheck && npm test && npm run lint && npm run build` with 1,997
cases green.

### What the pool is made of — 2026-08-23

The three files around `server/db.ts` were each closed in turn —
`db-path.test.mts` for the two source rules, `once.test.mts` for the caching,
`cloud-sql.test.mts` for the dial — and `db.ts` itself, which decides what the
pool is actually *made of*, still had nothing on it. Eight mutations left all
2,014 cases green, including two that leave the app with no database:

| mutation | what it costs live | killed by |
|---|---|---|
| `...clientOpts` dropped from the config | the socket factory is the whole connection — a `pg` config that reads plausibly and connects to no machine | the connector's options are the connection |
| `max: POOL_MAX` -> `50` | the instance's entire ceiling claimed by one warm Vercel instance, with the analyzer worker as a second client (infra §XVI) | 3 against an instance that allows 50 |
| `CLOUD_SQL_USER` and `CLOUD_SQL_DATABASE` swapped | authentication fails at the first query; three same-shaped strings that read equally well in each other's slots | each credential from its own key |
| `password` dropped | same | each credential from its own key |
| the spread moved *after* the credentials | a future connector release that returns a `user` silently overrides the environment's | the credentials win over the connector's |
| `connectToShadowDb` -> `connect` | Prisma's migration diff runs its script against the live pool | connect and shadow reach different halves |
| the pool built when the adapter is constructed | every process that imports `db` dials the Admin API, including ones that never query | building the adapter dials nothing |
| `closeCloudSql()` dropped from `closeDb` | `npm run floor`/`spend` return and hang on the cert-refresh timer | closing closes the connector, in order |

Closed with two seams of the shape the rest of the migration already uses, and
no call site moved:

- `poolConfig(clientOpts)` exported — the config assembly lifted out of the
  `buildOnce` factory. Reading it needs no Admin API call; building the pool it
  goes into does, which is why it could not be read before.
- `poolAdapter(build)` exported, taking the pool factory as an argument, so the
  adapter Prisma calls can be driven by a pool that never dials. The parameter
  is typed `PoolFactory = Pick<PrismaPg, "connect" | "connectToShadowDb">` —
  `Pick` for the same reason `cloud-sql.ts` picks off `Connector`.
- `closeDb(client = db, close = closeCloudSql)`, so the ordering assertion is
  possible against something other than the process's real database life.

`src/server/db.test.mts`, 9 cases, 2,014 -> 2,023. The connector's option type
is derived as `Awaited<ReturnType<typeof cloudSqlOptions>>` rather than imported
from the package, which is what keeps `db-path.test.mts`'s connector rule at one
entry — a type-only import erases at runtime but is still a name to a source
scan.

**A defect found beside them.** `closeDb` awaited `$disconnect()` and *then*
closed the connector, so a rejected disconnect skipped the close and left the
cert-refresh timer holding the event loop open — the failure arriving as a CLI
that never exits rather than as the error it is. Now `try`/`finally`, with a
case on it.

**A correction.** The `provider`/`adapterName` pair is read off a throwaway
`new PrismaPg({})` rather than written down a second time, and the first draft
of that comment said a misspelling "fails every query at runtime with nothing
upstream to catch it". It does not: Prisma reconciles the adapter's `postgres`
against the schema's `postgresql` inside `new PrismaClient()` and throws
`PrismaClientInitializationError` at construction. The mutation is caught — it
takes the whole test file down at import rather than failing one case, which is
the honest reading of that row's absence from the table above. What the case
holds is the weaker half it *can* hold: that neither string is written twice, so
the two cannot drift when an adapter release renames one.

Live proof is `npm run spend` again — a real read through the real connector,
the real `poolConfig` and the real `poolAdapter`, exiting cleanly through
`closeDb`. Run after this change: 164 runs, $4.48, exit 0. Verification gate:
`npm run typecheck && npm test && npm run lint && npm run floor && npm run build`
with 2,023 cases green.

### The gate nothing opened — 2026-08-23

`src/env.ts` decides whether the process starts at all, and it was the last file
on the migration's path with no test of any kind. Stage 3 made four
`CLOUD_SQL_*` keys required here because `server/db.ts` has no other route to a
database; stage 2 rests on `GOOGLE_CLOUD_LOCATION` defaulting to `global`,
because that is the only place gemini-3.x and the Managed Agents API are served
(infra §VI, §X); and every Vertex and GCS call in the deployment runs on a
service-account key this schema is the only thing to validate. Twenty-five
mutations were planted; all twenty-five left the 2,023-case suite green. Three
are red at `tsc` and the rest are visible nowhere:

| mutation | what it costs live | killed by |
|---|---|---|
| any one `CLOUD_SQL_*` key made optional or defaulted | an app that boots healthy on Vercel and fails on its first query, not at start-up | each Cloud SQL key is required (asserted per key) |
| `CLOUD_SQL_INSTANCE` given a hardcoded value | one instance name in two places, drifting — the shape of iteration 19's forwarding finding | each value comes back from its own key |
| `.default("global")` -> `.default("us-central1")` | every model call 404s: gemini-3.x is global-only | the location defaults to global |
| `GOOGLE_CLOUD_LOCATION` frozen to a literal | the environment can no longer move the deployment off global | same case, second half |
| `GOOGLE_GENAI_USE_ENTERPRISE` default `"1"` -> `"0"` | the SDK leaves Vertex for the public Gemini API, where this key is not a credential | the enterprise flag defaults on |
| `client_email` no longer an email / `private_key` allowed blank | an OAuth client's JSON, or a key with a trimmed field, accepted as a service account | a key missing a field is not a key |
| `JSON.parse` moved outside the `try` | a raw `SyntaxError` at whichever import touched `env()` first, naming nothing | a key that is not JSON fails the environment |
| `z.prettifyError` replaced | the boot failure stops naming the key that caused it | five cases (see below) |
| the blank-secret preprocess dropped | `.env.example`'s empty `ANALYZER_WORKER_SECRET` fails the whole environment instead of disabling one route | a blank worker secret disables the endpoint |
| `.min(16)` -> `.min(1)` on that secret | a guessable string is all that stands between the internet and Vertex spend on a session-less route | a short worker secret is rejected |
| `SIGNED_URL_TTL_SECONDS` default changed, `.positive()` dropped, or left a string | a TTL of zero is a broken image on every reference in the gallery; a string is `Date.now() + "900"` | the TTL is a positive number of seconds |
| `DATABASE_URL: z.string().url()` -> `z.string()` | the CLI's channel is the one nothing in the app reads, so a bare name sits here until a migration runs | the connection string has to be a URL |
| `APP_URL` scheme constraint or default changed | a redirect URI Google rejects, or one registered for the wrong port | the origin carries a scheme |
| the validation branch taken unconditionally | every rule above stops running, in production | twelve cases |
| `SKIP_ENV_VALIDATION` read off `process.env` rather than the source | the escape hatch answers for a process instead of for the source it was given | the flag trusts the source it is set on |
| `cached ??= parseEnv()` -> `cached = parseEnv()` | a zod parse and a `JSON.parse` of the key per request | the environment is parsed once per process |
| `AGENT_ENGINE_RESOURCE` made required | the app will not boot until an Agent Engine is deployed, which none is | eleven cases |

The seam is an extraction rather than a default parameter — the same shape
`db.ts` needed, and for the same reason. `load()` is now
`parseEnv(source = process.env)`, exported. `env()` memoises, so a test reaching
the rules through it would parse one environment per process and then be
asserting the cache; taking the source as an argument is what lets sixteen cases
parse sixteen environments in one file. Reading `SKIP_ENV_VALIDATION` off that
same source is not incidental: it makes the flag mean "this source is trusted",
which is assertable, rather than "this process is", which is not.

`src/env.test.mts`, 16 cases, 2,023 -> 2,039.

Three notes on the table. Two mutations cascade rather than failing one case,
and both cascade for the same reason: every case parses a *complete* fixture, so
a mutation that makes an absent key required (`AGENT_ENGINE_RESOURCE`) or that
disables validation outright fails every case that asserts a parsed value. That
is honest — it is one thing going wrong — but the one-case-per-mutation reading
holds for the other twenty-three. The `prettifyError` mutation is the same shape
from the other side: five cases assert the thrown message *names the key*, so
losing the pretty-printer fails all five.

**A defect found beside them.** `APP_URL` was `z.string().url()`, and zod reads
`localhost:12000` as a URL whose protocol is `localhost:` — it also accepts
`ftp://x.com`. The redirect URI is built from this value and has to match what
the OAuth client is registered for exactly, scheme included, so a scheme-less
origin is a sign-in that fails at Google rather than at boot. Now
`z.url({ protocol: /^https?$/ })`; http(s) rather than https so the local
default stays legal.

**One allow-list widened.** `db-path.test.mts` holds that only `src/env.ts` may
name `DATABASE_URL`, and a test that builds a complete environment has to name
every required key. `src/env.test.mts` is on that list now, on the precedent of
the test files already on `sdk-boundary.test.mts`'s: a test that asserts a rule
needs the words the rule is about.

Live proof is the real `.env.local` parsing under the tightened schema —
`APP_URL` still an `http:` origin, the location still `global`, the TTL a
`number` and the key an object — and `npm run floor`, which boots through
`env()` and reaches Vertex. Verification gate:
`npm run typecheck && npm test && npm run lint && npm run floor && npm run build`
with 2,039 cases green.
