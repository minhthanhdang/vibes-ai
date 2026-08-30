# Task: the style dialect, page backgrounds, and "Let's Vibes"

Two things, and the first is the prerequisite for the second.

The board has always been an excalidraw canvas with an unrestricted toolbar — ten
element types, every fill, stroke, family and opacity field on each. The agents
have had three kinds and no style fields at all, which is why agent 8 makes pages
of photographs and hand-drawn black lettering on white. **The style dialect**
gives both agents shapes, fills, strokes, type styling and page backgrounds, and
— just as important — makes the shapes that are already on real boards *readable*
instead of invisible.

**"Let's Vibes"** is then the product's headline action: a form on the canvas
takes a brief, makes a board, and runs agent 8 once per page.

Read first — they are the contract, and they record *why* each decision went the
way it did:

- `context/canvas.md` §XI, "The style dialect" (§XI.1–§XI.6) — the whole design.
  §XI.5 is the list of reads that have to widen and is the part most likely to be
  under-done.
- `context/canvas.md` §XII (constants), §XIII invariants 13 and 14 — both new,
  both are what the tests should be written against.
- `context/canvas.md` §VI — tidy, and what happens to its buttons.
- `context/compositor-v2.md` §II.2 (the instruction the model actually reads),
  §IV.1 and §IV.2 (why the sixth tool is shared), §IX (all of "Let's Vibes").
- `context/orchestrator-tool-reference.md` §VI — the three contracts, and §III's
  Canvas block for the plumbing they inherit.
- `context/tech-spec.md` §III.8 (agent 8 and its two doors), §V.4
  (`PageAIRepresentation`, which grows shape blocks and a background).

Work in `web-app/`. Everything below is `web-app/`-relative.

The five stages are ordered and must land in that order, each green before the
next starts. **Stage 0 ships alone and first**: it is a read-only change that
fixes a live bug, and every stage after it assumes shapes are readable.

## What must be true when you are done

1. A rectangle, ellipse or line on a board is a `CanvasObject` with a handle,
   carrying its own fill, stroke, stroke width, stroke style, rounding and
   opacity — and every read that describes a page describes it too.
2. An arrow, diamond, freehand stroke or embed is **named** in an
   `unaddressable` remainder, never silently absent. Invariant 13: what the
   model can see, the model can read.
3. Both agents can create and restyle shapes and type through **one**
   implementation. There is no field, refusal or default that behaves differently
   depending on which agent knocked.
4. `compose_moodboard` produces byte-identical output to what it produces today
   on a page with no shapes on it. Agent 4's composed pages must not move.
5. A page has a background that the editor, the exporter and `renderForModel`
   all draw, that the user can set from the inspector, and that no read lists as
   an object and no write will move.
6. `set_canvas_background` is agent 6's and is not in agent 8's set, and its
   write has the same revision guard, keyed queue and no-op detection every other
   scene write has.
7. "Let's Vibes" makes a board with N pages and designs each one, browser-driven
   and sequential, with the run written into the conversation.
8. The suite is green at every commit, and larger than 2,596 at the end.

## Stage 0 — the read grows a fourth kind

No new tools, no new writes. This is the stage that makes the rest honest.

`src/lib/canvas-objects/object-read.ts`. `readableItems` today keeps `image` and
`text` and drops everything else, with a comment explaining that a rectangle is
scaffolding a model would only move. That was right when the list was all the
model had; it is wrong now that the picture rides beside it. Meanwhile
`src/lib/render/render-plan.ts` has always drawn rectangles, ellipses, lines and
arrows at full fidelity — so today a model is shown a colour block and handed a
list that does not have one, and its first move is to place a headline in the
empty space the list claims is there.

Add `kind: "shape"` to `CanvasObject` per `canvas.md` §XI.1. Three shapes only —
`rectangle`, `ellipse`, `line`. Read the appearance fields off the element with
the same defaulting `render-plan` already does, and reuse its helpers rather than
writing a second reader of the same fields.

Two things that are not the fourth kind and belong in this stage:

- **The `unaddressable` remainder.** Arrows, diamonds, freehand strokes and
  embeds stay unreadable *and* stay accounted for: "2 things on this page are not
  objects you can address: 1 arrow, 1 freehand drawing". This is invariant 7 at a
  new door and it is what makes leaving them out defensible.
- **A live bug: bound labels.** A palette's hex labels are `text` elements, so
  `read_canvas` lists all eight as grabbable; `transform_on_canvas` then refuses
  each toward a `containerId` no read will ever return
  (`object-transform.ts:273`). That is a loop the model cannot escape and it
  exists today. Filter `containerId` out of `readableItems`.

Then widen every consumer — `canvas.md` §XI.5 is the list. `inspect_board`,
`PageAIRepresentation` and `pageBrief` (shape blocks, competing for the same
`PAGE_BLOCK_CAP` 24), `objectShape`. `render-plan`, `rasterise` and
`moodboard-export` need **nothing**, which is the point: this is a read problem,
not a rendering one.

One routing decision comes with it, and it is a behaviour change to an existing
path: **a page carrying shapes does not stand as composed**, so
`compose_moodboard` takes it down the edit-in-place branch rather than a seated
rebuild. A rebuild would lay photographs over ground somebody put there on
purpose. Get requirement 4 under test before you touch this.

Land it, then run `npm run design:pages` and `npm run render:check` over the real
boards on the database. Those two answer the only question that matters here: on
boards people actually made, what was the read hiding?

## Stage 1 — `restyle_on_canvas`, and style on the put

A sixth canvas tool, in `src/lib/canvas-objects/object-restyle.ts`, declared in
`src/lib/agent/agent-tools.ts`, executed for agent 6 in `src/server/agents/orchestrator/tools.ts`
and reached by agent 8 through `src/server/canvas/tool-canvas.ts` — the shared
module the five already go through. **Do not fork it.** If wiring it to both
agents seems to need two versions, the wiring is wrong, not the tool.

Contract in `orchestrator-tool-reference.md` §VI; the per-kind field table is
`canvas.md` §XI.2. A field that does not apply to the object's kind is refused
with a reason, never dropped. Batched, capped at 10, same remainders, same
revision-guarded queued write as its five siblings.

Split from `transform_on_canvas` deliberately: transform answers where and how
big, and nine appearance fields on it would be paid for by every "move it left".

Four details that are each a way to get this wrong:

- **`opacity` reaches images too.** A photograph at 40% is a scrim with nothing
  added to the page, and it is the cheapest thing on this list.
- **Shape puts default to `fillStyle: "solid"` and `roughness: 0`.** Excalidraw's
  own defaults are hachure and roughness 1, which draw a sketched box with gaps
  in it. That default is the whole difference between a design tool and a
  whiteboard.
- **`font` is a name, not an integer.** Five of them — `hand`, `sans`, `mono`,
  `rounded`, `display`. `renderFont` in `render-plan.ts` already holds the
  mapping onto the mirrored font directories; do not write a second one.
- **The `fontSize` clamp splits.** `object-put.ts` derives the size from the box
  height and clamps to `LAYOUT_TEXT_MAX_FONT` 96 — ten of the thirty-two typed
  pages on the development database are sitting on that ceiling. An *explicit*
  `fontSize` is honoured to `CANVAS_TEXT_MAX_FONT` instead; the derived path
  keeps its clamp exactly as it is. Agent 4 never passes the field, which is what
  keeps requirement 4 true.

Defaults do not move. Text placed with no `font` lands in excalidraw's own
family, as it does today and as a line the user types does. What changes is that
agent 8's instruction (`compositor-v2.md` §II.2) now says out loud that the
default is hand-drawn, and that black type on a dark photograph is type nobody
can read.

`read_canvas` and `put_on_canvas` grow the same fields — a thing should be able
to land right rather than land and be fixed.

Measure the door: `npm run floor` before and after, same project, minutes apart.
The canvas five are already 2,080 declaration tokens and the largest single
addition in `orchestrator-tool-reference.md`'s history. Write the number down in
§VI the way every other change to that file recorded its own.

## Stage 2 — `set_page_background`

`canvas.md` §XI.4 is the design and the reasoning. The short version: a frame's
own `backgroundColor` is **not** the mechanism and cannot be — excalidraw draws
every frame in `FRAME_STYLE` and `rasterise.ts` matches it deliberately, so the
field would give the model a coloured page and the user a white one, which loses
the exact fidelity bet `compositor-v2.md` §III is built on.

So it is a real page-sized `rectangle` carrying `customData.pageBackground: true`
at the back of the page's child run. The editor, the exporter and
`renderForModel` then all draw it with no new rendering code.

**The build is the exclusions, not the setter.** Every one of these is a separate
place to forget, and the failure is quiet:

- `readableItems` drops it; it reads as `background` on the page object instead.
- `remove_from_canvas`, `transform_on_canvas` and `restyle_on_canvas` each refuse
  it by name, toward `set_page_background`.
- `reorder_on_canvas`'s `back` means "back, *above* the page background".
- **`arrangeableUnits` collects every live element with an id** — so today, one
  press of tidy sweeps a page's own ground into the photo grid. This is the miss
  that costs the most and it is the cheapest to make.
- `resize_page` resizes it. `duplicate_page` and `discard_page` already carry it
  by geometry — verify rather than assume.
- One per page: setting a colour twice recolours, never stacks. `"none"` drops
  the element rather than leaving a transparent rectangle behind.

Test the exclusions, not the setter.

Both agents get the tool, and **so does the user**: a control on
`moodboard-inspector.tsx` beside palette, caption and crop, offered when the
selection is a page. One implementation under `lib/pages`, per invariant 12. The
board's background already has a user control (excalidraw's own, kept in
`BoardMenu`); the page's has neither, which is why both sides land together.

## Stage 3 — `set_canvas_background`, agent 6 only

Small, and it has one trap.

`viewBackgroundColor` is already in `PERSISTED_APP_STATE_KEYS` and `render-plan`
already reads it as `plan.background`. Both ends exist; only the middle is
missing.

**This is the first agent write in the app that is not an elements write.**
`sceneWrite(elements)` takes elements and derives the page columns from them;
`appState` is a separate `Json` column, and none of the scene conflict story
reaches it — no revision guard, no keyed queue, no no-op detection. Written
naively it acquires none of the three, and the symptom is an idle tab handed a
conflict for a repaint that changed no pixel.

It is the **orchestrator's alone**. Not in agent 8's set: the board is the desk
the user's pages sit on, and a design assistant handed one page has no business
repainting it. Gate on `boards > 0`.

## Stage 4 — "Let's Vibes"

`compositor-v2.md` §IX in full. Depends on stage 2 — the theme colour becomes
each page's background before any design call runs.

**The form** (§IX.1) — purpose, pages, palette, vibes, **and page size**. The
last is not in the user's original four and is in the spec on purpose: a welcome
sign is portrait and a banner is landscape, nothing else in the form says which,
and `resize_page` moves nothing, so guessing wrong costs the whole run. Palette
seeds from `mergedPalette` over the project's own photographs. Do not merge it
with `Project.brief`, which is a different thing.

**The execution** (§IX.2), in two mutations:

- `vibes.start` — no model call. Board titled from the purpose, N empty pages at
  the preset, each page's background set to the theme colour, chat rows written,
  returns `{ boardId, pageIds }`. Pages up front so each design call gets a
  `pageId` rather than a `newPage` flag racing the others, and so the ground is
  decided once by the form instead of by page 1 and matched five times.
- `vibes.designPage { boardId, pageId, index }` — builds the intention and calls
  the **existing** `designPage({ boardId, pageId, intention, imageIds })`
  unchanged. That door already takes exactly these arguments. You are adding a
  caller, not an agent. If you find yourself changing `design.ts`, stop and
  re-read.

The browser calls the second one in sequence, one page at a time. This app has no
job queue and no streaming — a turn is a blocking tRPC mutation and is already
the longest thing in it. Six pages in one mutation is a single request running
for minutes with nothing to show and nothing to stop; six mutations is bounded
work, honest progress, a failure at page four that keeps pages one to three, and
a Stop button that means it.

**The intention builder is a pure function in `lib/`** — form values plus page
index plus catalogue in, one string out — so what the model is asked can be
asserted without reaching Vertex, like every other prompt in this codebase.
§IX.3 lists the clauses and what each one's absence costs. The load-bearing one
is the coherence clause for page 2 and after; it works only because `read_canvas`
carries the board picture.

**The run goes in the conversation** — a user row and one assistant row per page
carrying agent 8's own closing line. Otherwise a board appears with no account of
where it came from, and the next thing the user does is ask agent 6 about it.

**Tidy moves, it does not go.** The two buttons leave the top-right island;
`TidyAction`'s action moves into `BoardMenu` beside export, canvas background and
reset. No layout math and no call site changes — only where the press comes from.

`vibes.resume`, picking up at the first empty page, should land with this rather
than after somebody loses a run to a closed tab.

## Tests

The suite is the real spec — **2,596 cases** at HEAD, green. A stage that drops
the count has deleted a behaviour rather than moved it. Adding cases is expected;
losing them is a finding to report.

Coverage worth having, beyond the obvious:

- Requirement 4 as an actual assertion: a composed page's elements before and
  after stage 0 and stage 1.
- Each page-background exclusion separately, especially `arrangeableUnits`.
- The `unaddressable` remainder on a scene holding one of each unreadable type.
- The bound-label filter — the loop it fixes should be a regression test.
- The `fontSize` split: derived stays clamped at 96, explicit reaches
  `CANVAS_TEXT_MAX_FONT`.
- The intention builder against every field combination, including one page and
  `VIBES_PAGE_LIMIT` pages.

## Verification

Per stage, all of them, before the next stage starts:

```
npm run typecheck && npm test && npm run lint && npm run floor && npm run build
```

Then `npm run cites`, which resolves every `§` in the code against these docs.

And the ones that reach real data or real models — these are why they exist, so
report their output rather than asserting it passed:

- Stage 0: `npm run design:pages` and `npm run render:check`. What was the read
  hiding on boards people actually made?
- Stage 1 and 2: `npm run render:check` again — new fills and strokes are the
  first real test of the renderer against excalidraw's own export — then
  `npm run design:check` for one live design that uses them.
- Stage 4: `npm run design:fixtures`, then look at the pages. Coherence across a
  six-page run has no assertion behind it and never will; eyeballing it is the
  test. `npm run design:runs` for what it cost.

## What to flag rather than decide

- **The renderer disagreeing with the export.** `render:check` is the comparison,
  `compositor-v2.md` §III.2.1 is the standing decision. A new disagreement that
  arrives with fills or strokes is a finding, not something to paper over.
- **Anything in these specs that turns out to be wrong when it meets the code.**
  The code wins — fix the spec and say so in the commit. §XI was written from a
  read of the modules, not from having built it.
- **The declaration floor.** If stage 1 plus stages 2 and 3 push the boards-shape
  floor somewhere uncomfortable, say the number rather than trimming prose to
  hide it. `canvas.md` §XI.6 records the cut order if it has to come down.
- **`VIBES_PAGE_LIMIT`.** Six design calls is the most expensive single action a
  user can take in this product, one click from the canvas. If the fixture runs
  say six is too many or too few, that is a reading to report, not a constant to
  quietly change.

## Constraints

- Commit per stage, and never with a red suite.
- Update the specs as you land each stage — record what the build decided
  differently, the way `orchestrator-tool-reference.md` §IV does. **Do not
  renumber any section**: code comments cite `canvas.md` §XI.4,
  `compositor-v2.md` §IX, `tech-spec §V.4` and a hundred others by number. Append
  or amend in place.
- `context/` is gitignored on purpose. Doc edits will not appear in `git status`
  — expected, not a bug to fix.
- Match the surrounding style: `///` comments that explain *why* a rule exists,
  never what the line does. Read `object-put.ts` and `tool-canvas.ts` before
  writing any prose — the house voice is distinctive and a new module that reads
  like a generic import will stand out.
