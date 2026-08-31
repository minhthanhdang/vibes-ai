# ORCHESTRATOR TOOL REFERENCE

**Retirement, 2026-08-24.** `compose_moodboard` is gone from agent 6's set with
agent 4 behind it: `design_page` is the only way a page is laid out now, and
`add_board` — code, no model call, a row and one empty page — is where a board
comes from. §II's gate table and §III's tool table below are amended for it;
§IV's build records are left as they were written, because they are a record of
what was decided at the time and half of what they decided was this tool. See
`compositor-v2.md` §VI for the reasoning and `README.md` for the agent tier.

The tools agent 6 can be handed, as a lookup table rather than as a history. `agent-tools.md` records *why* each one is shaped the way it is; this
records *what* it is, what gates it, what it costs and what comes back.

Declarations: `src/lib/agent/agent-tools.ts`. Executors:
`src/server/agents/orchestrator/tools.ts`. Gate: `orchestratorTools(state)`,
`agent-tools.ts:1059`.

## I. What is primed before any tool

Worth stating first, because three tools exist only to fetch what priming does
not carry, and the line between them is easy to misremember.

`tools.brief()` opens every turn with, in order:

1. `projectBrief` — the project title and the user's own brief, cut at
   `PROJECT_BRIEF_LIMIT` (1,200 chars) on a word boundary, with the cut said
   out loud.

   *Renamed from `directorBrief` / `DIRECTOR_BRIEF_LIMIT`.* "Director" was a
   borrowing from the art-direction language the skills use, and it named the
   wrong thing twice: it reads as a *person* — a director, an agent, a role —
   when it is a **project's** brief, written by the user about the work rather
   than by anyone about how to do it; and it collides with `art-director`, which
   since the skills registry grew is an actual thing in this system with actual
   text behind it. Nothing about the content changes: same two columns, same
   cap, same position at the head of the priming. The code symbols follow —
   `directorBrief` → `projectBrief`, `DIRECTOR_BRIEF_LIMIT` →
   `PROJECT_BRIEF_LIMIT` — and prose everywhere says **project brief**.

   *Measured, as a rename should measure:* `npm run floor` on the same
   11-board project reads instruction 3,217, primed 677, declarations 11,433,
   **FLOOR 15,327** either side of it — identical to the table in §III below,
   because no string the model is handed changed. The suite stays at 3,086.
2. `catalogBrief(photos, { crops: count })` — **photographs only**, capped at
   `CATALOG_LIMIT` (24), one line each:

   ```
   id · title · starred · shape · keeps · tags · unread-mark
   ```

   `tags` is `digestTags` — every dimension agent 2 read, flattened into one
   comma list. The colour palette and the rationale are deliberately left out
   (six hex codes per picture is a quarter of the catalog's tokens for something
   a model cannot see). The count of crops is given as a number; **no crop is
   ever named in the priming.**
3. `currentBoardBrief` — **one board**: the one the user has open in the tab
   they sent the message from, as id, name, page size, page count and page
   names, plus a count of how many boards the project holds in all. Every other
   board is behind `list_boards` and `get_board_brief` (§III).

   *This replaced `boardsBrief`, which named every board up to
   `BOARDS_BRIEF_LIMIT` (6). Both halves of that were wrong in the same
   direction.* The brief grew with the project — a board is a line on every
   model call of every turn, whether or not the message is about a board — and
   the cap that stopped it growing is worse than the growth: on a project with
   seven boards the model is handed six ids and **no door to the seventh**, so
   "the one from Tuesday" is a board it cannot name, cannot look up, and will
   confidently rebuild as one of the six it was told about. A truncation with no
   tool behind it is not a truncation, it is a project the assistant cannot see
   all of.

   The board in front of the user is what nearly every message is about, so that
   one stays primed and the rest becomes a round when it is needed rather than
   tokens on every round in case it is. What is genuinely lost: naming a board
   the user does not have open now costs a `list_boards` round. That is the
   trade, and it is the right way round — a round spent when the case arises,
   against a tax paid when it does not.

   `currentBoardId` comes from the browser, which is the only thing that knows
   which tab is showing what. It is a fact about a tab rather than about the
   project, so the server cannot re-derive it, and it is **not** validated
   against the project on the way in: an id this project has not got primes as
   *no board*, which is what a board deleted in another tab should read as.

So: the properties agent 2 read **are** re-sent on every model call of every
turn, for up to 24 photographs. What is not primed is the crops, anything past
the 24th photograph, and the palette/rationale half of an analysis.

`title` on that line is **agent 2's**, for any picture it has read —
`Analysis.title`, a few words naming what the picture is *of*. A picture with no
analysis falls back to `Reference.title`, whatever string the browser sent at
upload, which is the filename; a crop's is derived from its frame's
(`croppedReferenceTitle`), and once the cut is read it gets a name of its own
with `croppedFrom` still saying where it came from. See §III, *Titles*.

## II. The gate

`orchestratorTools` reads three counts off `projectState` and returns a
fixed-order list:

| count | what it unlocks |
|---|---|
| `photographs + crops > 0` | `list_references`, `show_references`, `crop_reference`, `discard_reference`, `read_references` |
| `crops > 0` | no tool of its own — it decides what the surviving declarations *say*: whether a description names `list_references` as somewhere ids come from, and whether `crop_reference` and `discard_reference` carry their clauses about cuts |
| `boards > 0` | the fifteen board/page/canvas tools, plus `design_page` and one clause of `add_board`'s own description |

There was a fourth count, `stalled` — pictures marked `failed` or `never` — and
it gated `read_references` while that tool filed readings. It is gone with the
job: stalled is the pictures with *no* properties, and properties are the whole
of what the tool now answers with, so the count had come to withhold it from
exactly the project it is useful on. Nothing else read it.

Empty project → two declarations. A declaration is paid on every round of every
turn, so a tool this project cannot call is that spend for nothing; the same
counts also strip parameters and prose clauses out of the declarations that do
survive. The exceptions are `generate_image` and `add_board` (§III), neither of
which takes an id — there is nothing an empty project could be missing that
would make either call impossible, and between them they are how such a project
stops being empty: one makes the first picture and the other the first board.
Both are ungated and both have prose still gated on the same counts — the empty
project's `generate_image` names no other tool, because there is no other tool
to name, and does not tell the model to prefer a photograph of theirs, because
there is not one.

`add_board` is also the one declaration allowed to name a tool the project
cannot call *yet*: it names `design_page`, which is gated on `boards > 0`, and
calling `add_board` is exactly what makes that count 1. Declarations are
resolved per round (`orchestrator.ts`), so the round after is a round
`design_page` is on the list for. `orchestrator/tools.test.mts` holds every
other declaration to the rule and this one to the exception.

## III. The tool table

Cost column: **model** = a Vertex call, **query** = database only, **offer** =
writes nothing, puts a button in front of the user.

| tool | gate | cost | ceiling |
|---|---|---|---|
| `list_references` | pictures | query | `CATALOG_LIMIT` 24 |
| `show_references` | pictures | query | `SHOWN_LIMIT` 8 per call |
| `read_references` | pictures | query | `READ_LIMIT` 8 per call |
| `crop_reference` | pictures | model (vision) | 1 per call, `CROP_CALL_LIMIT` 2 per turn |
| `discard_reference` | pictures | offer | one picture per call |
| `list_boards` | boards | query | — (uncapped: every board in the project) |
| `get_board_brief` | boards | query | one board per call |
| `inspect_board` | boards | query | — |
| `add_page` | boards | query | — |
| `duplicate_page` | boards | query | — |
| `duplicate_board` | boards | query | — |
| `discard_board` | boards | offer | one board per call |
| `resize_page` | boards | query | — |
| `discard_page` | boards | offer | one page per call |
| `swap_on_board` | boards | query | `SWAP_LIMIT` 10 per call |
| `reword_on_board` | boards | query | `REWORD_LIMIT` 10 per call |
| `move_to_page` | boards | query | `MOVE_LIMIT` 10 per call |
| `read_canvas` | boards | query | — |
| `put_on_canvas` | boards | query | `CANVAS_PUT_LIMIT` 10 per call |
| `remove_from_canvas` | boards | query | `CANVAS_REMOVE_LIMIT` 10 per call |
| `transform_on_canvas` | boards | query | `CANVAS_TRANSFORM_LIMIT` 10 per call |
| `reorder_on_canvas` | boards | query | `CANVAS_REORDER_LIMIT` 10 per call |
| `design_page` | boards | model (vision, multi-round) | `DESIGNER_ROUND_LIMIT` 12 rounds, `DESIGNER_PICTURE_LIMIT` 8 pictures; no per-turn ceiling |
| `add_board` | **none** | query | — |
| `generate_image` | **none** | model (image) | one picture per call, `GENERATE_CALL_LIMIT` 2 per turn |

`compose_moodboard` stood in this table between `reorder_on_canvas` and
`generate_image`: pictures-gated, one text model call, `COMPOSE_BLOCK_LIMIT` 12
blocks and `LAYOUT_MAX_TEXT_BLOCKS` 2 lines. It is retired — nothing declares it
and nothing dispatches it from a turn.

*Two drifts this table already had, noted rather than fixed here:* it is missing
`restyle_on_canvas`, `set_page_background`, `set_canvas_background` and
`design_page`, all of which are declared today; and `CROP_CALL_LIMIT` has been
12 (`= COMPOSE_BLOCK_LIMIT`) rather than 2 since before agent 8 existed. With
`list_boards` and `get_board_brief` above, the live declaration count is 28.

### Boards — finding one

**`list_boards`** — no args. Every board in the project, newest worked on first,
one line each: id, name, page size, page count. Reads no scene — it answers off
the same digest columns the priming is built from, which is what makes it cheap
enough to be the answer to *which board was that*, where `inspect_board` is the
answer to *what is on it*. Uncapped, deliberately: the cap it replaces was on the
instruction, where the cost is paid on every round of every turn; here it is paid
once, by a model that asked, in the round it asked in. Forty boards is forty
short lines in one answer, which is what the model needs to name the right one.
Gate: `boards > 0`. An empty answer says so and names `add_board`.

**`get_board_brief`** — args `{ boardId }`. The same line the instruction carries
for the current board, for any other board. Called when a board has been named by
an id that was not in the instruction and the model needs to know what it is
before acting on it — including an id off a board the turn itself just filed,
which is answered off the read that compose folded the new board into rather than
by a lookup of its own. Reads no scene. An id the project has not got is refused by
naming `list_boards` rather than by apologising — the usual cause is a model
naming a board out of the conversation instead of out of a tool answer, and the
fix is one round.

Both answer in the same text `currentBoardBrief` primes, which is the point: a
board looked up and a board primed read identically, so nothing in the
instruction has to say which of the two the model is holding.

**Built, and what it cost.** `npm run floor`, same project minutes apart — 4
photographs, 11 cuts, **11 boards**, with the most recently worked-on board
standing in for the tab's (the script takes a board id as its second argument
now, because the browser is the only thing that knows the real one):

| | before | after |
|---|---|---|
| instruction | 3,122 | 3,217 |
| the project, primed | 939 | 677 |
| declarations | 11,104 | 11,433 |
| **FLOOR** | **15,165** | **15,327** |

**+162, +1.1%**, and the net went the way the priming did not: the brief lost
**262** (eleven board lines down to one and a count) but the two declarations
cost **329** — `list_boards` 162, `get_board_brief` 167 — and the instruction's
boards section grew **95** saying the two of them exist. Rewording the nineteen
board parameters from "the boards listed in your instructions" to "your
instructions or list_boards" cost nothing measurable, which is why the
declarations' 329 is exactly the two new ones.

Eleven boards is close to the crossover: this project paid 24 tokens a board on
every model call of every turn and now pays them once, in a round that asked. A
project of two boards pays the +329 and saves ~25, and a project of forty saves
what it used to spend on the thirty-four boards `BOARDS_BRIEF_LIMIT` never
carried — which is the shape the change is for, and the one where the old brief
was not truncating but hiding. The suite 3,079 → **3,090**.

**Smoked against Vertex, half of it.** `npm run smoke` takes `--board <id>`
now, for the same reason `npm run floor` does: the one fact about a turn that
lives only in the browser is the one a command-line harness could not say, so
without the flag every real conversation this project has ever measured was a
user standing in the gallery. Three turns on the 11-board project, ~$0.01 each:

- With `cmt3ydzmi…` open — the board worked on *least* recently, so a default
  could not have produced it — "which board am I looking at, and what else is
  here?" answered **Lighthouse Keeper Atmosphere** off the priming and called
  `list_boards` once for the other ten. One tool round.
- With an id this project has not got, the reply opened "you currently do not
  have any board open" — the unvalidated id primed as no board, as §II.1 says
  it should, rather than refusing the turn.
- "Just the summary line for `cmt4q9bqy…`, don't open anything" called
  `get_board_brief` and returned the line verbatim, no scene read, no
  attachment.

What that does *not* cover is the browser half: `useOpenBoard()` →
`sendTurn` → `orchestrator.send` is typed end to end, but nobody has opened a
board in a tab and read the priming back. The smoke enters at
`runOrchestratorTurn`, which is where the tRPC procedure enters too — so what is
untested is the hops above it, not the behaviour itself.

The lowest of those hops is no longer one of them. `turn.test.mts` now asserts
that `runOrchestratorTurn` hands `currentBoardId` down to `referenceToolset`
(the priming names the *open* board of two, not the first) and that an id this
project has not got is passed through rather than refused. Worth a test of its
own because the id is the only input to a turn that comes from the browser: what
it primes as is asserted in `tools.test.mts`, but a turn that simply dropped it
would prime every message as sent from nowhere and every one of those toolset
tests would still pass. The suite 3,086 → **3,088**.

The three hops above it still have no runner — `src/app` has no tests, and
`chat-log.ts` is a `"use client"` module importing `useSyncExternalStore`, which
the `--conditions=react-server` runner cannot resolve — so they are held over
the source instead, in `current-board.test.mts`, the idiom `run-price.test.mts`
already uses for a rule no unit test reaches. Five hops named in the order the
id travels, each asserted by the *call* that hands it on rather than by the word
appearing in the file, plus the list of every file in `src`/`scripts` that names
the id at all, so a sixth reader or a dropped hop is noticed either way. Two
more assertions carry §II.1's do-not-validate rule to the layer someone would
break it at: the wire's schema is a bare `z.string().optional()` and the turn
forwards what it was handed with no read in between. Every one of the seven was
mutation-checked — deleting the id from the composer's `sendTurn` call, from the
store's `ask`, or from the turn's `referenceToolset` fails exactly the hop it
belongs to and nothing else. The suite 3,088 → **3,095**.

It is still not a browser test — it proves the words are written, not that a
click produces them.

**Smoked over the wire, too.** The middle hop has now run for real: four turns
posted to `POST /api/trpc/orchestrator.send` on the dev server, as the browser
posts them — superjson body, `da_session` cookie, a session minted straight off
`startSession` because the smoke is of the send and not of Google's login. Same
11-board project, and `cmt3ydzmi…` again as the open board, because it is the
one worked on least recently and so cannot be a default:

- With `currentBoardId` set, the reply named **Lighthouse Keeper Atmosphere**
  and its 11 boards — so the id survives zod, the router's forward and the
  turn, in the real server rather than in a harness that skips all three.
- A second turn in the same thread listed all eleven ids, newest-worked-on
  first, off one `list_boards` round.
- With the field *absent* — the shape a message sent from the gallery has — the
  reply opened "you don't currently have a board open" and still said the count.
- With an id this project has not got, the same answer: `z.string().optional()`
  took it, nothing looked it up, and it primed as no board. §II.1's
  do-not-validate rule holds at the layer that could most easily break it.

What is left is the two hops above the wire — `useOpenBoard()` reaching
`sendTurn`, and `sendTurn` reaching `ask` — which are React, are held over the
source in `current-board.test.mts`, and would need a browser driver this repo
does not have. Nobody has clicked. That is the whole of the remaining gap in
change 2, and it is two lines of forwarding wide.

One thing the smoke showed that no test would have: asked for "everything you
know about board X", the model reached for `inspect_board` — the scene read and
a board attachment — rather than `get_board_brief`. That is the right answer to
the question as asked, and the cheap tool won as soon as the question was cheap
("just the summary line"), so the two are being told apart by the ask rather
than confused. Worth watching, not worth rewording yet.

### References

**`list_references`** — the door to every picture and its properties. Args:
`includeCrops`, which is now an opt-*out*: the cuts are in the answer unless the
call says `false`. Returns `{total, shown, references[]}` as digests, plus
`unreadNote` when anything in the answer is unread. Gated on there being a
picture at all rather than on there being a cut, so a project nobody has cropped
can still ask.

The cost is honest and worth writing down: the declaration is 103 tokens paid on
every round of every turn of every project that has a picture, and for the first
`CATALOG_LIMIT` photographs its answer largely repeats the priming. What it buys
is a project with no cuts no longer being unable to ask, and the properties of a
picture being reachable as an answer rather than only as a primed line. Because
that repetition is real, the *prose* stays gated on the cuts: `idsFrom` names
`list_references` as a place ids come from only when there is a cut in the
project, since on a project without one it would be pointing the model at a round
that can only say back what the turn already carries.

**`show_references`** — puts pictures in the chat beside the reply. Args:
`referenceIds` in reading order. The rule in the declaration is that a name in
prose is not a picture. Over the limit comes back as `notShown`, never silently.

**`read_references`** — the whole of what agent 2 wrote about a named picture,
off the rows it already wrote. Args: `referenceIds`. It calls nobody: no job, no
worker, no vision call. Returns `read[]` — id, agent 2's title, the shape, then
the **palette**, the **rationale** and the tags **under each dimension's own
name** — plus `notRead`, `notFound` and `notLookedUp` for what it did not answer.

It is the only door in the layer to the palette and the rationale. `digestTags`
flattens the five dimensions into one list and drops both, which is right for a
list of every picture (six hex codes on 24 primed lines is a quarter of the
catalog spent on something a model cannot see) and wrong for the one picture the
user is asking about — and until now nothing could answer that at all. So the
answer deliberately leaves the flattened `tags` off: the same words twice, under a
name that means something else on a catalog line.

A picture with no analysis is **excluded from `read` rather than described in
it** — every field would come back empty, and an empty palette beside an empty
rationale reads as a picture with no colour in it. It is named under `notRead`
with the unread mark the model was already shown, which is not the same fact as
`notFound` (an id that answers to no picture at all).

One field escapes both of those rules, and it is the reason this door matters to
a drawn picture: `drawnFrom`, the description `generate_image` made it at, read
straight off `Reference.generationPrompt`. It rides on a `read[]` line beside the
analysis and on a `notRead` line *instead* of one, because the description exists
from the moment the row is written and the reading is minutes behind it — so a
drawing filed this turn is the one unread picture in the project that can still
say what it shows. A `drawnFromNote` beside the answer says what the field is and
the two things it is for: describing a drawing the analyzer has not reached, and
being the text a variant of it is asked from. `notReadNote` carves the exception
out in the same sentence that forbids describing the rest ("unless one carries a
*drawn from*"), so the blank stays a blank everywhere else.

The `made` mark travels with it. `referenceProperties` rebuilds its answer off
`referenceDigest` and used to pick the fields it wanted one at a time, dropping
`made` on the floor — so a backdrop the assistant invented read back as a
photograph the moment it was looked at closely, which is the opposite of what
the catalog says about the same row.

Nothing is attached. What the chat shows is `show_references`' decision, and a
lookup that put four tiles in front of the user unasked is the same overreach
as a reply naming a picture it never showed, from the other end.

`READ_LIMIT` is per call rather than across the turn: the turn-wide count was
protecting a vision call per picture, and there is none left to protect.

**`crop_reference`** — agent 3. Args: `referenceId`, `intention`, optional
`aspect`, optional `boardId` + `pageId`. Answers with an **offer** — a box drawn
on the frame — which the user accepts or declines in the properties panel.
`aspect` takes either a ratio said as `w:h` (any ratio, not a fixed six) or a
loose shape word (`square`, `landscape`, `portrait`, `rectangle`), which frames
around the subject instead of cutting to a ratio nobody asked for. Passing a
board holds the cut to that slot's exact shape and the browser makes the swap
when the cut is taken — so no `swap_on_board` afterwards. Passing a *crop's* id
nudges that crop: the ask goes to the frame it came from with its box attached,
so the cut moves rather than a cut being taken out of a cut.

Pending: the offer becomes a filed row — the cut is made on the server in the
turn that asks for it, shown in the chat as the picture it is, and usable by id
on the next round. Everything above about the arguments holds; what changes is
the ending and the sentence the model is allowed to write about it. §IV.

**`discard_reference`** — offer only, deletes nothing. Args: `referenceId`. The
answer names what would go with it — a photograph takes its crops, and any board
showing the frame or one of those crops is left with a gap — because none of
that is visible to the model. Taking a picture off a board while keeping it in
the project is a different, free act: `remove_from_canvas`.
What the picture *is* is named by its `origin`: the frame a cut leaves standing
is a "drawn picture" rather than "the photograph it was cut from" when nobody
shot it, and the offer's tile carries the column so the sentence the browser puts
in the conversation afterwards can say the same thing (§IV, `generate_image`).

### Boards and pages

**`inspect_board`** — the read. Args: `boardId`, optional `pageId`. Without a
page: what the board holds and its pages listed, each with how many pictures,
lines and shapes are on it. With one: that page's pictures and lines in reading
order, which of them run over the edge, which sit loosely in their slot with the
shape a cut would have to be, and the arrangement itself — every block on the
page as a box, shapes among them with the colour each is standing in (§VI). Shows the board
beside the reply. Never queued behind an edit — it changes nothing.

**`add_page`** — one empty page, the size of the page it goes beside, drawn to
the right of everything on the board. Args: `boardId`, optional `pageId`,
optional `name`. Lays out nothing. Also the fix for a hand-arranged board with
no page at all: the first page is drawn *around* what is already there, which
makes those pictures that page's and lets the board be read and composed a page
at a time.

**`duplicate_page`** — the same pictures at the same size in the same places,
the same lines, on a new page of the same board. Args: `boardId`, `pageId`,
optional `name`. How a variation of one page starts. Explicitly not
`duplicate_board` (clones pages nobody was talking about) and not `newPage`
(lays out from scratch, so it is not a copy).

**`duplicate_board`** — every page of a board, copied, original untouched, the
stored template carried across so the copy is still measurable. Args:
`boardId`, optional `title`. Every other board tool changes the board in view,
so anything worth keeping is copied before it is changed.

**`discard_board`** — offer only. Args: `boardId`. The answer says what is on
every page of it. The declaration forbids offering one unprompted — not after a
duplicate, not as tidying — because a discard cannot be undone. No photograph
leaves the gallery.

**`resize_page`** — the page becomes `LANDSCAPE_HD` (1920×1080), `PORTRAIT_HD`
(1080×1920) or `SQUARE` (2048×2048) and **nothing moves**. Args: `boardId`,
`pageId`, `preset`. The only door that changes a page's shape without
rearranging it. Because nothing moves, a shrunk page leaves pictures beside it —
they stay on the board and stop being that page's — and a grown one takes in
whatever it now covers; both are reported. The three presets are the shapes the
templates are cut for.

**`discard_page`** — offer only, one page off, the rest of the board standing.
Args: `boardId`, `pageId`. What would go is the page and its arrangement; the
photographs standing on it come off the board with it, and none leaves the
gallery. A section the user drew inside the page keeps its own pictures.

**`swap_on_board`** — one picture in the place of another, nothing else moves.
Args: `boardId`, optional `pageId`, `swaps[{takeOff, putOn}]`. Naming two
pictures the board already holds makes them trade places. Preferred over a
rebuild for any picture-for-picture change, since a rebuild reassigns every
slot. On a multi-page board the `pageId` matters: without it the copy taken off
is whichever the board carries first.

**`reword_on_board`** — the words of a line change, the line keeps its place,
every picture keeps its slot. Args: `boardId`, optional `pageId`,
`rewordings[{from, to}]`. Matching is on the exact words as `inspect_board`
reported them, and a block already broken over several lines is matched by the
sentence it says — the key collapses whitespace. Adding or removing a line is
`put_on_canvas` and `remove_from_canvas`, not an empty `to`.

The line keeps its **width** and takes the **height** its new words come to: a
block pinned to a slot (`autoResize: false`, which is every text this app
writes) is broken to that slot by the same `setBlock` the canvas text doors use
(`render/text-set.ts`), because excalidraw draws `text` exactly as it is stored
and wraps nothing until somebody opens the element. Without it a headline
reworded into a sentence was one long line running out of its slot and off the
page — the fourth door onto the fact `put_on_canvas` and `restyle_on_canvas`
settled (`compositor-v2.md` §IX.5). A block that sizes itself is written the way
this door always wrote, one string in both fields and no height touched.

**`move_to_page`** — pictures come **off** one page of a board and join another
page of the same board where there is room, at that page's own picture size, so
the board holds each once. Args: `boardId`, `fromPageId`, `toPageId`,
`referenceIds`. Neither page is laid out again. Not `swap_on_board`, which would
leave the copy behind and have the board carry the picture twice.

### Canvas

The five direct-manipulation tools (`canvas.md` §XI; lib modules under
`src/lib/canvas-objects/`). Every one addresses objects by `objectId` — the
element id, surfaced by `read_canvas`; for a page, its frame id, the same
string `pageId` means everywhere else — because `referenceId` stops naming one
thing the moment a photo is placed twice. Boxes cross as
`[ymin, xmin, ymax, xmax]`: thousandths of the holding page for page members,
scene px for pages and loose objects, each object's `boxUnit` saying which. The
plumbing is `swap_on_board`'s: every id read project-scoped, every write
revision-guarded and queued on the per-board queue, a call that changes nothing
skips the write entirely, and every result carries its remainders —
`notOnBoard`, `locked`, `refused`, `unreadable`, the over-cap surplus with a
call-again note — nothing dropped silently. A `notOnBoard` on
transform/reorder carries the note that a `referenceId` is not a handle: the
same photo placed twice is two objects.

**`read_canvas`** — the geometry read. Args: `boardId`, optional `pageId`.
Returns every object's handle, kind, box (with `boxUnit`), angle in degrees,
`z`, page, locked and clipped marks, plus per kind the `referenceId` and
title, the line's words, or the page's name/preset/size. `z` is stacking among
the object's own company — a page's members, loose objects, pages — 0 at the
back; the list itself is in reading order. Page membership is geometric
(centre inside, topmost page wins), never `frameId`. Not `inspect_board`,
which answers what a board holds and whether it still stands as composed; this
answers where everything is and by what handle to grab it. Never queued,
attaches nothing; an unknown `pageId` is answered with the pages that would
have worked.

**`put_on_canvas`** — an image, a text block or a page joins the board. Args:
`boardId`, `objects[{kind, referenceId/text/name, pageId?, box?}]`. No box →
the same placement the edit-in-place compose path uses (`placeOn*`,
`placeLinesOn*`, `addPage`); an explicit box → the element skeleton written
the way `composedScene` writes it, with `frameJoining` deciding what it lands
in. An image contains at its aspect centred in the box — put never stretches;
that is `transform_on_canvas`'s explicit `stretch`. A picture already there
answers `alreadyOn` (scoped to the named page, or the whole board when loose);
a reference this project does not hold is refused before anything is written;
a page cannot be put on a page. A text box is a measure of both things it can
measure: the type follows its height and the words break to its width
(`setBlock` in `render/text-set.ts`), the drawn height following the lines they
came to — so a block that took more than one line comes back as `wrapped`, the
way a size the clamp moved comes back as `clamped`.

**`remove_from_canvas`** — objects leave the board, never the project. Args:
`boardId`, `objects[]` of selectors, each tried as an `objectId`, then a
`referenceId` (every copy pointing at it), then a line's words, then a page
(members go with it; sections and their photos stay). Removal drops elements
from the array — the existing convention, no tombstoning. A selector that
would take anything locked is refused whole rather than removing the unlocked
copies; scaffolding (arrows, section frames) is refused rather than swept.
Shapes leave the way they arrived, on `readableTarget`'s answer: what
`read_canvas` surfaces is exactly what this takes off.

**`transform_on_canvas`** — batched `{objectId, to?, angle?, size?, stretch?}`
(move / rotate / resize in one call: "move it left and shrink it" is one
guarded write, not two conflicting ones). `to` is `[ymin, xmin]` and `size`
`[height, width]`, both in the object's own read dialect. Pages never rotate —
refused with a reason — and page `size` is refused toward `resize_page`.
Groups transform rigidly through `elementPlacements` (`fontSize` and arrow
`points` scale), rotation shortest-path about the unit's centre; locked, or a
group carrying a locked member, is refused; image resize keeps aspect unless
`stretch: true` on a lone image; text resize is `fontSize` scaling, down to
`LAYOUT_TEXT_MIN_FONT` and no further — under it the size stops, the words
break again to the narrower box and the block stands to its lines, and the
shortfall comes back as `clamped` (there is deliberately no *ceiling* here, so
type larger than the put's is one put and one resize); a lone
shape takes the asked box exactly, having no proportions to keep; crossing a
page edge reconciles `frameId` toward geometry (`arrangeOwners`); a moved page
carries its geometric members. Sub-threshold changes are no-ops; addressing
the same unit twice in one call refuses the later change.

A sixth — `restyle_on_canvas` — and two background tools are designed and not
built; they are in §VI, with the fourth object kind (`shape`) the read grows
under them.

**`reorder_on_canvas`** — z-order, addressed relatively (`front`, `back`,
`above`/`below` an object, exactly one per move) because array position is not
a property a model should compute. `front`/`back` scope to the object's own
stacking company — a page member moves within its page's child run, which
stays immediately before its frame; `above`/`below` across two companies is
refused, because `read_canvas`'s `z` is per company. Shapes restack like any
other object — a scrim exists to sit behind something. Pages are refused; groups
move as blocks with labels riding their containers; tombstones keep their
array positions; moves apply sequentially against the array each prior move
left. Moved elements' fractional `index` fields are regenerated so the editor
cannot restore the old order; `front` on the frontmost writes nothing.

### Composition

**`add_board`** — the one tool that makes a board, and the only tool in the
table that decides nothing. Required: nothing. Optional: `title` (the tab row's
name, falling back to `composedBoardTitle`'s), `preset` (`RESIZE_PAGE`'s three:
`LANDSCAPE_HD`, `PORTRAIT_HD`, `SQUARE`, defaulting to landscape), `pageName`.
Gate: **none** — it takes no id, and it is the tool that makes `boards > 0`
true. Cost: one create, no model call, no run row and no revision guard, because
the board does not exist until the create returns. It files the row, draws its
one empty page with `addPage`, folds the board into the turn's own read so later
rounds see it in the catalog, and answers with `boardId`, `title`, the page and
the tile. Its description's one gated clause routes a project that already has a
board to `duplicate_board` for "another version of this" and to `design_page`'s
`newPage` for another page.

**`design_page`** — agent 8, and the only way a page is laid out. §V has the
declaration; what changed with the retirement is the *answer*. Beside its
closing line — which is the model's own on every ending now, because the loop
buys one tool-less round rather than handing back a constant
(`DESIGNER_CLOSING_ASK`) — it carries a read of the board taken after the loop
(`server/agents/designer/report.ts`): the page it worked on, the pictures on it
in reading order with the clipped ones marked, the lines, the ground behind it,
the pictures agent 6 named that are not on it, anything sitting beside the page
rather than on it, and what the design had to draw or cut. Read in the *door*,
so `vibes.designPage` gets it too, and off one read that also carries the scene
the tile is drawn from — the tool layer no longer re-reads the board for either.
The snapshot of page ids taken before the loop is what lets a `newPage` design
name the page it made itself.

**`compose_moodboard`** — agent 4, **retired 2026-08-24**. The section below is
kept as the record of what it took; nothing declares it and no turn can reach
it. What it was: the one tool that made something.

Required: `intention`. Always available: `referenceIds`, `captions`, `layout`,
`title`. Available only with `boards > 0`: `boardId`, `pageId`, `newPage`,
`pageName`, `addReferenceIds`, `removeReferenceIds`, `addCaptions`,
`removeCaptions`.

- No `boardId` → files a new board; `referenceIds` required.
- `boardId` → rebuild in place. Bare `referenceIds`/`captions` replace the
  selection outright; the add/remove pairs are surgical and cost no compose for
  a removal.
- `pageId` picks which page; other pages are untouched. Left out on a
  multi-page board, the first page is the one laid out again.
- `newPage` puts the arrangement on a fresh page beside `pageId`, reading and
  moving nothing already on the board.
- `boardId` + `title` alone is a rename. `boardId` + `pageId` + `pageName` alone
  renames a page and touches nothing else.
- `layout` left out keeps the template the board is on; `RANDOM` deliberately
  reshapes it. Only three of the ten templates carry text, so naming a template
  with captions in hand can drop the line — reported, not silent.

Answers with the board id, filed-or-rebuilt, what was placed, what was seated
where there was room, what did not fit, which pictures sit loosely and the shape
a cut of each would have to be, plus the board attachment.

### Generation

**`generate_image`** — the `IMAGE` model (`gemini-3-pro-image`) as a tool, and
the only one in the table that makes a picture rather than reading, cutting or
arranging one. Required: `description` — what the picture should show, style and
mood included. Optional: `aspect`, in `crop_reference`'s dialect (a ratio said
`w:h`, or a loose shape word). Gate: **none**, the one tool every project has;
it takes no id, so there is nothing an empty project could be missing that would
make the call impossible.

The shape is honoured natively where the API has a canvas for it —
`generationConfig.imageConfig.aspectRatio` takes one of ten — and folded into the
prompt only where it does not: an exact ratio outside the ten, or a loose word no
canvas represents. The answer says which happened. `{imageId, title, width,
height, aspect}` plus the ordinary `ReferenceAttachment`, with `drawnAt` when the
picture did not arrive at the ratio the call asked for, so the reply quotes what
was drawn rather than what was requested.

What the call does, in order: read the dialect and refuse an unreadable shape
before spending; take the per-turn budget (`GENERATE_CALL_LIMIT` 2, said in the
description the way the crop limit is); open an `IMAGE_GENERATOR` run row and
spend it on the refusal as well as on the picture; then `importFromUrl`'s exact
ending — the PNG into the project's own prefix, a `Reference` row (`origin:
GENERATED`, `generationPrompt`, a title off the description's opening clause,
width and height read off the PNG's own IHDR bytes) and agent 2's job in one
transaction, worker kicked. No board is touched, so nothing rides the `boardEdits`
queue.

The title is numbered where the project already holds that name — "A warm grey
paper texture (2)" — against the turn's own list, so a second drawing in the same
turn is kept clear of the first. The names it steps around are every reference's,
a photograph they uploaded included; the base is what gives way to the ceiling,
never the number, which is `croppedReferenceTitle`'s rule and a copied board's.

The budget counts calls, not pictures — a refusal by the image model costs the
same money as a drawing and spends its place — so the sentence refusing the
turn's third ask is built from both numbers (`generationCeilingSaid`, beside the
limit it quotes). A turn whose two attempts were both refused is closed with
"none of them could be drawn", not with "show the user what you drew": the
ceiling is a budget fact and the sentence is a project fact, and telling a model
holding nothing to describe what it drew is the one thing the answers' `status`
wording exists to prevent. It costs no declaration tokens — the floors are
unchanged at 1,313 / 3,086 / 3,249 / 11,970 — because it is only ever paid at
the moment the ceiling is hit.

Every way the ending can fail answers as a sentence rather than as a throw, and
each one closes the run row with what the call cost: the call never landing, the
description turned away before any drawing, the model refusing to draw, the
bucket refusing the bytes, and the transaction refusing the row. The last is the
one worth naming — a picture drawn, paid for and stored, with nothing in the
project to place or show. A throw there would
reach the model as a database string and leave the dearest run row in the file
standing at `RUNNING` with its tokens unrecorded.

"A sentence" is a stronger claim than passing an exception's `message` on, which
is what the file's other model tools do. The image model is the one that answers
burst throttling as an **HTML page** (infra.md §X), so the likely failure here
hands the orchestrator 300 characters of `<html><title>Error 404` to write a
reply out of. So the generator wraps its own call: a throw from the transport is
turned into one of two sentences — busy (offer to try again) or unreachable (do
not) — chosen off the `retryable` flag `vertexFetch` sets when its four rounds of
backoff are spent, and the original rides along as `detail` for the run row,
where a diagnostic belongs and a reply does not. The wrapped throw is not
retried: the loop's second attempt is for a model that answered without a
picture, not for one that never answered.

A block decided on the description alone is the fifth path and the one the loop
reads differently from the rest. It arrives *in place of* a candidate —
`promptFeedback.blockReason`, with no candidate to quote a sentence off — so the
loop's usual reading of an answer with no picture finds nothing and used to end
at "the image model returned no answer" after two paid calls. It is now read
before the candidates are, named in the answer (the service's own
`blockReasonMessage` when there is one, its `blockReason` code when there is not)
and thrown on the first call: a second attempt sends the same words to the same
reader and is refused identically, so retrying it is a second bill for an answer
already given. The sentence steers where the retry cannot — "ask the user to
describe the picture in different words" — and because the reason is *in* the
sentence, this is the one written-here refusal whose run row needs no separate
`detail`.

The id is usable **in the same turn**: the turn's memoized reference cache is
appended to as the row is filed, so `put_on_canvas` on the background it just
made resolves rather than answering `notInThisProject` — and on the empty
project the picture flips the counts, so the tools that arrange pictures arrive
on the next round of the same turn.

The **instruction** follows the counts onto that round too, and did not until
now: `orchestrate` resolved its declarations per round and its system
instruction once, before the loop. So the empty project that drew a backdrop
spent the rest of that turn being handed `show_references`, `crop_reference` and
`compose_moodboard` under a paragraph reading "nothing has been uploaded to this
project yet, so there is nothing to show, cut or compose" — the prose half of the
gate saying the opposite of the tool half, and the sections explaining those
tools withheld on the one round they were callable. `brief` and `state` are now
passed as the toolset's own readers rather than as their answers and resolved
beside the declarations, so the catalog a round is answered against holds the
picture drawn on the round before, `generated` mark and all. `generate_image` is
the only tool that can move a project between gate classes without the user
doing anything, which is why this surfaced here; `compose_moodboard` filing the
first board had the same shape, and is closed by the same change. Both reads are
memoized, so a round costs no extra query. Measured on the empty project, the
instruction goes 368 → 790 tokens on the round after a drawing (+422) — paid only
by a turn that actually drew one, and beside the ~1,400 tokens of declarations
that round was already handing over.

The picture the tool files is a reference the browser never decoded, so the chat
is also where it is given the grid-sized copy every other reference has: the turn
that filed it derives one from the app's own copy of the bytes, on the same seam
as the list invalidation. Without it a drawn backdrop streams its full-resolution
original into every tile that ever shows it.

`origin` is a column, not a convention: `UPLOADED` (default) | `IMPORTED` |
`GENERATED`, which also retired the magic-title marker the web import used.
It reaches the user as a `Generated` facet and a badge in the strip and the
gallery, and the model as a `generated` mark on the catalog line — without
which the instruction to prefer a picture the user already has is unactionable,
since a backdrop drawn an hour ago reads exactly like a photograph they shot.
A cut inherits its frame's answer — `versionOrigin` on the create in
`addVersion`, the one path any version is written down — because all three of
those readers ask the row in front of them and not its source: left to default,
a crop of a drawn backdrop files as `UPLOADED`, which is the single reading of
it that is false, and it drops out of the facet the moment it is cut.

The mark is only half of "prefer a picture they already have", and the other
half is false on the project this tool creates: a project that drew its way out
of empty *has* pictures and none of them are the user's. The preference is
written down three times — `madeNote` under the catalog, `GENERATING_OVER_THEIRS`
in the instruction, and one sentence of the declaration — and all three used to
promise a photograph they brought wherever anything was marked. Each now chooses
between two sentences. The catalog's note chooses off the list it is explaining
(any unmarked line and the old sentence stands, none and it says there is none
to prefer instead), and the instruction and the declaration choose off
`ProjectState.generated`, a fourth count beside the three that gate everything —
the pictures, cuts included, that came out of this tool. It gates nothing: a
drawn picture is shown, cut and composed like any other, and the count exists
only so a sentence about preferring theirs is not read to a project that has
none. Optional on the type, on the same terms `origin` is optional on a
reference: a caller that has not counted them is not claiming there are none.

The steer that replaces it is one nothing here used to say. `GENERATE_CALL_LIMIT`
bounds a *turn*, so a model asked for the same backdrop on three turns draws it
three times, and each of those is the dearest call in the product answering with
a different picture — image generation is stochastic, so "again" is never the
same one. So the drawn-only wording keeps look-before-you-draw and gives the
reason that survives there: reach for the one you have, and draw when it
genuinely does not fit. Measured on the pinned sample, whose one reference is a
generated picture and which is therefore exactly this shape: the note is +24
tokens of primed brief, the instruction's sentence +22, and the declaration
+4 (436 → 440) — 50 on the shape that has only its own drawings, and nothing at
all on a project holding one photograph of theirs.

`generationPrompt` reaches the user as a **Drawn from** section above the
reading: what the picture *is*, quoted as the assistant asked for it. It stands
there because it is true of the row the moment the tool files it, and the
analysis it sits above may be minutes behind — a picture drawn this turn
otherwise gets a panel that says only "not analyzed yet" about the one reference
in the project whose subject was written down.

It stands on all three of them. A picture's properties are shown in the sidebar
panel, in the full-size viewer and in the board's inspector — the same
`ReferenceProperties` on each — and the section was written into the first of
them alone, so the two surfaces a *drawn* picture is most likely to be looked at
from had it least: the viewer is where a backdrop is examined at its own size,
and the inspector opens on the picture sitting on the board it was drawn to go
on. It is one `DrawnFrom` component over one pure rule (`drawnFromSaid`, beside
the title and the header reader, trimmed and null on a blank so no panel opens a
quotation mark on nothing), rendered above the reading on each. The viewer is
handed whole gallery rows and needed only the field on its own type; the
inspector reads its row through `reference.summary`, whose hand-written select
had never taken the column — `reference.versions` all over again, and the second
of the two reads in the app that select by hand rather than by spreading the row.

It reaches the model through `read_references`, as `drawnFrom` (§III, *Reading*).
The model's side of that silence is worse than the user's: the conversation it is
handed carries text only — `historyWindow` sends `{role, text}` and no tool calls
— so by the next turn the description it drew a picture at is simply gone, and
the row is the only copy. Without the door, "make another like that one, but
bluer" is answered from a 60-character title and a mark. Deliberately not on the
catalog line: a mark is a word and a description is a sentence, so it is worth
its tokens on the picture the user is asking about and not on twenty-four.

The last surface to learn the column is the one that takes a drawn picture back
out. A removal is announced to the conversation **in the user's own voice** — "I
removed the photograph “Warm grey paper”" — which is the one place a wrong noun is
read as a fact rather than as a claim the model can doubt, and it was said of
every reference that was not a cut. The noun is now `pictureNoun(origin)`, one
pure rule read in three sentences: the removal itself, the frame a cut leaves
standing ("the drawn picture it was cut from is still in the gallery"), and
`discard_reference`'s own `cutOf` at offer time. An import is worded as an upload
is — the distinction the noun carries is which of them nobody shot — and an
absent column words the removal exactly as it always did.

The awkward half is *when* the sentence is written: the browser writes it after
the row is deleted, so there is nothing left to ask. So the offer's tile carries
`origin` beside its `discard` payload, for the reason it already carries the cuts
and the boards it would leave gaps in, and the gallery's and the panel's own
Remove buttons read it off the row they are drawn from (which needed `origin` in
`reference.versions`' select — the one reference read that had never selected it).
Free at the floor, measured on the pinned sample: the noun is an executor and
browser sentence, not a declaration.

The third reader of it is the strip's search box, which now looks through a
drawn picture's prompt beside the title and the tags. That box is how a picture
is found once there are forty of them, and a drawing is the one reference it was
worst at: its title is the description's opening clause and nothing more, and
the tags it is otherwise searched by arrive when the analyzer reaches it, minutes
later. "The one with the vignette" is asked of a backdrop in the seconds after it
lands, and the vignette is in the prompt. The placeholder names the prompt only
on a project that holds one, under the rule the `Generated` control is offered
by: a search box promising to look through something that is not there is a
promise the strip cannot keep.

The last reader of the column is **agent 2**, and it is the one that had been
told something false about every drawn picture in the product. The analyzer is
handed the image and one sentence of context, and that sentence was "The user
filed it as “A warm grey paper texture (2)”" — a person who filed nothing, a name
they did not choose, and a number that is a disambiguator rather than part of
what the picture is of. The analyzer's own instruction says a title is read as a
fact about the picture rather than as a reading of it, and this is the input that
fact is anchored on.

So the ask is now worded off `origin` and `generationPrompt` (`analysisAskSaid`,
beside the analysis vocabulary): an upload and an import keep the sentence they
had, and a drawing is introduced as one — drawn by an image model rather than
shot — quoting the description it was asked for in place of the title cut out of
it. That is the better input as well as the true one: a drawing is the only
reference in the project whose subject was written down *before* it existed,
where the upload branch is quoting a filename. It is quoted with a warning,
because an image model drops parts of a prompt and a request is evidence rather
than fact — "read what is in the frame" is agent 2's standing rule and this is
the one input that could tempt it off it. A cut of a drawn picture inherits the
origin and not the words (only the frame was ever asked for), so it falls back to
the name it was filed under. Free at the floor: the ask is one user part of one
vision call, not a declaration.

The last reader of all is the user, who was never told any of this. The model
was corrected three times over — `NOTHING_UPLOADED` stopped saying every
reference comes from an upload, the prefer-theirs sentence learned the project
that has only its own drawings, the analyzer stopped being told a person filed
one — and the three sentences the *app* says about where a picture comes from
still named uploading as the only door. Two of them are the first thing a user
reads on exactly the shape this tool is ungated for: the empty gallery
("Upload the images you want to work from"), the empty conversation
("References come from your own uploads"), and the pipeline list on the home
page, whose intake row read "You upload the references" and whose orchestrator
row routed between "the five above" with no seventh agent under it.

So the capability had no way of being discovered except by asking for something
the user had no reason to think was there. All three now name it, in the app's
own word for it — a picture is *drawn*, the noun `pictureNoun` already answers
a removal with — and each names it where it is true rather than as a feature
line: the gallery's empty state offers it beside the upload it sits under, the
conversation's offers it as the thing that column can do that the dropzone
cannot, and the home page carries agent 7 as its own row ("Draws the picture no
photograph is"), with the intake row's "not an agent" note kept and its claim
narrowed. Free at the floor — browser copy and a server component's constant,
not a declaration — and measured: 1,382 / 3,191 / 3,354 / 12,075, unmoved.

Cost, and it is the only tool in the table every project pays for: 436
declaration tokens plus 219 of prose on every round of every turn, 655 together
(559 on the empty project, whose whole floor was 718 before it; 440 and 241 on
a project holding nothing but its own drawings, which reads the other half of
the prefer-theirs pair). Per call, the
image model bills its output at $120/M against $12/M for text, and a run row
keeps one output number, so `MODEL_PRICES` prices a generation at the picture
rate throughout — about a quarter dearer than the invoice, which is the
direction to be wrong in for the one tool here that can spend a fifth of a
dollar in a call.

### Titles

Not a tool — the one field every digest carries that used to be nobody's
reading. `Reference.title` is client input at `reference.add`, so it was the
uploaded filename on every catalog line, every board block and every attachment
caption. Agent 2 already looks at the picture, so it now names it too:
`Analysis.title`, a few words for what the picture is *of*, first in
`RESPONSE_SCHEMA`'s `propertyOrdering` and required, capped at 80 characters by
`normalizeAnalysis` and bound by the instruction's existing rule about never
guessing at a film, a photographer or a production — the title least of all,
since a name reads as a fact about the picture rather than as a reading of it.

`referenceDigest` prefers it, falls back to `Reference.title`, then `Untitled`.
Three reasons it is a column on `Analysis` rather than a write onto
`Reference.title`:

- that row's title is the uploader's, the one name in it that can be theirs;
- a picture nobody has read must keep reading as **unread** rather than as
  untitled — a generated name written onto the reference row would make the two
  states indistinguishable;
- it is replaced, not accumulated: the worker's upsert rewrites the analysis
  row, so a re-read renames the picture without touching what was uploaded.

It costs no declaration tokens — nothing in §III's table changes — and the floor
was measured unchanged to the token, before and after. What it changes is the
*value* on a primed catalog line, which was already paid for.

### The reading that became a read

`read_references` was agent 2's door: it filed a job per picture with the
analyzer's queue and woke a worker, and it was the one tool in the list that
answered *"I have asked"* rather than the question it was called about. It now
answers the question. What went with the job:

- the `AnalyzerQueue` seam and `analyzerQueue()`, which had no other caller —
  `enqueueAnalysis` and `kickAnalyzerWorker` are still the properties panel's,
  from `reference.ts`;
- `readAsked`, the per-turn set that stopped a model naming one picture in two
  rounds from buying two vision calls;
- the three-way status — worker woken, no worker startable, nothing filed — and
  the `queued` / `alreadyBeingRead` / `alreadyRead` / `notQueued` / `couldNotQueue`
  lists under it;
- `stalled` off `ProjectState` (§II), and the attachments: a reading on its way
  was worth putting in the chat so the user could watch it land, and a lookup
  is not.

What it cost is the chat's door to a re-reading. A picture marked `failed` or
`never` is now re-read **only from the properties panel**, so every sentence that
used to name the call now names the panel: `unreadNote`, `UNREAD_CATALOG_NOTE`
and the doc comment on `UnreadReason`. Naming the tool would be the worse of the
two failures — the model spends a round finding out it cannot, and tells the
user it asked for something nobody was asked for.

Measured: the tool's declaration went 167 → 174 tokens and the longer sentence
under the primed catalog is 19. The real number is the gate rather than the
wording — on a project with nothing stalled the whole 174-token declaration is
new — and it is priced with the other two changes below.

### What the three came to

The three changes above were each measured as they landed, on a project that
changed between them, which makes those three readings three snapshots and not a
series. Re-measured together against the commit before all three, same project,
minutes apart:

| | before | after |
|---|---|---|
| the local project (6 photographs), floor | 2,072 | **2,201** |
| declarations | 1,082 | 1,192 |
| the project, primed | 418 | 437 |
| instruction | 572 | 572 |

| The project | Before | After | |
|---|---|---|---|
| nothing uploaded | 599 | 618 | +19 |
| photographs only | 1,905 | 2,201 | **+296** |
| and cuts | 2,168 | 2,364 | **+196** |
| and boards | 8,953 | 8,982 | +29 |

Two of the three changes moved the number and both were a single count in a gate:
`list_references` from `crops > 0` and `read_references` from `stalled > 0`, both
to `pictures > 0`. Titles (§III above) cost nothing at the floor — a title is a
value on a catalog line already being paid for. *Photographs only* is the shape
that grew, 16%, because it is exactly the shape both old gates withheld both tools
from. Full tables and the reasoning in `agent-tools.md` §VI.

## IV. The designs, and what the builds decided differently

Every entry below is built. The designs are kept because they were written
here first, and a reader who has only a design would be misled about the three
or four things each build changed.

### The conversation format — built

One shape for every message in the chat, stored per project, with the column
and the Vertex request as two projections of it. The contract as built is
`src/lib/agent/conversation.ts`, and the design's arguments for the `Message`
and `Part` schemas, the `PART_RULES` mapping table and the two projections are
in `src/lib/agent/Conversation.md` §I–III, which is in git where this file is
not — plus the `ChatMessage` table, the `chat` router,
and `lib/agent/chat-log.ts` as a cache over the store. The four open questions
closed as recommended: `call` and `result` parts are stored always and drawn
never, a `failed` message is not persisted, an `event` stays the user's as a
kind on a part, and there is no streaming — `pending` is only ever set by the
live turn in the browser. What follows is what the build decided differently
from the design that used to stand here, step by step —

- **The format and the adapter** — the zod schemas, the `satisfies`-checked
  mapping table, and unknown parts kept verbatim, drawn as nothing and left out
  of the request, with `isKnown` judging by shape rather than tag so a known
  `type` missing a field degrades the same way as a type from a newer build.
  Decided differently: a live-turn part is an `Emitted` — the typed part with
  the model's raw emission riding beside it as `wire`, which `forRequest` sends
  verbatim within the part's own turn. The old loop had always round-tripped
  raw candidate parts, and that silence was load-bearing: Gemini 3 thought
  signatures must be returned on later rounds of the same turn, so a request
  reassembled from typed parts alone would 400 or degrade live turns while
  passing every offline test. In memory only — the schema does not know the
  field, `forStorage` strips it, and nothing but a part's own live turn may
  ever send one back.

- **One traversal did not happen.** `forRequest` states the two rules once but
  delegates the bounds to `historyWindow` and `toolWindow` rather than folding
  them into one walk — equivalence with the old assembly holds by construction,
  with the spec's pinning test standing over it anyway, which is what made the
  first commit a zero-behaviour-change one. `firstRoundAt` and `ToolRound`
  accordingly survive inside `tool-window.ts`; the fold and their retirement
  land when the `Content`-based algorithm retires, not before. What did move:
  `spoken(parts)` is the single past-turn text projection — texts and event
  notes, blank-line joined — used by `forRequest` and `asHistory` both, with
  the consequence that interim text a turn emitted beside its calls, being
  stored, contributes to later history. That was already true for any reloaded
  client; the build standardized on the stored projection rather than
  special-casing the fresh session.

- **The table and the writes** — `ChatMessage` as designed, cascading off
  `Project`, indexed `[projectId, seq]`. The database was `db:push`-managed and
  had to be baselined first (`0_init`, resolved as applied) before the named
  migration. `seq` is a Postgres sequence on a non-id column, and one
  `createMany`'s row order carries into it — verified live — so
  `orchestrator.send` writing `[user, assistant]` in one `createMany` inside
  the mutation is the whole ordering story. `role` and `status` are strings,
  not enums: the values are the format's contract, checked by `messageSchema`
  on a read that never rejects a row, and only `sent` is ever actually stored.
  `RESULT_STORE_LIMIT` is 2,000 characters — a round's share of
  `TOOL_CHAR_BUDGET` — and `forStorage` also drops a text part that was only
  the carrier of a wire emission, which would otherwise draw an empty bubble on
  reload. Two things the design did not say: the assistant's stored parts end
  with the reply *as shown*, fallback sentences included, because the record is
  of what the user was told rather than of the raw final emission; and the page
  part `orchestrate` pens for the user's message is a positional placeholder —
  `orchestrator.send` writes the real pointers off the pages it validated
  against the project, so the store never keeps a pointer to a page that was
  not the project's own.

- **The client** — `chat-log.ts` holds `Message[]`, `discarded` is
  `discardedIn`'s fold over the stored event payloads, a retry targets an id,
  and the sidebar draws through `forDisplay`. Decided differently: hydration is
  guarded once per project per session by a module-level set rather than by
  query semantics — the sidebar remounts on every collapse, and the store is
  written through (`orchestrator.send` and `chat.record`), so a mid-session
  refetch could only put a stale snapshot under messages the session has since
  appended. And `chat.record` takes an optional attachment: the event part's
  `payload` carries the discard records the fold replays, but a hand-taken
  cut's *tile* is not an event — it rides as a proper attachment part, the same
  shape an assistant answer stores tiles in, or it would not survive the
  reload.

- **History off the wire** — the `history` input, its schema and
  `HISTORY_PAYLOAD_LIMIT` are gone; the router reads the last `CHAT_LIST_LIMIT`
  (200) rows *before* the turn runs, so the ask is not its own history.
  `runOrchestratorTurn` keeps its explicit parameter and `npm run smoke` is
  unchanged. Decided differently: the projection is `asHistory` in
  `conversation.ts` rather than router code — the sent-only filter, the
  `assistant`-to-`model` re-wording, `spoken` and `historyWindow`, the same
  parse and window the browser's hydration path uses, so the two ends cannot
  drift.

- **Gone-ness at load** — decided differently in shape: `chat.list` answers
  `{ messages, gone: { boardIds, referenceIds } }`, one bulk existence read
  over the subjects the stored attachment parts name (`subjectsIn`), and the
  client's `goneAtLoad` synthesizes discard records off the attachment
  snapshots, merged *under* the session's own event fold so a subject both name
  settles on the event's record. Attachments stay snapshots — a board's preview
  is what the assistant showed at the time — and after the delete the
  snapshot's title is the only place the name survives, so the synthesized
  record carries it. The false paragraph about expiring signed URLs went with
  the rewrite: `forDisplay` returns `/api/references/:id/image`, a stable path
  that re-signs per request.

**Amended 2026-08-23 — "stored per project" is no longer the whole rule.** A
project holds many conversations and a conversation can be emptied; §VII is the
design. Everything in this entry survives it unchanged except the owner of a
message: `ChatMessage.conversationId` replaces `projectId`, and the history the
turn reads back before it runs is the open thread's rather than the project's.

One seam is accepted rather than closed: a turn that settles faster than the
initial `chat.list` fetch can draw its pair twice, and an event whose
`chat.record` response is lost can do the same — both bounded to one session's
display until the next reload, neither observed.

### `crop_reference` files the cut — built

The tool ends at a **row** rather than at an offer. The turn that asks for a
crop is the turn the crop exists in: the cut is made on the server, filed as a
modified version of the frame, shown in the chat as the picture it now is, and
usable by id from the next round of that same turn.

This is what tech-spec §III.3 step 4 asked for from the start — a tool cuts the
box and writes the result to GCS, and that row id is the pointer the rest of the
system uses. The offer was never the answer to a design argument; it was the
answer to a missing capability. There was no image codec on the server, so the
browser's canvas was the only place in this app that could cut pixels (§II.6),
and a chat-driven crop had nowhere on the server to become a row. The codec
landed and the workaround retired with it.

**What it buys.**

- One turn instead of two and a human. Today the cut appears minutes later in
  another column, and the conversation only learns of it when `takenCutNote`
  rides up as history on the *next* message. A tool that files the row can name
  the id in the reply that announces it and hand it to `swap_on_board`,
  `compose_moodboard` or `put_on_canvas` on the next round — the same thing
  `generate_image` made true for a drawn picture.
- The board swap stops travelling. `forBoard` exists only because the tool could
  not make the swap and had to tell the browser to; a tool that holds the row
  makes it itself, so `crop_reference` with a `boardId` becomes one call that
  cuts *and* places. It is a scene write from then on, so it queues on
  `boardEdits` like every other one — which it does not today.
- The cut lands complete. A drawn picture leaves its row owing a grid-sized copy
  to `useDerivedReferenceCopies`; a codec that can cut can also downscale, so the
  thumbnail is made in the same pass rather than by whichever tab opens next. A
  cut already inside the box is filed without one and is complete all the same:
  `cutBytes` and `needsDerivedCopy` read the same `thumbnailBox` off the same two
  columns, so the sweep leaves such a row alone rather than fetching it back to
  copy something that is already thumbnail-sized. Both quality numbers the codec
  encodes with are the browser's own, multiplied by 100 for sharp:
  `CROP_JPEG_QUALITY` for the cut, and `THUMBNAIL_JPEG_QUALITY` for the copy —
  the second exported from `thumbnail.ts` for this, having been a bare `0.8`
  inside `renderThumbnail` until a second door needed it. The first is part of
  what `hashBytes` digests, so a door encoding at a number of its own files a
  second row of a cut the project already holds; the second is the weight of
  every tile drawn from it.

**What it costs, and this is the honest argument against it.** A cut nobody
wanted is the commonest thing agent 3 produces, and one now costs a row, its
bytes, its thumbnail, an analyzer job and the delete that follows — the exact
bill the offer was written to avoid. §V of `agent-tools.md` says declining costs
the call that was already made and nothing else, and that stops being true.

The answer is not to keep the offer but to make the undo cheap and **said**:

- `CROP_CALL_LIMIT` stays at 2. It now bounds rows and not only vision calls.
  Built: the constant's own comment argued the ceiling in terms of "offers
  nobody has looked at yet", which was the last falsified reason left in the
  declaration file, and it now names what the ceiling stands in front of — eight
  crops would be eight references, eight thumbnails and eight readings to
  discard one at a time. The bound is checked before the `AgentRun` row and not
  only before the vision call, which `the turn's ceiling bounds the rows it
  files, not only the frames it reads` pins: moving the guard below that
  `create` leaves `asked.length` at 2 and fails that test alone, since the three
  older ceiling tests count reads rather than rows.
- The `status` string says the cut is filed, that the frame it came out of is
  untouched, and that `discard_reference` is how it goes — so the reply offers
  the way out in the same sentence that announces the cut. The model must not
  say a cut was *offered*; the prose in `CROPPING` inverts with it.
- The attachment is the **cut**, not a box drawn on the frame. There are real
  bytes now, so `cropPreview`'s blow-up of the frame's thumbnail — an honest
  picture of a decision — is replaced by `attachmentOf` on the picture itself,
  which is what every other filed reference is shown by.

**Where the cut is made.** `makeCrop` reads the original out of GCS and cuts it
with a Node codec (`sharp`; nothing in the tree decodes an image today, which is
why `pngPixelSize` reads twenty-four header bytes rather than asking a library).
Only decode and encode are new: the arithmetic already exists as pure modules and
is shared verbatim with the browser's cut — `croppedPixels` turns the region's
fractions into the pixels of whatever copy is being cut, `cropOutputType` picks
the encoding, `CROP_JPEG_QUALITY` is the quality. The region crosses as fractions
for the reason it always did, and the server reads the *original* rather than a
thumbnail for the reason `cutFromOriginal` does.

**What lands** is exactly what `reference.addVersion` lands, written from the
tool rather than from the router: bytes in the bucket, a `Reference` row linked
to the frame by `sourceReferenceId`, `editIntent` / `editRationale` /`cropBox` /
`editAspect`, the title derived from the frame's, a thumbnail, and an analyzer
job in the same transaction with the worker kicked — `makePicture`'s ending, one
tool over. The turn's memoized `references()` is appended to the same way, which
is what makes the new id resolvable in the same turn.

**The nudge stays a second row.** `crop_reference` on a cut's id still asks the
*frame* with that cut's box attached (a box inside a box can only ever take less
of the photograph), and what it files is another version of the frame beside the
one it improves on, not a replacement of it. Two rows for "tighter" is the price
of not deleting a picture the user may have already put on a board; the answer
says which row is which and that the old one can be discarded. Replacing in place
is the obvious alternative and is deliberately not specified here — a cut on a
board is a cut something else is pointing at.

**What the properties panel keeps.** All of it. `planCrop` still answers the
panel with a plan, and Keep / Discard / Adjust still stand there: a user framing
a crop by hand is choosing a box and wants to see it before it is a row. What
goes is only the chat's half — the `crop-offer.ts` module store, the adoption
effect in `useCropReference`, `CropOffer.forBoard` and `cropPreview`'s use in the
chat. `cut-taken.ts` stays: a cut the user takes in the panel still has to tell
the conversation it exists.

**Open, and worth deciding before it is built.**

- Whether a cut the assistant filed unasked is marked as such in the gallery. A
  `sourceReferenceId` says it is a cut and the `AgentRun` row says who asked; a
  facet like `Generated`'s would let a user find and sweep them. Recommended, but
  it is a column and a filter rather than part of this change.
- ~~Reading a 12-megapixel original into the function~~ — **measured, and it
  fits.** Nothing bounds the original's size: uploads go browser → GCS against a
  signed URL precisely so a phone photo never crosses a function (infra §VII),
  so this is the first time those bytes come back into one — twice over at
  `CROP_CALL_LIMIT` — and the first server-side decode in the app. `cutBytes`
  against synthetic JPEG noise (the worst case a photograph of that size can be)
  on node 22, one cut at half each edge plus its thumbnail:

  | photograph | JPEG | one cut | RSS added | two cuts |
  | --- | --- | --- | --- | --- |
  | 3 MP (2000×1500) | 2 MB | 23 ms | 14 MB | — |
  | 12 MP (4000×3000) | 7 MB | 74 ms | 36 MB | — |
  | 48 MP (8000×6000) | 30 MB | 211 ms | 114 MB | 442 ms, 133 MB |
  | 108 MP (12000×9000) | 67 MB | 502 ms | 235 MB | 949 ms, 255 MB |

  Two cuts cost twice the time and barely more memory than one: sharp releases
  each decode before the next, so `CROP_CALL_LIMIT` bounds the clock rather than
  the ceiling. The worst case a phone or a full-frame body can hand this is the
  48 MP row, a third of the 1,769 MB a Vercel Node function gets by default and a
  sixth of the 2 GB fluid gets; even 108 MP — a stitched panorama, not a camera —
  clears it. The time is noise beside the cropper's own vision call. So the cut
  stays on Vercel and the Cloud Run half of the split (infra §II) is not needed
  for it. The download is the half the measurement does not cover — `readObject`
  buffers the whole object before decoding, so the 67 MB is resident twice for a
  moment on the largest row — and it is the half nothing bounds, because an
  upload goes browser → GCS against a signed URL and is never weighed on the way
  in. So it is bounded here: `CUT_SOURCE_BYTE_LIMIT` is 100 MB, half again the
  largest photograph the table measures, and `readObject` refuses past it off the
  object's recorded size before a byte is transferred. That comparison is asked as
  *fits* rather than as *is too large*, which is the whole of why it is a
  ceiling: a size the bucket did not record parses to NaN and every comparison
  with NaN is false, so it fails `size <= maxBytes` and would have passed
  `size > maxBytes` — asked the other way round, an unreadable size reads as an
  empty object and the download runs unbounded. `fitsInOneFunction` is that
  decision on its own, and `storage.test.mts` pins it: at the ceiling, past it,
  unrecorded, unparseable. Pixels were already bounded and by sharp rather than
  by us: 268402689 of them (16383²) unless told otherwise, which is the number
  the decode's memory follows.

  The other half of "the deploy target tolerates it" is that the binary ships.
  It does: `next build` passes with sharp a direct dependency, because sharp is
  on Next's own default `serverExternalPackages` list and so is required at
  runtime rather than bundled, and the lockfile already carried every platform's
  prebuilt binary from when sharp was `next`'s optional dependency — the linux
  x64 and musl ones an `npm ci` on the deploy target resolves included. Nothing
  in `next.config.ts` had to say anything about it.

**Built, and where it decided differently.** Both halves are in: the codec
(`src/server/references/cut.ts`), the shared filing function, the executor, the
swap and everything the model is told; and the removal of the chat's offer
machinery — `crop-offer.ts`'s module store, the adoption effect in
`useCropReference`, `CropOffer.forBoard`, `cropPreview` and `CropAttachment`, the
chat's crop tile and the `taken` map on `ChatLog` that settled it. `ChatAttachment`
is two kinds again, a picture and a board, and `AttachmentTarget` no longer
carries an offer.

Seven decisions the design did not make:

- **The filing is one function, not one router.** `reference.addVersion` no
  longer writes its own row: both doors call `fileVersion`
  (`src/server/references/file-version.ts`), which derives the title, the
  inherited origin, the trimmed intent and rationale, the box columns and the
  aspect, then creates the row and enqueues the analysis in the caller's
  transaction. It is overloaded on the select so the panel keeps reading back the
  whole row and the tool reads back only the columns the model is shown. The
  no-drift claim is checked directly rather than through either door:
  `file-version.test.mts` files the same version twice, once with each door's
  select, and asserts the two writes and the two analyzer jobs are equal — so a
  column that starts depending on which caller asked fails there rather than
  surfacing as two differently-named cuts of one frame in the versions list.
- **The codec is injected through a dynamic import, not a static one.**
  `cutRegion` defaults to `import("@/server/references/cut")` inside the call, on
  `kickAnalyzer`'s reasoning rather than `crop`'s: a static import would put
  `sharp` in the module graph of every test of the tool layer, which files rows
  without ever wanting to decode an image.
- **The cut is content-hashed like every other upload — and nothing reads it.**
  `hashBytes` is the new half of `content-hash.ts` — the same digest, off bytes
  already in hand rather than off a `File` the server never made. What it is
  *not* is a duplicate check: both hash lookups in the tree (`existingHashes`,
  and `importFromUrl`'s) are `ORIGINALS_ONLY`, deliberately and with the reason
  written beside the first — a user who exported a crop and dropped it back
  would have the drop skipped as "already in this project" while the gallery it
  names shows nothing. So a version's `contentHash` is write-only today, which
  makes it exactly the kind of column that can be wrong for a year without a
  symptom. Two things are pinned instead of the lookup: `content-hash.test.mts`
  hashes one cut both ways and asserts the digests match — the two doors file
  through one function precisely so nothing about a cut's row reads differently
  for who cut it — and `tools.test.mts`'s *the cut is filed under the digest of
  the cut, not of its copy* asserts the tool hashes the cut's own bytes rather
  than the thumbnail it stored a line earlier, which kills both the wrong-bytes
  and the dropped-column mutations. `content-hash.test.mts` also pins the trap
  under it — bytes off a codec are a *view* into a buffer larger than they are,
  so the digest is taken of the view and not of what backs it, or two identical
  crops read out of differently packed buffers come back as different images.
  Two comments were corrected to stop claiming the lookup: `tools.ts`'s beside
  the hash ("so the project recognises bytes it already holds whichever door
  filed them") and `content-hash.test.mts`'s ("would file the same crop twice").
- **`filePicture` had to split the turn's read, not grow it.** The fold that
  makes a row filed mid-turn visible to the rest of the turn was written for
  `generate_image`, which files a photograph; `crop_reference` files a *version*,
  and the two differ in the two places the fold touches. `photos` is recomputed
  off `source`, so a cut is counted as a cut in `projectState` and stays out of
  `catalogBrief` and out of `list_references` with `includeCrops: false` — folded
  in as a photograph it would be listed beside the frame it was cut out of, in
  the list a compose is composed from. And the row goes into `frames` as well,
  which is where a nudge of that cut in the same turn reads the frame's `gcsUri`
  and box. Neither clause had a test: mutation-verified, `photos: withIt` and a
  `frames` map left unset each fail exactly the one new test in
  `tools.test.mts` and nothing else in 1835.
- **The fold's chaining is only observable in a round with two crops in it.** The
  clause of `filePicture` that says *chained onto the promise rather than computed
  off its value* is the one a round of parallel tool calls tests: both crops start
  from the list as it was before either filed, so a fold built off that snapshot
  has the second cut overwrite the first and the turn answers with an id it no
  longer holds. Every crop test written before this one was sequential, and a
  sequential turn cannot tell the two implementations apart. Pinned by `two crops
  in one round are both in the turn the round after them` in `tools.test.mts` —
  two crops under one `Promise.all`, then `state()`, `list_references` and a
  `put_on_canvas` naming both cuts, on one `reference.findMany`. Sole killer of a
  `makeCrop` that folds off the `references()` snapshot it took at its top
  (1 failure of 1845); note that the *timing* mutation — assigning `loaded`
  asynchronously after the fold resolves — kills nothing, because the digest
  between `storeImage` and the fold desynchronises the two calls past the one
  microtask that window is wide.
- **The panel's cut is announced to the chat unconditionally.** `announceCutTaken`
  used to fire only for a proposal carrying `fromChat`, on the argument that a box
  asked for in the panel is answered by the panel. With the chat's offers gone
  that flag is never set, so the whole `cut-taken` path would have been dead code
  — and the argument inverts: the assistant now knows about every cut *it* filed,
  so the only cut it can be ignorant of is exactly the one framed by hand.
  `TakenCut` lost `cropBox` (it keyed the offer tile the cut settled) and `board`
  (the panel no longer makes a swap), and the note reads as the user's own
  sentence rather than as taking something up.
- **The board swap goes through `swap_on_board`'s own executor.** `makeCrop`
  calls `swapPictures` with a one-item swap rather than reaching for the lib
  under it, so the revision guard, the page scoping and the loose-fit report come
  free — and a board that refuses the write is reported as `notPutOnBoard` beside
  a cut that is filed either way, rather than as a throw. `crop_reference` is
  queued on `boardEdits` from now on; a crop naming no board takes the empty key
  and still runs beside another crop. A refused swap leaves the run **SUCCEEDED**
  and attaches the cut alone: what the tool was asked for is a cut, the board is
  the half that did not land, and a board tile beside a sentence saying the board
  did not change would show the user the opposite of what they were told.
- **`moodboard.swapReference` went with the offer.** The mutation was the
  browser's end of that swap: the panel called it the moment a `forBoard` offer
  was kept, so the loop closed without a second turn of routing. Nothing calls it
  once the tool makes the swap itself, and a hundred lines of revision-guarded
  scene write reachable by no door is a second swap waiting to drift from the one
  in use — so it is deleted rather than left as an unused surface. The panel's
  own crop flow is untouched by that: keeping a hand-framed cut never made a
  board swap, only a chat-adopted one did.
- **`agent-tools.md` §III is the same change read from the chat's end, and now
  says so.** That section is the account of how a result reaches the chat, and it
  still had `crop` as a third `ChatAttachment` kind carrying a whole `CropOffer`,
  `cropPreview`'s blow-up of the frame's thumbnail as how a cut is drawn,
  `cut-taken`'s note gated on the chat having offered the box, and the board swap
  made by the browser through `moodboard.swapReference` — a union that no longer
  compiles, described to a reader arriving there to learn what the chat can draw.
  Rewritten as current truth: a cut arrives as `attachmentOf(<the cut>)` like any
  other picture, every kept cut is announced rather than only the chat's own, and
  the swap is the tool's. The offer tile survives as the paragraph explaining why
  there is no crop kind, because "there was no row to point at" is the reason the
  kind existed and the reason it is gone.
- **"There is no server-side image pipeline in this app" was an invariant five
  comments stated as present tense.** It was true of every line of this tree
  until `sharp` landed, and it was load-bearing wherever it appeared: it is why
  `cut-reference.ts` said it is where *every* crop is made, why `board-crop.ts`
  said agent 3's cut is made with the same canvas, why `planCrop` said it stops
  at a plan "because the cut cannot happen here", and why `thumbnail.ts` and
  `reference-derived.ts` explained a browser-made grid copy by there being
  nowhere else to make one. All five are now written as what they are — the
  browser cuts the crops the *user* draws, the panel stops at a plan by choice
  because a user framing a box wants to see it first, and an upload never
  *needed* a codec on the server rather than there not being one. The two nearby
  "the server has no canvas to draw them on" readings of why a web import owes a
  thumbnail are re-pointed the same way: that path derives nothing, which is now
  a wiring fact rather than an impossibility. `reference-derived.ts`'s own list
  of who owes a grid-sized copy gains the cut, which owes none — the frame has to
  be decoded to cut it, so the resize is one more step in a pass already paid
  for.
  A third pass found two sites the file-scoped sweep had missed and one the
  sweep could not have reached: `reference.attachDerived`'s comment still said a
  web import lands thumbnail-less because "a server has no canvas", and
  `moodboard.md` said the same of the same path and explained the board's own
  crop by the browser being "the only place in this app with a canvas". The
  canvas crop still runs in the browser and should — the bytes are decoded
  there, in front of the user who framed the box, and the server's codec would
  answer a canvas gesture with a round trip that reads the original back to
  produce bytes the browser is already holding — but that is a reason now rather
  than the absence of an alternative.
- **What "a cut lands complete" means was asserted by comment and not by test.**
  Two tests held the halves — the thumbnail is stored beside the cut, and a cut
  already inside the box is filed without one — while the claim that matters is
  about a *different* module: `useDerivedReferenceCopies` sweeps the project for
  rows owing a grid-sized copy, and a cut is the one chat-written row never in
  that set. `a filed cut is not swept for a derived copy and a drawn picture is`
  runs both crops and a `generate_image` through the real executors, shapes each
  filed row with `forDisplay` — `hasThumbnail` is what the browser is answered
  with, `thumbGcsUri` is what the tool writes, and the two claims are one claim
  only through that mapping — and asserts `referencesOwedCopies` returns the
  drawn picture alone. It is the sole killer of a `makeCrop` that stores the
  thumbnail and files a row that does not point at it: 1 failure of 1844.

- **A photograph too large to read back is its own sentence.** The ceiling above
  is a failure like the others — said, not thrown — but it is the only one that
  will be just as true on the second call, so the answer names the size as the
  reason and tells the model not to ask for a cut of that picture again; the
  other cut `CROP_CALL_LIMIT` allows would otherwise be spent rediscovering it.
  The condition travels as `ObjectTooLargeError` and is read back by *name*
  rather than by `instanceof`: the class the tool compares against and the class
  the read threw are one only while both hold one instance of `storage.ts`, which
  an `.mts` test reaching it as ESM beside the app's own CJS graph does not — so
  the branch would be false in exactly the test that exercises it.

- **What the model is told is pinned rather than reviewed.** "Nothing the model
  is told, and nothing the instruction tells it to say, still describes an offer"
  was the one requirement of this change with no test behind it: `CROPPING`,
  `CROPPING_FOR_A_BOARD` and `crop_reference`'s own description are prose that
  nothing compiles against, so the whole of what kept them true was somebody
  having read them. Four tests now hold them — two in `orchestrator.test.mts` on
  the instruction's two halves, two in `agent-tools.test.mts` on the declaration
  and on its `boardId`/`pageId` descriptions — each asserting the new claim (the
  cut is *filed*, the frame is untouched, `discard_reference` is the way out, the
  id is good for the next round of this turn, the swap is made *in this call*)
  and refusing the exact sentence it replaced. Restoring any one of the four
  strings to its wording on `main` fails exactly one of the four and nothing else
  in the 1841-test suite. Two of them are worth the assertion precisely because
  they read as current on either wording: "do not call swap_on_board afterwards"
  was already there, and only its reason inverted — the swap used to follow the
  user accepting the cut.

- **The fifth rewritten string, and the one nothing read.** `LOOSE_IN_SLOT_NOTE`
  is the whole of what the orchestrator is told about a picture sitting loosely
  in its slot, and the change rewrote every clause of it — but it lives in
  `slot-fit.ts`, a layout module, so the four tests above did not reach it and
  `slot-fit.test.mts` had never imported it. What held it was one `/Ask the user
  first/` match on a tool result two files away, which passes on a paraphrase.
  Two tests in `slot-fit.test.mts` now hold it: the cut is made and swapped in
  the one call, `swap_on_board` must not follow *because the swap is already
  made*, and asking first is owed because a cut is a row to discard rather than
  an offer to decline — against the four sentences it replaced ("offer the user
  a crop_reference", "takes the picture's place there the moment they accept
  it", "Say that taking the cut is all it needs", "a cut nobody wanted is a row
  they have to delete"). Restoring the note to its wording on `main` fails both,
  and the one older assertion that was a partial detector.
- **The queue has two halves and only one of them was held.** Queueing
  `crop_reference` on `boardEdits` is proved by `two crops for one board in a
  round both land, in turn`, which reads the revision guards off two writes that
  landed 3 then 4. Nothing held the other half — that a crop naming *no* board
  takes the empty key and therefore runs beside another crop. `boardEdits.run`
  with a constant fallback key (`boardKey(args) || "crop"`) serialises every
  round of crops, doubles the wall clock of the most expensive round this tool
  has, and passed all 1845 tests: the parallel round iteration 21 added asserts
  what both cuts *left behind*, which is the same either way. `two crops for no
  board read their frames at the same time` counts readers inside the injected
  `crop` — each waits until the other has arrived, with a timer so a serialised
  round fails on the count rather than hanging — and is the sole killer of that
  mutation.
- **Both numbers the codec encodes with were argued for and asserted by
  nobody.** "The quality is the browser's own, multiplied for sharp" is the
  claim two comments make and the reason `THUMBNAIL_JPEG_QUALITY` was exported
  from `thumbnail.ts` at all, and `cut.test.mts` read only the *shape* of what
  came out — dimensions, format, and the copy being smaller than the cut. So
  encoding at sharp's default 80 instead of `CROP_JPEG_QUALITY`'s 92 passed all
  1846 tests while filing a cut whose digest no other door can reproduce, which
  is the one consequence of this number that outlives its weight. Two tests hold
  the encodes byte-for-byte against sharp at the constant's own value, and
  against a quality of its own: dropping the cut's number and giving the copy
  the cut's number each fail exactly one of them (1 of 1849).
- **The sixth rewritten string, and the only one the *user* says.**
  `takenCutNote` is the sentence a cut kept in the properties panel rides into
  the conversation on, and its opening clause on `main` was "Took the cut you
  offered". After this change nothing is offered in the chat, so every cut
  reaching that note is one the user framed by hand — the clause is not merely
  stale, it credits the assistant with a cut it never made and invites it to
  answer the next ask as though `crop_reference` had already run. It reads
  "I cropped this myself" now. Nine tests in `cut-taken.test.mts` cover this note
  and not one of them touched that clause: the ids, the title, what the cut
  keeps and the shape it was held to are word-for-word the same on both sides of
  the change, so restoring the whole sentence passed all 1849 tests. Two tests
  hold it — the claim on both branches of its ternary, and the exact superseded
  sentence refused — and reverting either branch fails both and nothing else.
  The negative test also refuses "no swap left to make", the clause the offer's
  `forBoard` carried: the panel's door files a row and writes no scene, so a
  note claiming a board changed would send the model to report an edit that
  never happened.
- **The copy is of the cut, and every earlier assertion about it passed on a
  copy of the frame.** `thumbnailBox` is asked of the *cut's* dimensions, so a
  resize that reads `source` rather than the cut's bytes produces a copy of the
  right size, the right format and the right max edge — the whole of what `makes
  the grid-sized copy in the same pass` checks — showing the gallery a tile of
  the photograph the user asked to be cut down. `the grid copy is a copy of the
  cut and not of the frame` cuts a half-green half-red frame and reads the copy's
  own pixels, both ways round; it and the quality test above are the only two
  failures that mutation causes.
- **Six clauses of the answer itself still read as an offer under a green
  suite.** The five prose sweeps above went after named constants — instruction
  sections, tool descriptions, exported notes — and none of them reached the
  strings `makeCrop` builds inline in its own `return`. Those had tests, which is
  why they looked covered: `notOnThatBoard` was matched on the board's title and
  on `a page away`, `nudgeOf` on `cut-1 is untouched` and `discard`, `status` on
  `cut and filed` and `put on “Ridge”`. Every one of those substrings is on both
  sides of the change. What moved is the clause beside them, and all six survived
  mutation — `so this cut will not be put on it` restored to both branches of
  `notOnThatBoard` (the sentence §3 of the spec exists to replace), `offered as a
  second cut` and `taking it leaves the old one … to delete` restored to
  `nudgeOf`, and the frame-is-untouched clause deleted from either branch of
  `status` along with the board branch's `discard_reference on <id>` — with 1851
  of 1851 passing. Three of those are requirements stated in the spec in so many
  words. Seven assertions across the four existing tests now hold them, each the
  sole killer of its mutation; the two `notOnThatBoard` tests also refuse the
  exact superseded clause, since a paraphrase of *filed* would pass on wording
  that still promises a future the tool no longer has.
- **The decode's own orientation flag was held by nothing.** `autoOrient: true`
  on the sharp constructor is what makes the region mean the same frame
  `createImageBitmap` measured, and the existing test for it — orientation 6,
  a 400x200 grid that displays as 200x400 — asserts only that the cut comes out
  200x200. It does, either way: the box is computed off `metadata.autoOrient`,
  which reports the upright size whether or not the pixels are being rotated, so
  dropping the flag passed all 1851 tests while cutting a quarter turn of the
  photograph nobody looked at. `a rotated photograph is cut upright, not out of
  its stored grid` reads the marked corner instead of the size — orientation 6
  puts the stored top-left corner at the displayed *top right* — and is the sole
  killer of that mutation (1 of 1852). The other survivor of the same sweep,
  `readObject(gcsUri)` without `CUT_SOURCE_BYTE_LIMIT`, needs no test: `maxBytes`
  is a required parameter, so the compiler refuses it.
- **Which bytes are cut, and what the bucket is told they are, were both
  unheld.** A sweep of the filing path's arguments left four survivors of 1854.
  Three are real. `cutRegion(named.gcsUri, …)` — the row the *model* named rather
  than the frame — passes every test in the suite, including the nudge test whose
  own comment says "the frame's bytes, not the cut's": that assertion is about
  the vision call, and the cut is a second call nobody was watching. On a nudge
  the two ids differ, the region is a fraction *of the frame*, and cutting the
  named row takes that fraction out of a picture that is already a piece of it —
  the crop of a crop `cropNudge` exists to refuse, arrived at silently. The nudge
  test now asserts the uri the codec was handed. `storeImage("image/jpeg", …)`
  for the cut, and the cut's own type for the grid copy, both passed too: the
  `cutting` fake answered `image/jpeg` for everything, so no test could tell a
  carried content type from a constant. It takes one now, and `a PNG cut is
  stored as a PNG and its grid copy as the JPEG it is` is the sole killer of
  both — the type is recorded only at this call, and a mislabelled object is
  served under the label.
- **A crop that names a board must not also report the boards it left alone.**
  Dropping the `!boardId` guard on the standing-boards read passed 1854 tests.
  What it produces is a contradiction: `standingOnNote` opens *this cut is filed
  and no board was changed*, which stops being true the moment the swap in the
  same answer lands — and it is only visible when a *second* board is standing on
  the frame, which no existing test had, since the named board loses the frame to
  the swap before the read happens. It is a bill as well as a sentence: the note
  is built from every board's `elements`, the one column priming refuses. `a crop
  that names a board says nothing about the boards it left alone` holds both, on
  two boards and one `boardId` (1 failure of 1854).
- **The caption survived the tile it was drawn under, and nothing held it
  there.** Deleting `size: cropOfferCaption(cut, frame)` from the answer passed
  all 1854 tests. It was two readers before this change — the crop tile under the
  offer and this key — and the tile is gone, so how much of the frame the box
  keeps and how big that is in pixels now reach the model here or reach nobody.
  `cropOfferCaption`'s own unit tests are about the string it builds, not about
  anyone asking for it. `the answer says what the cut keeps, since nothing draws
  it any more` pins the three readings off a 4000 × 3000 frame and refuses them
  anywhere else in the answer (1 failure of 1855). The same sweep found `keeps`
  and `why` unasserted too — both byte-identical on `main`, so they are a ledger
  gap of the tool rather than of this change, beside `nudgeOf` on the run output.

Every way the new ending can fail is a sentence and a FAILED run carrying the
vision call's tokens — the picture could not be cut, the cut could not be stored,
the row would not write — and all three are now covered by their own test. The
store failure is forced on the *thumbnail* rather than on the cut, because that
is the half that leaves an object in the bucket with nothing pointing at it, and
it is still no cut: a row naming a thumbnail nothing wrote is a tile that never
draws, which is the more expensive of the two ways to be wrong.

The answer's shape changed with it: `referenceId` is now the *cut*, `cutOf` is
the frame, and the `AgentRun` output carries both. `cropCeilingSaid` counts cuts
**filed** rather than offered, and the `swap_on_board` advice in
`standingOnNote` and `LOOSE_IN_SLOT_NOTE` inverts — the cut is a row now, so the
swap the model used to be steered away from is the right call.

### `crop_reference` becomes `edit_reference` — built

**Designed and built 2026-09-01.** The cropper was never only a cropper: it is a
box reader, a model that answers with four numbers while `sharp` does the pixels.
The widening keeps that invariant exactly and changes only what the numbers are —
an ordered list of edits rather than one box.

`crop_reference` → `edit_reference`, `crop_image` → `edit_image`, and the module
moved to `src/server/agents/image-editor/` behind the door `editReference`. The
rename is the point rather than tidiness: the tool description is the only place
the orchestrator learns the capability exists, and a tool called `crop_reference`
that also grades is a lie that costs recall on exactly the turns the feature is
for. `intention` keeps its **name** — every call site, run-row `input` key and
test string survives — and widens its description to carry the whole ask ("the
sign, warmer", "it's on its side"). `aspect` is unchanged and still about the
crop's shape alone.

**No `ops` parameter, deliberately.** The orchestrator says what the user wants in
words; the editor decides the ops against the pixels. Leaking op parameters upward
would put a model that cannot see the picture in charge of how warm the picture
should be.

**One model call, not a function-calling loop.** Flip and turn are fully
determined by the words, so a tool round per op would buy a vision read to compute
`.flop()`. Grading is parametric through sharp rather than generative.

**Where the build decided differently from the design.**

- **The grade earns a second look; nothing else does.** The design said the agent
  looks again after grading. The build made that conditional in code rather than
  in the prompt: `EDIT_LOOKS = 2` looks run only when the accepted list contains a
  grade, and a revision that *drops* the grade ends the loop rather than spending
  the second look on a list with nothing left to judge. The median edit is
  therefore exactly one model call — the same as a crop today.
- **The preview is `inlineData`, never a filed object.** Storing the intermediate
  would put bytes in the bucket the user may never see and would need reaping.
  `redactedPart` already elides base64 from the transcript, so a preview does not
  blow a `.jsonl` up. `previewFromOriginal` memoises one `readObject`, so two looks
  cost one GCS read.
- **The loop fails open.** No previewer wired, source too large, decode failed —
  the planned ops stand and `looks` is 0. A verification that cannot run must never
  lose the crop the user asked for. A fault *on a look* is swallowed too: we
  already hold a validated, usable edit, and arguing about a grade is not worth
  another paid read. A fault in the planning pass is still re-prompted and still
  costs an attempt, exactly as before.
- **The crop is not re-openable, enforced in code.** A revised list's crop op is
  discarded and the planned one re-inserted at the head. Re-opening it would
  invalidate the preview the model just judged.
- **The panel stays crop-only by construction.** `planCrop` passes
  `only: "crop"` and no previewer, so the response schema's `op` enum is `["crop"]`,
  the non-crop fields are not in the schema at all, and the instruction carries no
  grade vocabulary. Two independent guards, and the panel's cost is exactly today's.
- **`EDIT_CALL_LIMIT` stays at 12.** The ceiling counts *tool calls* — how many new
  references a turn may spawn, a product limit — not model calls. Worst-case spend
  per turn rises from 36 to 60 flash reads; the median is unchanged.
  `cropCeilingSaid` became `editCeilingSaid` and now counts edits rather than cuts.
- **`cropOffer` gained two changes rather than one.** It must stop refusing a
  whole-frame box when the list does other work — `cropPlan` returning null used to
  mean "the whole frame is the shot" unconditionally — and the aspect fit inverts
  the ratio on a quarter turn, because a 16:9 cut turned right arrives 9:16.
- **The overlay widened from a box to a mark.** The three byte-identical overlay
  blocks became one `edit-overlay.tsx`. A crop draws today's dimmed rectangle; ops
  without a crop draw a full-frame ring and a chip saying what was done; `[]` draws
  nothing. Without this, hovering "Flipped horizontally" would highlight nothing and
  read as a dead hover.
- **The executor's answer gained one key, `did`** — the ops as a sentence, from a
  pure `edit-said.ts` — so the orchestrator can tell the user what happened without
  re-deriving it from the offer.

**Known gaps this did not close.** `cropSizeLabel`, `cropShapeMeasured` and
`cropSoftOnBoard` read the un-turned box against the frame and will print swapped
dimensions in `size` after a quarter turn; the fix is to caption from the measured
`Cut` rather than from the box. And agent edits still collapse to depth 2 while the
UI path does not, so the two continue to disagree about the shape of the version
tree — this change stops the *storage* from being the reason stacking is
impossible; it does not reconcile the tree.

### `generate_image` — built and promoted

The twenty-second tool — the `IMAGE` model (`gemini-3-pro-image`, confirmed
live, infra §X) as an orchestrator tool, and the only one that makes a picture
rather than reading, cutting or arranging one. The contract as built is §III's
*Generation* entry; tech-spec §III.7 is the agent-level view; entry 13 of
`agent-tools.md` §II is the arrival note. What follows is what the build decided
differently from the design that used to stand here, step by step —

- Schema and generator module — `origin`/`generationPrompt`/`IMAGE_GENERATOR`
  in the schema, `importFromUrl` writing `IMPORTED`, and
  `src/server/agents/image-generator/image-generator.ts` with `inlineDataOf` beside `textOf`.
  Decided differently: the API *does* take a native aspect
  (`generationConfig.imageConfig.aspectRatio`, verified live), so the module
  passes the nearest of the ten native canvases and folds into the prompt only
  what a canvas cannot say — an exact non-native ratio, or a loose word no
  canvas represents. The generator also takes a pre-parsed `ShapeAsked` rather
  than the raw string, so the executor owns the dialect and its refusal
  sentence the way `makeCrop` does.
- The declaration — `GENERATE_CALL_LIMIT = 2`, args `description` (required)
  and `aspect`, in `orchestratorTools` for **every** shape including the empty
  project, which retires §II's "empty project → zero declarations" line.
  Decided differently: it is `generateImageFor(state)`, not a constant. Ungated
  is about the *list*; the prose still varies, because the house rule that no
  declaration may name a tool this project was not given applies to it too —
  the id's next door is `put_on_canvas` with boards, `compose_moodboard` with
  pictures and neither on the empty project, and `crop_reference`'s dialect is
  named as that tool's only where that tool is declared.

- The executor — `makePicture` in `src/server/agents/orchestrator/tools.ts`, following
  `makeCrop`: the dialect read and refused here, the per-turn counter against
  `GENERATE_CALL_LIMIT` taken before the call, an `IMAGE_GENERATOR` run row
  spent on success *and* on refusal, then `importFromUrl`'s ending — bucket,
  row (`origin: GENERATED`, `generationPrompt`, a title off the description's
  opening clause, width/height off the PNG's own IHDR bytes), analyzer job in
  the same transaction, worker kicked. Unqueued on `boardEdits`: it writes no
  scene. Decided differently: three things had to become injected parameters
  rather than imports — `generate`, `storeImage` (GCS, like `copyRender`) and
  `kickAnalyzer`. The last one because `analysis-queue.ts` binds the real
  database and the real analyzer at *import* time, so a test of `tools.ts`
  would open a connection pool to file a job it already has a client for;
  `enqueueAnalysis` itself moved to a leaf module (`analysis-enqueue.ts`, re-
  exported from the queue) so the transaction can reach it without that. The
  turn's memoized `references()` is appended to rather than re-read, chained
  onto the promise so two generations in one round cannot drop each other —
  that is what makes `put_on_canvas` resolve the new id in the same turn, and
  what makes the empty project's declarations grow on the next round. The
  answer also measures what came back: an exact ratio the API has no canvas for
  rode the prompt, so a picture that did not arrive at it says so (`drawnAt`)
  rather than letting the reply quote the argument back.

- The instruction prose — `LIMITS` rewritten so the model is told it cannot
  fetch or search for a picture or change one it was given, that drawing a new
  one is the exception and the only one, and (unchanged) that it must never
  invent an image URL or describe a picture it has not been given; plus a
  `GENERATING` section saying what the tool is for, that the id is usable from
  the next round of the same turn, that the shape is worth passing, and that the
  reply must say the picture was made rather than found. Decided differently:
  `GENERATING` is the only section in the file gated on nothing — it stands on
  the empty project, because the declaration does — and it names no other tool,
  so the gating house rule never bites it; the one part that *is* gated is the
  sentence about preferring a photograph of theirs, which is about pictures the
  empty project does not have. `NOTHING_UPLOADED` gained a clause for the same
  reason: it used to say every reference comes from an upload, which the tool
  makes untrue.

- The client seam — `reference-sidebar.tsx`'s `onAnswered` now invalidates
  `reference.listByProject` whenever the turn's attachments hold a reference,
  before the board work it already did, so a picture drawn mid-turn is in the
  grid and the strip without a reload. Keyed off the attachment kind rather
  than off which tool ran: the chat is told what a turn produced, not how, and
  a crop the user takes files a row the same way. The gallery facet is
  `generatedOnly` on `ReferenceFilter` with `origin` on `FilterableReference`
  (optional — a row that never said where it came from reads as a photograph
  rather than disappearing), a `Generated` control in `sidebar-references.tsx`
  offered only where the project holds one, a `✦` corner mark on the strip's
  tiles and a `Generated` pill on the gallery's, titled with the description
  the picture was drawn from. `listByProject` needed no change: it selects no
  columns, so `origin` and `generationPrompt` were already on the wire.
  Decided differently: `origin` threads all the way to the *model* as well.
  `TOOL_REFERENCE_SELECT` reads the column, `ToolReference` carries it and a
  digest of a drawn picture carries `made: true`, which prints as a
  `generated` mark on its catalog line beside `starred` and adds one sentence
  to a project that has one. Without it the instruction to prefer a picture
  the user already has is unactionable — the catalog reads a backdrop the
  model drew an hour ago as a photograph they shot. Present-only, so a project
  with nothing generated pays nothing — `npm run floor` after this step returns
  1,313 / 3,041 / 3,204 / 11,925, every number identical to the prose step's.

- The price — `MODEL_PRICES` gained `gemini-3-pro-image`, $2/M in and $120/M
  out, read off Vertex's published table at build rather than guessed, so a
  generate row prices like any other row and the design's "runs price as `—`
  until one is added" no longer holds. Decided differently: the design assumed
  one output rate and the model has two — $12/M for the text and the thinking,
  $120/M for the picture — while an `AgentRun` row keeps a single
  `outputTokens` number. The picture rate prices all of it. A generation is
  roughly 1,120 image tokens against 370 thought tokens, so a run reads about a
  quarter dearer than the invoice ($0.18 against $0.14 on the test call).
  Deliberate: the alternative is a modality column on every run row, and the
  one tool here that can spend a fifth of a dollar in a call is the wrong one to
  make read cheap. The floors are untouched by this step — pricing is read off
  rows, not sent to the model.

- The end-to-end run — the whole path taken live once it was all in, through
  `npm run smoke` on an *empty* project ("Draw me a soft teal-to-charcoal
  gradient backdrop at 16:9, then put it on a moodboard"). Two rounds, four
  model calls, 81 seconds, $0.23: `generate_image` (10 in, 1,439 out, $0.17)
  answered a 1376×768 PNG at the native 16:9 canvas, the row landed
  `GENERATED` with its `generationPrompt` and its IHDR size, and the *second*
  round was offered `compose_moodboard` — the declarations really do grow
  inside the turn that files the first picture, which until then was only a
  claim the fakes could make. The analyzer job filed in the same transaction
  drained clean on the drawn PNG (2,153 in, 440 out, $0.0096), so a made
  picture reads like a shot one. The one error printed was
  `kickAnalyzerWorker`'s own — `after` throws outside a request scope, which is
  what a command-line harness is, and it is caught and reported by design.

- What the live run found — a drawn picture had no *thumbnail*, and nothing
  was ever going to give it one. A tool-filed reference is in exactly the
  position `importFromUrl`'s row is (`reference-derived.ts`'s own header
  describes it): bytes on the server, no browser in the loop, so no grid-sized
  copy — and the only caller of `deriveReferenceCopies` was the board's web
  import. A picture the assistant drew and the user never dragged onto a
  canvas would stream its full-resolution original into every tile of the strip
  and the grid, forever. Fixed on the same seam as the invalidation:
  `onAnswered` reads the rows the turn wrote back out of the freshly
  invalidated list and derives a copy for each one that `needsDerivedCopy`
  says is owed one, serially, failures left where they fall. The selector was
  `filedReferencesOwedCopies` in `reference-derived.ts` — ids and rows, not
  attachments — with its own tests; it is why the fix also covers a crop a tool
  filed, which was in the same position and nobody had noticed. It ran at one
  moment only, which is the gap the bullet below closes.

- The last throw — `db.$transaction` was the one call in `makePicture` outside a
  `try`, so a row that would not write left the tool throwing at `runSafely`
  instead of answering §I's `{result: {error}}`, and left the `IMAGE_GENERATOR`
  row at `RUNNING` with the generation's tokens on nothing. It now takes the
  same `fail` path the bucket does, with the spend, and the sentence says the
  picture is not in the project rather than describing one that is not there.
  The success `agentRun.update` is deliberately left bare: every executor in the
  file ends that way, and there the row is already filed and the user already
  has the picture — a stale run row is the cheaper wrong.

- The prompt had nowhere to be read — `generationPrompt`'s own schema comment
  says the properties panel can say what asked for a picture, and it could not:
  the description was reachable only as the `title` attribute of the gallery
  pill, which is a hover on a desktop and nothing at all on a touch screen. The
  panel now carries a **Drawn from** section, off the step it is already showing
  rather than off a query: `TrailStep` gained an optional `generationPrompt` and
  `trailGenerationPrompt` (trimmed, null on a blank, for `trailLabel`'s reason),
  and the strip hands the panel the whole `listByProject` row already. No server
  change — the column has been on the wire since the migration. A version step
  carries none, which is right: nobody drew a cut from words.

- **Two of the three panels never said it.** The section above landed in the
  sidebar panel, which is one of the three surfaces `ReferenceProperties` stands
  on, and the argument for it — the reading below is minutes behind on the one
  picture whose subject was written down before it existed — is not the sidebar's
  argument, it is the section's. The full-size viewer and the board's inspector
  showed the same "not analyzed yet" with the words sitting in the row. The
  markup is now a `DrawnFrom` component and the rule under it is `drawnFromSaid`
  in `generated-image.ts`, where the other two rules about a drawn picture live;
  `trailGenerationPrompt` is gone, since a viewer that has never heard of a trail
  should not be calling it. The viewer is handed whole `listByProject` rows and
  needed only the field on `LightboxReference`; the inspector reads
  `reference.summary`, a hand-written select that had never taken the column, so
  it is the same defect iteration 27 found in `reference.versions` one read
  along — the two reads in this app that name their columns are the two that go
  stale when one is added. Measured on the pinned sample before and after in one
  session: 1,382 / 3,191 / 3,354 / 12,075, unmoved, and it could not be
  otherwise — nothing here is text the model is sent.

- `origin` stopped at the frame — every reference row written by a *cut* took
  the column's `UPLOADED` default, whatever it was cut out of, so a crop of a
  drawn backdrop or of a web import claimed the user had shot it. The same
  argument that put the mark on the model's catalog line applies one level down:
  the facet, the badge and the catalog all read a row, so a cut has to carry the
  answer rather than have it inferred from `sourceReferenceId`. `versionOrigin`
  in `reference-version.ts` is the rule (inherit; an absent column claims
  nothing, so its cut claims nothing) and `addVersion`'s create is the one
  caller. `generationPrompt` is deliberately *not* inherited — the cut was not
  asked for in words, and the trail already leads to the step that was. The
  catalog's one sentence about the mark now reads "drawn by you earlier in this
  project, *or cut out of one that was*", since a marked line is no longer
  always a whole picture from one call; it is said only to a project holding a
  drawn picture, so the four floors are unmoved (1,313 / 3,041 / 3,204 / 11,925,
  re-measured against the pinned sample project).

- The prompt had nowhere to be read, from the *model's* side either — the same
  schema comment promises "a later variant can be asked from it", and nothing
  could. `historyWindow` sends `{role, text}` and drops tool calls on purpose
  (its own header: "the model's own tool calls put them there"), so the
  description survives one turn in the model's memory and then only on the row.
  A user saying "make that texture again, but bluer" the next morning was
  answered off a 60-character title and a `made` mark. `read_references` is the
  door it belongs behind — the one tool that answers about a *named* picture
  rather than about the list — so `TOOL_REFERENCE_SELECT` reads the column,
  `drawnFrom` in `agent-tools.ts` trims it (blank reads as absent, and it is read
  off the column rather than off `origin` because an inherited cut is marked and
  has nothing to quote), and the answer carries it two ways: on a `read[]` line
  beside the analysis, and on a `notRead` line *instead* of one. The second is
  the point — a drawing filed this turn has no analysis for minutes and its
  description from the first second, so it is the one unread picture that can
  still say what it shows. `notReadNote` carves the exception into the sentence
  that forbids describing the rest, and a `drawnFromNote` appears only when the
  answer holds one.

- `made` was being dropped in the same function — `referenceProperties` rebuilds
  its answer by picking fields off `referenceDigest` one at a time, and the mark
  added in the client step was never added to that list, so a picture the
  assistant drew read back as a photograph the moment it was looked at closely.
  A type that says `Omit<ReferenceDigest, "tags" | "unread">` was carrying the
  field and the implementation was not: a pick-list beside a subtractive type is
  a gap the compiler cannot see, and the only other field it could happen to is
  `croppedFrom`, which is picked.

- The declaration paid for it. `read_references` gained one sentence naming
  `generate_image` — safe by construction, since that is the one declaration
  every project has, and the house-rule test forbidding a description from
  naming a tool the project lacks is what made the ungated list load-bearing
  here. Measured against the pinned sample: `read_references` 174 → **219**
  (+45), floors 1,313 / 3,041 / 3,204 / 11,925 → **1,313 / 3,086 / 3,249 /
  11,970**. The empty project is unmoved because it is not given the tool at
  all — the one shape that can call `generate_image` and cannot read back what
  it drew, which is right: it has nothing to read.

- The ceiling's sentence was counting the wrong thing. `picturesMade` was
  incremented *before* the call, on purpose — a refused generation costs the
  same money as a drawn one and has to spend its place — but the refusal it
  produced read "you have already made 2 pictures this turn — show the user what
  you drew", to a model whose two attempts the image model had both refused and
  which therefore held nothing. The counter is now `picturesAsked` beside a
  `picturesFiled`, and the sentence is a pure `generationCeilingSaid(asked,
  filed)` next to the limit it quotes: all drawn keeps the old wording, none
  drawn says "none of them could be drawn — tell the user what went wrong", and
  the mixed turn names the one picture that exists. The budget is a fact about
  money and the sentence is a fact about the project; only the second is what
  the model writes a reply from. It costs nothing on the floors (unchanged at
  1,313 / 3,086 / 3,249 / 11,970) — it is paid only at the moment the ceiling is
  hit. `crop_reference`'s own ceiling counts calls the same way and carried the
  same gap — "you have already offered 2 cuts this turn — ask the user which of
  them is the one" is equally untrue of a turn whose cuts were all refused. It
  was left alone at the time as another tool's defect rather than folded in
  silently, and has since been closed on its own terms: `cropsOffered` beside
  `cropsAsked`, incremented where the offer becomes real (past `cropOffer`'s own
  refusal, which is the branch that makes the two numbers differ), and a pure
  `cropCeilingSaid(asked, offered)` beside `CROP_CALL_LIMIT` in the same three
  shapes — all cut keeps the old sentence word for word, none cut says "none of
  them could be cut — tell the user what went wrong", and the mixed turn says
  which number it holds and asks whether *that* cut is the one. The reading is
  the generation ceiling's and so is the cost: nothing at the floors (1,382 /
  3,191 / 3,354 / 12,075, unmoved), because a ceiling sentence is only ever paid
  by the call that hits it.

- The failure the tool is likeliest to hit was the one not written down. Every
  branch of `makePicture` answers as a sentence, but the branch catching the
  generator was passing `cause.message` through — and the only errors reaching it
  that are not the generator's own words are the transport's, whose message is
  `vertex 404 (retryable): <html><title>Error 404 (Not Found)…`. That is the
  *expected* failure of this particular model: infra.md §X records that
  `gemini-3-pro-image` answers burst throttling as an HTML page, and
  `vertexFetch` re-throws it once four rounds of backoff are spent. So the house
  rule's "errors as a sentence" was kept everywhere except where it would first
  be tested. `generateImage` now wraps its own call and answers "the drawing
  service is busy and did not answer … offer to try again" or "… could not be
  reached …" off `VertexError.retryable`, with the raw text carried on a new
  `detail` field and written to the run row in place of the sentence — the
  sentence is a constant of the code and the page is the only part of the
  failure a panel cannot reconstruct from it. `VertexError` is exported for the
  first time so the tests can throw the real one. The wrapped throw is not
  retried inside the loop: the second attempt exists for a model that answered
  without a picture.
- `retryable` and `detail` are read **off the thrown value**, not through
  `instanceof`, the way `usageThrown` already reads a refusal's tokens. Written
  with `instanceof` first, it failed under the test runner: `tsx` loads
  `vertex.ts` twice, so a `VertexError` thrown by a test is not a `VertexError`
  to the module catching it. A class is a module identity and a field is a fact,
  and this error crosses loaders and bundles. Free on the floors, which stay at
  1,313 / 3,086 / 3,249 / 11,970 — executor wording is never declaration text.

- The drawn picture was the hardest one in the strip to find again. The search
  box matches a title and the analyzer's tags, which between them describe every
  photograph in the project and almost nothing about a picture drawn ten seconds
  ago: `generatedImageTitle` keeps the description's opening clause and drops
  the rest, and the tags are a queued job away. So `matchesQuery` reads
  `generationPrompt` too — a field on `FilterableReference`, optional for the
  reason `origin` is, and nowhere near the facets, since a prompt is prose and a
  facet is a vocabulary. Nothing had to be threaded to reach it: the strip
  filters the whole `listByProject` row, which has carried the column since the
  migration. The placeholder widens to "Search title, tag or prompt" only where
  `hasGenerated` is true, the same test the `Generated` control is offered
  under. Floors unchanged at 1,313 / 3,086 / 3,249 / 11,970 — this is browser
  text.

- A description refused on its way in was read as a model that said nothing.
  Vertex answers a prompt-level block with `promptFeedback.blockReason` and *no
  candidate at all* — the block is decided on the words before any drawing
  starts — so the loop, which reads its refusal sentence off the candidate
  (`textOf` the parts, then `finishMessage`, then `finishReason`), found none of
  them and fell through to its last resort, "the image model returned no
  answer". Two things were wrong with that. It says nothing the user or the
  model can act on, in the one failure whose cause is *knowable* and is about
  the user's own words; and it was retried, which for a block on the prompt
  alone is the same words to the same reader for a second bill. `generateImage`
  now reads `promptFeedback` before the candidates and throws on the first call,
  naming the service's `blockReasonMessage` where there is one and its
  `blockReason` code where there is not, and steering at the description rather
  than at another go. `promptFeedback` is typed on `generateContent`'s response
  for the first time — every other agent in the file still reads a blocked
  prompt as an empty answer, which is a class this iteration did not close. The
  shape is the documented one (`promptFeedback.blockReason` /
  `blockReasonMessage`) rather than one observed live — provoking a block costs a
  refused generation and the words to provoke it — so it is read defensively:
  both fields optional, and an absent reason falls through to the candidate
  reading exactly as before. That is why infra.md §X, which records only what
  was seen on the wire, is left unchanged.
  Unlike the transport wrap above, this one needs no `detail`: the reason is
  inside the sentence, so the run row's copy carries it. Floors unchanged at
  1,313 / 3,086 / 3,249 / 11,970.

- The empty project was told to prefer a photograph it has not got. "Prefer a
  picture the user actually has" stood in *every* variant of the declaration,
  while the instruction's own copy of the same sentence
  (`GENERATING_OVER_THEIRS`) has been gated on `pictures > 0` since the prose
  step, with a comment saying why: on the empty project it is about pictures
  that do not exist. The declaration is the worse place for it — it is read at
  the moment of the call, by the one tool in the file that works before anything
  has been uploaded, and what it steers toward is looking first at a gallery
  that is not there. Now gated on the same count and dropped rather than
  replaced (`.filter(Boolean)` on the sentence list, the way
  `compose_moodboard`'s `referenceIds` already drops its crop clause), so the
  empty project pays for nothing in its place. Measured: the empty project's
  floor falls **1,313 → 1,277** (−36) and the other three shapes are unmoved at
  3,086 / 3,249 / 11,970 — the tool still reads 436 tokens at the full shape,
  which is the number §III quotes.

- **The instruction was settled before the loop while the declarations were
  resolved inside it.** `turn.ts` read `tools.brief()` and `tools.state()` once
  and handed `orchestrate` their answers; `orchestrate` built one
  `systemInstruction` from them above the round loop and re-sent that same
  string on every call, while `declarations()` was called afresh each round with
  a comment explaining exactly why. The two halves of one gate, read at
  different times. `generate_image` is what made it visible: it is the only tool
  that moves a project between gate classes without the user touching anything,
  so the empty project that drew a backdrop on round 1 was handed the picture
  tools on round 2 under `NOTHING_UPLOADED` — "there is nothing to show, cut or
  compose" over `show_references`, `crop_reference` and `compose_moodboard`,
  with `PICTURES`, `CROPPING`, `COMPOSING` and `GENERATING_OVER_THEIRS` all
  withheld on the one round they applied. Both parameters now take a value *or*
  a reader (`brief?: string | (() => …)`, `state?: ProjectState | (() => …)`),
  the turn passes the toolset's own two functions, and the instruction is built
  inside the loop beside the declarations. The brief follows for free and is
  worth as much: the reference cache is appended to as the row is filed, so
  round 2's catalog lists the drawn picture with its `generated` mark instead of
  claiming the project holds nothing. `compose_moodboard` filing the first board
  is the same defect and is closed by the same change, with one honest
  limitation at the time — the boards read was *counted* into the state rather
  than appended to like the references, so the `BOARDS` section arrived one
  round before the brief listed the board it is about; closed by the bullet
  below. Measured: the four floors are unchanged at 1,277 / 3,086 / 3,249 /
  11,970, because the floor is the *first* round and nothing about it moved; the
  cost is on the round after a drawing, where the empty project's instruction
  goes **368 → 790 tokens** (+422) beside the ~1,400 tokens of declarations that
  round already carried.

- **The boards read is now appended to the way the references read is.** The
  turn kept two different answers to "what boards does this project have": a
  memoized `boards()` read taken once, and a `boardsFiled` counter added to it
  in `projectState()` alone. So the round after a compose was told how to read
  and swap on a board, under a catalog that had never heard of it — the
  asymmetry the bullet above had to declare as a limitation. `fileBoard(row)`
  now folds a filed board into the memoized promise the way `filePicture` folds
  a filed picture (prepended, because the read is newest-first; chained onto the
  promise, because two composes in one round run side by side), both writes
  select the board columns the read is made of through a shared
  `BOARD_ROW_SELECT`, and `boardsFiled` and `titlesFiled` are both gone —
  naming the second copy of a board against the turn's own list falls out of the
  one read rather than out of a second array kept beside it. Two guards that
  ask `(await boards()).length` before re-reading `elements` — `crop_reference`'s
  "what boards does this cut stand on" and `discard_reference`'s — get the same
  fix for free: a board composed earlier in the turn no longer reads as no board
  at all. Still open, and a wider class: a board *edited* in the turn (a rebuild
  that renames it, any tool that changes its pages) keeps its pre-edit row in
  the cache, so a later round's brief can name it by the title it had at the top
  of the turn. Closing that means every board write refreshing the row, not just
  the two that create one. Measured: the four floors are unchanged — the whole
  change is executor-side, and the floor is the first round of an untouched
  project.

- **A drawn picture was removed as a photograph.** `discardedReferenceNote` is
  the sentence a removal puts in the conversation, and it rides up as the
  *user's* turn — "I removed the photograph “Warm grey paper” (ref-9)" — so it is
  read as a fact rather than as a claim the model can weigh. It chose its noun
  off `frameId` alone: cut or photograph, with a drawn backdrop and a crop of one
  landing on the wrong half of that. `pictureNoun(origin)` is now the single rule
  (beside `isGeneratedOrigin`, split out of `isGeneratedReference` because a
  discard note has an id, a title and a provenance and nothing else a
  `FilterableReference` needs), read in three sentences: the removal, the frame a
  cut leaves standing, and `discard_reference`'s `cutOf` at offer time. A cut
  answers off its own column, which is its frame's — the inheritance the
  `versionOrigin` bullet above put there. Threading it was the awkward part,
  because the note is written *after* the row is deleted: `ReferenceAttachment`
  carries `origin` for the tool-offered Remove button (beside `discard`, and for
  the same stated reason), the gallery and its full-size viewer read it off the
  row, and the properties panel's cut removal needed `origin` added to
  `reference.versions`' select — the one reference read in the app that had never
  selected the column. An import is worded as an upload is, and an absent column
  words the removal exactly as it always did. Measured on the pinned sample in
  one session: 1,382 / 3,191 / 3,354 / 12,075 before and after, unmoved, since
  every sentence here is an executor answer or a browser string. (Those four are
  105 above the figures the bullets above quote, on the same pinned project and
  with no declaration moved — the project's own brief rides the instruction, so
  the absolute numbers drift when the *sample* is edited and only a same-session
  pair means anything.)

- **The project this tool creates was told to prefer pictures it has not got.**
  Iteration 21 gated the declaration's prefer-theirs sentence on `pictures > 0`,
  which is the empty project's premise; the project one round later — it drew a
  backdrop, so it has a picture and it is the assistant's own — passes that gate
  and reads the sentence anyway. All three copies of the preference did:
  `madeNote` under the catalog ("a photograph they brought is the better answer
  wherever one fits"), `GENERATING_OVER_THEIRS`, and the declaration's own
  sentence. Each now picks between two wordings rather than being dropped, since
  look-before-you-draw is still right where every picture is drawn — only its
  reason changes, to what a second call costs and to the fact that the same
  description never comes back as the same picture. `ProjectState` grew a fourth
  count, `generated`, off the same memoized reference read the other three come
  from and over the cuts as well as the photographs (a cut of a drawing carries
  the column). Optional on the type — 46 literals construct a `ProjectState` in
  this repo, and a caller that has not counted the drawings is not claiming there
  are none, which is how an absent `origin` is already read. `madeNote` needed no
  count at all: it is explaining the marks on a list it has in hand, so it asks
  the list. That also keeps it honest under truncation — it claims nothing about
  the photographs a 24-line catalog is not showing, only that nothing *on this
  list* is one they brought.
- The fake `reference.create` in `tools.test.mts` returned neither `origin` nor
  `generationPrompt`, so the row folded into the turn's memoized read by
  `filePicture` read as a picture the user brought for the rest of that turn.
  Nothing had caught it because nothing had asked the state a provenance
  question until this change did: `state()` after a `generate_image` call
  answered `generated: 0`. This is iteration 26's finding again, on the same fake
  and one field further in — a test double that is careless about a column is
  invisible until some assertion depends on it.
- Measured on the pinned sample, whose one reference *is* a generated picture
  and which is therefore exactly the shape this bullet is about, before and after
  in one session: 1,039 → 1,063 / 2,848 → 2,898 / 3,011 → 3,035 / 11,732 →
  11,756. The +24 on all four is the catalog note, which rides the primed brief
  and is the same brief on every shape; the extra +26 on "photographs only" is
  the only shape whose counts make it drawn-only (+22 instruction, +4
  declaration, 436 → 440). A project holding one photograph of theirs pays
  nothing for any of it.

- **Two pictures could arrive under one name.** The title is derived rather than
  typed — the description's opening clause — so "a warm grey paper texture, lit
  flat" and "a warm grey paper texture, but bluer" file as the same sixty
  characters, and the second ask is the likelier of the two ways in: a user
  asking for the same thing improved keeps the clause the title is cut from.
  Every surface that names a picture then names both — the gallery tile, the chat
  caption, the board caption, and the removal sentence the browser writes in the
  user's voice. `generatedImageTitle` now takes the names already taken and
  numbers past them (`(2)`, `(3)`, the base truncated to leave the suffix room),
  read off the turn's own memoized reference list as late as it can be, after the
  drawing, so a picture drawn earlier in the same turn is one of the names the
  next one is kept clear of. It steps around *every* reference's title, not only
  the drawn ones: the collision a user sees is between two tiles. An uploaded
  photograph sharing its neighbour's name is untouched and stays that way — the
  user typed that one, and de-duplicating a name they chose would be the product
  overruling them, where this is the product keeping a name it made up
  distinguishable. Both precedents in the repo already read this way
  (`croppedReferenceTitle` increments "(crop 2)", `duplicateBoardTitle` numbers a
  copy against the boards it is filed beside) and only the drawn picture had no
  such rule. Measured on the pinned sample before and after in one session:
  1,382 / 3,191 / 3,354 / 12,075, unmoved — a filed row's title is never
  declaration text.

- **Agent 2 was told a person filed it.** The analyzer is handed the image and
  one sentence of context, and that sentence was `The user filed it as "<title>"`
  about every reference in the project — including the one nobody filed and
  nobody named. A drawn picture's title is an opening clause cut out of the
  assistant's own description and numbered past whatever the project already
  called something, so the model that is asked to name the picture, and whose own
  instruction says a name is read as a fact about it rather than as a reading of
  it, opened on `A warm grey paper texture (2)` as the user's words. This is
  iteration 27's `pictureNoun` on the model-facing side, and the same test it
  applies: a sentence that asserts something on the user's behalf is worse wrong
  than a tool answer, because nothing downstream weighs it. `analysisAskSaid`
  (`src/lib/analysis/analysis-ask.ts`) is the rule, and it took the chance the
  correction handed it — the drawn branch quotes `generationPrompt` in place of
  the title, which is the only statement of a picture's subject in this product
  written down *before* the picture existed, where the upload branch it replaces
  is quoting a filename. Quoted with a warning, deliberately: image models drop
  parts of a prompt, so the request is evidence and not fact, and agent 2's
  standing rule is to describe only what is in the frame. A cut of a drawn
  picture has the origin and not the words, so it falls back to the name it was
  filed under. The worker's `reference.findFirst` had to name the two columns —
  the *third* hand-written reference select in the app, after `reference.versions`
  (iteration 27) and `reference.summary` (the bullet above), and the one nobody
  had counted, so the standing checklist for a new column is three reads and not
  two. Floors unmoved at 1,382 / 3,191 / 3,354 / 12,075: the ask is one user part
  of one vision call.

- **The thumbnail was offered once and never again.** The fix above hangs off
  `onAnswered`, so a drawn picture gets its grid-sized copy in the seconds after
  the turn that drew it or it never gets one at all. Three ordinary things end
  the turn somewhere else: a turn that *broke* on a later round — the tools file
  as they are called, so the drawing is in the project and `onFailed` had only
  ever invalidated the boards — a tab closed while the original was coming back,
  and a derivation that simply failed (deliberately: "failures left where they
  fall"). Each leaves a row whose every tile in the strip and the grid streams a
  full-resolution PNG for the life of the project, and nothing was ever going to
  come back for it. `useDerivedReferenceCopies(projectId)` is the standing
  version of the same job: it subscribes to the reference list the strip and the
  grid already poll, derives every row `needsDerivedCopy` marks, one at a time,
  and remembers what it has tried so a row that cannot be derived is not read
  back on every turn of the conversation. It re-reads the list between passes
  rather than closing over the one it started on, because the download is slow
  enough for a turn to draw a second picture inside it and the guard that stops
  two sweeps running at once would otherwise make that picture wait for the
  change after it. Mounted in `project-workspace.tsx`
  rather than in the assistant's column, which collapses — the same reason the
  cut and discard listeners are there. `filedReferencesOwedCopies` is gone and
  `referencesOwedCopies(rows, tried)` stands in its place: a sweep that reads
  the whole list has no use for the ids a turn filed, and the turn's own path in
  `onAnswered` shrinks to the invalidation it always needed, with the derivation
  left to the sweep watching that same list. `onFailed` gained the reference
  invalidation for the reason it already had the board one, which is what puts a
  picture drawn before the failure in front of both the user and the sweep.
  Floors unmoved at 1,382 / 3,191 / 3,354 / 12,075 — none of this is text a
  model is sent.

- **The app never said it could draw.** Every correction so far was made to
  something a *model* reads; the three sentences the product says to a *user*
  about where a picture comes from were still the ones written before this tool
  existed — the empty gallery's "Upload the images you want to work from", the
  empty conversation's "References come from your own uploads", and the home
  page's pipeline list, whose intake row said "You upload the references" and
  whose orchestrator row routed between "the five above" with no seventh agent
  under it. Two of those three are read on the empty project, which is the exact
  shape the declaration is ungated for, so the one capability that needs no
  upload was the one nothing on screen mentioned: it could be found only by
  asking for something the user had no reason to think was there. All three now
  name it in the app's own word — a picture is *drawn*, the noun `pictureNoun`
  already answers a removal with — and each where it is true rather than as a
  feature line: beside the upload in the gallery's empty state, as the thing the
  assistant's column can do that the dropzone cannot in the conversation's, and
  as agent 7's own row on the home page, the intake row keeping its "not an
  agent" note with its claim narrowed. No pure rule and no test: the sentences
  are constants of three components, gated on nothing because the tool is gated
  on nothing. Floors unmoved at 1,382 / 3,191 / 3,354 / 12,075.

The declaration cost, measured the way the canvas five were (`npm run floor`,
same six-photograph project, minutes apart, instruction and priming untouched):
**436 tokens** at the full shape, and every shape pays it —

| shape | before | after | delta |
| --- | --- | --- | --- |
| nothing uploaded | 718 | 1,125 | **+407** |
| photographs only | 2,406 | 2,822 | +416 |
| and cuts | 2,569 | 2,985 | +416 |
| and boards | 11,270 | 11,706 | +436 |

The empty project pays 407 rather than 436 because its variant names no tool
and no `crop_reference` dialect — but proportionally it is by far the largest
change in this file's history, **+57%** on a shape whose floor was the one
number nothing had ever moved. (It pays 371 as of the prefer-theirs gating
above; the table is the measurement as the build landed it.)

The prose costs on top of that, measured the same way in one session (a later
one, so the boards shape had drifted to 11,706 — the pair is what is
comparable, not the absolute):

| shape | before | after | delta |
| --- | --- | --- | --- |
| nothing uploaded | 1,125 | 1,313 | +188 |
| photographs only | 2,822 | 3,041 | +219 |
| and cuts | 2,985 | 3,204 | +219 |
| and boards | 11,706 | 11,925 | +219 |

The instruction itself went 2,718 → 2,937. The empty project pays 188 rather
than 219 because it is not told to prefer a photograph it has not got. So
`generate_image` costs a full-shape project 655 tokens a call, declaration and
prose together, and the empty project 595 — 559 since the gating above — where
its whole floor was 718 before this build began.

`npm run floor` takes a project id and defaults to the *newest* project on the
database, which is a trap once a build starts making projects to try things in:
the end-to-end run above created one, and the very next unpinned measurement
read 1,066 / 2,794 / 2,957 / 11,678 — a whole different sample, not a
regression. Every number in this section is the sample the build has used
throughout (`cmsx3za0r00046trvruk76jez`, nine photographs), and it still reads
1,313 / 3,041 / 3,204 / 11,925 with the thumbnail fix in, which touches nothing
the model is sent.

The build landed at 22 declarations and floors of **1,313 / 3,041 / 3,204 /
11,925** — measured again with everything in, including the client and pricing
steps, which moved none of them. The defect passes since have moved them once:
the `drawnFrom` sentence in `read_references` took the three shapes that have
that tool to **3,086 / 3,249 / 11,970**, the empty project unchanged. `generate_image` is 436 of the boards shape's
8,450 declaration tokens, seventh dearest of the twenty-two and within nine
tokens of the three either side of it, and the only one every project pays.

### The canvas toolset — built and promoted

The previous pending entry — the canvas toolset — is built and promoted
into §III. What the build decided differently from the design, kept here so
the design read beside the code does not mislead:

- **`transform_on_canvas` carries no `pageId`** — `canvas.md` §XI sketched
  one, but the module addresses objects by unique id in each object's own
  read dialect, so a page scope would have been schema with nothing behind
  it. `reorder_on_canvas` keeps its `pageId` (the module scopes `front`/`back`
  and refuses outsiders per move).
- **Reorder's union destination is flattened** to three sibling fields —
  `to` (enum `front`/`back`), `above`, `below` — because Vertex declarations
  carry no union types; a move naming none or two of them is counted
  unreadable.
- Decisions the design left open, taken during build: `size` is
  `[height, width]`, y-first like every box; `stretch: true` is for a lone
  image only; page `size` is refused toward `resize_page` (the design only
  forbade rotation); group rotation is shortest-path about the unit's centre;
  bound labels are refused toward their container; a group containing a frame
  is refused; transform refuses the later change when one call addresses the
  same unit twice, while reorder applies moves sequentially against the
  evolving array; `above`/`below` across two stacking companies is refused;
  removal by a selector that would take anything locked refuses whole.
- **No prose is gated on page count** — the open question of whether any
  clause should be. The five declarations are static within `boards > 0`.

The declaration cost, measured the way §III's changes were (`npm run floor`,
same six-photograph project, minutes apart, instruction and priming
untouched): the five together are **2,080 declaration tokens** — `read_canvas`
301, `put_on_canvas` 543, `remove_from_canvas` 288, `transform_on_canvas`
491, `reorder_on_canvas` 457 — taking the boards-shape floor from 9,149 to
**11,229** (+23%). That is the largest single addition in this file's
history, on the shape that already had the highest floor; the canvas five are
now the first candidates if the floor has to come down, ahead of
`compose_moodboard`'s 1,410.

## V. The twenty-third — `design_page` (built)

The door to agent 8, the design assistant (tech-spec §III.8, full contracts in
`compositor-v2.md`). Written here while it was still a design, and built since —
and since 2026-08-24 it is the *only* compositor agent 6 has.

**`design_page`** — args `{ boardId, pageId?, intention, imageIds?, newPage? }`.
Gate: `boards > 0`. Cost: **model, vision, multi-round** — the most expensive
entry in this file by an order of magnitude, since one call is a tool loop of its
own with pictures in it. **No per-turn ceiling** — a `DESIGN_CALL_LIMIT` was
removed, came back with a wall-clock reserve, and was removed again on
2026-08-30 with the tRPC route raised to `maxDuration` 800 under it
(`compositor-v2.md` §VI). Not `TURN_TOKEN_CEILING`, as this line used to say:
that reads agent 6's own bill and a design's rounds are agent 8's. The turn is
bounded by the route's wall clock, each design by `DESIGNER_ROUND_LIMIT`, and
the picture budgets stay shared across the turn.

An `AgentTool` like agents 2–4: agent 6 gets the result back and writes the
sentence, and agent 8's own closing line rides in the result the way agent 4's
`note` does.

It is no longer the only way in. "Let's Vibes" (`compositor-v2.md` §IX) is a form
on the canvas that makes a board and runs a design call per page without going
through this agent at all — which is why that run writes itself into the
conversation: agent 6 can read the board it finds there, but nothing else would
tell it what the board was for.

**The routing rule is retired with agent 4 (2026-08-24).** It read: prefer this
over `compose_moodboard` when the user named a kind of thing that is not a
moodboard (a sign, a banner, an album spread, a poster, a cover); when the ask is
about arrangement in words no template answers ("the headline sits over the top
third", "give it room to breathe", "the two portraits should face each other");
or when a page already laid out needs judgement rather than reassignment — and
closed on "a grid of nine is not a design problem".

There is nothing left to route to. What the declaration keeps is the half that
was never about routing: this is the only way a page is laid out, whatever the
user called the thing, and it is the dearest call in the file — so the free scene
edits (`swap_on_board`, `move_to_page`, `reword_on_board`, `put_on_canvas`,
`remove_from_canvas`) are named in it as what a one-thing change reaches for.
The rule had been doing that job by accident, and doing it on a distinction the
model had to get right on every board in the product.

`newPage` puts the work on a fresh page beside `pageId` and reads nothing else on
the board, which is why "try another version" costs nothing that already stands.

**Measured, now that it is built.** `npm run floor` on an 11-board project:
`design_page` **737** of the 28-declaration total, behind `put_on_canvas` 1,080
and `crop_reference` 670, and well under the 1,410 `compose_moodboard` used to
cost. The three routing paragraphs coming out are most of the difference. The
boards-shape floor reads **14,227** — instruction 2,978, primed 677,
declarations 10,572 — with `add_board` at 424, and agent 8's own floor is
**11,828** (instruction 2,844, 19 declarations 8,984).

## VI. The style dialect — three more (designed)

`canvas.md` §XI, "the style dialect", is the design and the reasoning; this is
the contract half. Three additions, of which `restyle_on_canvas` is built and
the two backgrounds are not. They exist because the five
canvas tools say where a thing is and nothing at all about what it looks like,
and because the renderer has been drawing shapes the geometry read has never
mentioned.

**`restyle_on_canvas`** — the sixth canvas tool. Args: `boardId`,
`changes[{objectId, fill?, stroke?, strokeWidth?, strokeStyle?, rounded?,
colour?, font?, align?, fontSize?, opacity?}]`. Batched, capped at 10, the same
plumbing as its five siblings — project-scoped ids, revision-guarded write on the
per-board queue, no-op detection, `notOnBoard` / `locked` / `refused` in the
result. Split from `transform_on_canvas` rather than folded into it because
`transform` answers where and how big, and nine appearance fields on it would be
paid for by every "move it left". Fields are checked against the object's kind:
`fill`/`stroke`/`strokeWidth`/`strokeStyle`/`rounded` are a shape's,
`colour`/`font`/`align`/`fontSize` are a text block's, `opacity` reaches shapes,
text and images alike — a photograph at 40% is a scrim with nothing added to the
page — and pages take none of them, refused toward `set_page_background`. A field
that does not apply is refused with a reason, never dropped. `font` is one of
five names (`hand`, `sans`, `mono`, `rounded`, `display`) rather than
excalidraw's integer; `renderFont` already holds the mapping.

`read_canvas` grows a fourth kind alongside it — `kind: "shape"`,
`shape: "rectangle" | "ellipse" | "line"`, carrying its own fill, stroke, stroke
width, stroke style, rounded and opacity — and `put_on_canvas` grows the same
kind plus the style fields on both shapes and text, so a thing can land right
instead of landing and being fixed. Arrows, diamonds, freehand strokes and
embeds stay out of both, and are reported in an `unaddressable` remainder rather
than omitted: the picture shows them, so the words have to account for them.
Shape puts default to `fillStyle: "solid"` and `roughness: 0`, against
excalidraw's sketchy defaults. An explicit `fontSize` is honoured to
`CANVAS_TEXT_MAX_FONT`; the box-derived size keeps `LAYOUT_TEXT_MAX_FONT` 96, so
`compose_moodboard`'s output does not move.

**`set_canvas_background`** — args `{ boardId, colour }`, a hex or `"default"`.
Gate: `boards > 0`. **This one is the orchestrator's alone** and is not in agent
8's set: the board is the desk the user's pages sit on, and a design assistant
handed one page has no business repainting it. Both ends of it already exist —
`viewBackgroundColor` is in `PERSISTED_APP_STATE_KEYS` and `render-plan` reads it
as `plan.background` — and the middle does not. Note for the build: this is the
first agent write in this file that is **not an elements write**. `sceneWrite`
takes elements and derives the page columns from them; `appState` is a separate
`Json` column that none of §III's conflict story currently covers, so the
revision guard, the keyed queue and no-op detection all have to be brought to it
deliberately. A repaint to the colour a board already has must write nothing, or
every idle tab is handed a conflict for a change that moved no pixel.

**`set_page_background`** — args `{ boardId, pageId, colour }`, a hex or
`"none"`. Gate: `pages > 0`. Shared with agent 8. A frame's own
`backgroundColor` is not the mechanism and cannot be: excalidraw draws every
frame in `FRAME_STYLE` and `rasterise` matches it, so the field would give the
model a coloured page and the user a white one. It is a real page-sized
`rectangle` carrying `customData.pageBackground: true` at the back of the page's
child run — which the editor, the exporter and `renderForModel` then all draw
with no new code. What it costs is exclusions, and they are the build: it is
never an object (`readableItems` drops it, it reads as `background` on the page),
never addressable (remove, transform and restyle each refuse it by name), never
swept (`arrangeableUnits` collects every live element today and would tidy it
into the photo grid), always at the back, resized with its page, one per page,
and dropped rather than made transparent when cleared.

Every read widens with them — `inspect_board` counts shapes and says the
background, `PageAIRepresentation` and `pageBrief` gain shape blocks — and one
routing rule follows: **a page carrying shapes does not stand as composed**, so
`compose_moodboard` takes it down the edit-in-place path rather than a seated
rebuild. A template rebuild would lay photographs over ground somebody put there
on purpose.

The declaration cost is not measured, because none of the three exists. It will
land on the boards shape, which already carries the highest floor in the app and
where the canvas five already sit at 2,080 (§IV). Measure with `npm run floor`
before and after on one project, as every other change to this file was measured.
If it has to come down, the style fields on `put_on_canvas` go first — a line can
be placed and then restyled — and `restyle_on_canvas` goes last, being the only
one of the three that two calls to something else cannot replace.

**`set_page_background` is built, on both sides.** The rectangle, the mark and
every door that has to know about it landed first
(`lib/pages/page-background.ts`, 2,702 → 2,730 cases); the tool followed
(2,730 → 2,737) as one executor in `server/pages/tool-pages.ts` behind one
declaration, reached by agent 6 in `server/agents/orchestrator/tools.ts` and by agent 8 in
`server/agents/designer/page.ts`; and the user's control closed it
(2,737 → 2,744) — a fourth `BoardSelection` kind, the panel in
`moodboard-inspector.tsx` and `board-background.ts` calling the same
`setPageBackground` the tool calls (canvas.md §V, §XI.4). No declaration
changed for the last of those, so the floor below is where the stage ends.

The door cost, measured on the same project minutes apart: the declaration is
**373 tokens** and agent 8's instruction gained **133** for the paragraph that
names it, taking agent 8's floor from 9,997 to **10,503** — past 10k, as §XI.6
predicted stages 2 and 3 would. Agent 6's boards-shape floor is **14,701** across
25 declarations, of which the canvas six and the page background are 3,274.
`set_canvas_background` followed on agent 6's side alone, and is reported at
the end of this section.

What the build settled beyond the contract above:

- **It is `locked`.** Not in §XI.4 and not optional: a filled page-sized
  rectangle at the back of every page is what every click on empty page lands
  on, so unlocked it is the first thing the user selects by accident.
- **`arrangeableUnits` does not "collect every live element with an id"** — its
  loop is `if (element.type !== "image") continue`, so the sweep §XI.4 calls the
  costliest miss cannot happen by the ungrouped path at all. A user-made group
  holding an image is the one way in, and a group carrying the ground sits the
  tidy out whole, exactly as a group carrying a frame does.
- **Two exclusions carry the rest.** `isPageBackground` asked once in
  `readableTarget` takes the ground out of the object list *and* out of all six
  write doors; asked once in `boardItems` it takes it out of the page brief's
  blocks, the digest's `shapes` and `pageCarriesShapes` — the last of which is
  what keeps agent 4 able to compose onto every page "Let's Vibes" paints.
- **The refusals are asked ahead of the handle question**, on the lesson two
  paragraphs down: `readableTarget` drops the ground, so a refusal placed after
  it answers `notFound` and reopens the loop stage 0 closed.
- **`resize_page` looks the ground up at the rectangle the page *was*.** After
  the resize a shrunk page's old ground has its centre outside the new rect, and
  the page would stay painted at its old shape.
- **`duplicate_page` and `discard_page` carry it by geometry** — verified rather
  than assumed, `customData` and `locked` both surviving the copy's
  `REGENERATED` list.

And what the tool's own wiring settled:

- **`pages > 0` is not a gate this codebase has.** `ProjectState` counts
  photographs, crops and boards and nothing else. `set_page_background` sits in
  the `boards > 0` block with every other page tool, on the plainer reason that
  a page id can only come from a board.
- **One declaration for both agents, and it is the first of §IV.2's page tools
  that is not forked.** The other four each carry a `DESIGNER_*` copy because
  agent 6's words name `inspect_board` or `compose_moodboard`. This one names
  `read_canvas`, which both agents hold and which is where a page's `background`
  is read either way — so there is no clause to keep in step across two files.
  A test pins that neither of agent 6's two tools appears in the description.
- **The four refusals stopped pointing at nothing.** Remove, transform, reorder
  and restyle have named `set_page_background` since the element was built,
  which was the same trap §IV's `restyle_on_canvas` notes recorded about the
  page refusal: a refusal naming a tool the model does not hold costs a round on
  an unknown-tool error. That is now paid off.
- **The status line says what the counts cannot.** Nothing on the page moves
  when it is painted and the ground goes behind what is standing there, so the
  answer says out loud that anything already on the page that was the colour of
  the old ground is unreadable against the new one.
- **A colour that is not one is refused with the word the model used** — a hex
  or `"none"`, and nothing else. Defaulting to grey is a page the model has to
  be told about twice.

And what the user's half settled, per invariant 12:

- **"Offered when the selection is a page" is a change to the selection first.**
  `BoardSelection` was three cases and all three were about references, so a
  page on its own resolved to `none` and the panel returned null. The page case
  carries the name, the colour and the references standing on the page off the
  same walk, so the panel asks no second question of the scene.
- **The page case is asked last.** A photograph selected while it sits on a page
  is a selection about the photograph; asking the page first would have taken
  the properties panel off every photograph on every page.
- **One page and nothing else**, which is `exportedFrame`'s existing rule for
  the selection-only export and holds here for the same reason: a page picked
  together with something else is a user asking about both.
- **The panel re-derives on the settle beat.** Painting a page moves neither the
  selection nor its signature, so the guarded `onChange` branch never fires for
  it and the panel would keep saying the colour the page *was* — offering to
  clear a page standing on nothing. `collect` re-resolves behind a
  `sameSelection` guard, which is also how ⌘Z arrives in the panel.
- **A colour input is a drag, and a drag is a write per frame.** Each one
  repaints the page, which is the point — the choice is made against the real
  page — but each one is an undo step unless it is written with
  `CaptureUpdateAction.NEVER` and committed once on release.

**A live design used it on first contact.** `npm run design:check` for "a dark,
moody welcome sign for an evening wedding — cream calligraphy on a deep
near-black page" (board `cmt3sm8ns0001u9rvb2fkmejr`, 13 rounds, 111s, $0.16,
gemini-3.7-flash): the model made a 1080×1920 page with `put_on_canvas`, and its
very next call was `set_page_background(#0c0f16)` — the ground settled before a
single object was placed, which is the ordering the instruction's paragraph
argues for and which no round of prompting was spent on. The page came back
`4 shape, 4 text`, 264% inked, largest type 5% of the frame. The run stopped on
`rounds` again: three of the twelve went on a `font` restyle to `display` and
straight back to `hand`, which is the round budget §XI.6 flagged, not the door.

`render:check` is unchanged at 1 AGREES / 4 CLOSE — no board on the database
carried a page background at a revision with a stored export. `design:pages` now
finds 48 pages on 19 boards and reads the painted page as `4 shape, 4 text`:
`bandOccupancy` counts the ground as a backdrop and leaves it out of the ink, and
the shape census counts what somebody drew rather than the page's own colour.
Neither read needed an edit.

`design:pages` (47 pages, 19 boards) and `render:check` (1 AGREES, 4 CLOSE) are
both unchanged, which is the honest report: no board on the database carries a
page background yet, and none can until the setter has a door.

**`set_canvas_background` is built, on agent 6's side alone** — the lib half in
`lib/boards/board-background.ts`, the declaration in `agent-tools.ts` and
`paintBoardCanvas` in `server/agents/orchestrator/tools.ts` (2,744 → 2,757 cases). The
declaration is **290 tokens**, taking agent 6's boards shape from 14,701 to
**14,991** across 26 declarations; agent 8's floor is unmoved at **10,503**,
which is the split earning its keep rather than a coincidence.

What the build settled beyond the contract above:

- **The trap was real and is paid for by hand.** This is the only agent write in
  the app that is not an elements write, so `sceneWrite` — which carries the
  revision guard's data, `pageCount` and `pageNames` with it everywhere else —
  is nowhere near it. The guard, the keyed queue and the no-op are each written
  at this call site, and a test asserts the write carries `appState`,
  `revision` and `renderRevision` and *not* `elements`: a repaint that carried
  the document would be this call quietly restating the scene it read over
  whatever the same turn had done to it since.
- **Queued on the board key though it touches no element.** The revision it
  guards on is the same counter a compose in the same turn increments, so a
  repaint read outside the queue loses to whatever landed between its read and
  its write and answers with a conflict it did not have to have.
- **`"default"` drops the key rather than writing `#ffffff` over it.** The
  absence of a stored colour *is* excalidraw's paper, and `render-plan` falls
  back to the same white — so a board that has never been painted and a board
  put back are one row, and a read can still answer "nobody has painted this".
- **The no-op is asked against the colour the board is *drawn* on.** A row with
  no `viewBackgroundColor` and a row carrying `#ffffff` are the same pixel, so
  both spellings of "leave it as it is" are free. The contract asked for "the
  colour a board already has"; the row is not the pixel, and that is one step
  further out than it said.
- **No tile.** Every other board answer here carries a `boardShown` attachment
  and this one must not: `BoardAttachment` draws the arrangement and holds no
  canvas colour, so a tile would be the board exactly as it was — a picture
  saying nothing happened beside a sentence saying something did.
- **The answer counts the pages standing on a ground of their own**, which is
  the difference between "the board is dark now" and "the board *looks* dark
  now". A spread whose pages all carry a colour is a repaint the user sees only
  between them, and nothing else in the answer would have told the model that.
- **The description's whole job is the one word between the two tools.** "Make
  that dark" is the sentence for either, and the wrong one paints five pages the
  user was not talking about — so it names `set_page_background` for the case it
  is not, says a page painted its own colour keeps it, and says that this is
  what an unpainted page is drawn on. Agent 8's instruction still never names
  it, pinned by the same test that has pinned it since stage 0.

**The three geometry doors widened to the fourth kind.** The put and the
restyle landed before `remove_from_canvas`, `transform_on_canvas` and
`reorder_on_canvas` knew what a shape was, and each of the three gated on
`type === "image" || type === "text"` — so an agent could draw a scrim, read it
back, recolour it, and never move it, restack it or take it off again. §XI.1's
own sentence is the finding: "a kind that can be listed and not transformed is
the bound-label loop again". All three now ask `readableTarget`, so
addressability has one answer at six doors instead of three. Four things the
build settled:

- **The bound-label refusal has to be asked first.** `readableTarget` drops a
  label, so a `containerId` check placed after it turns the explained dead end
  back into a silent `notFound` — the exact loop stage 0 was for. Transform and
  reorder both ask the container question before the handle question now.
- **A lone shape takes the asked box exactly.** Invariant 6 is written about
  photographs ("making a photo fit a shape is a crop") and a colour block has no
  proportions to preserve: a scrim told to cover the page and *contained*
  instead comes back covering a corner of it, which is §VIII's
  ask-answered-smaller failure arriving at the geometry door. Grouped, it scales
  uniformly like every other member, because reshaping an arrangement is not a
  resize. `stretch` is accordingly no longer image-only — it is redundant on a
  shape and still refused on text and on groups.
- **`size` takes one positive extent, not two.** A rule lengthened is
  `size: [0, 1000]`, and the old "size must be positive" guard refused it. The
  pair-level check now asks for one, and a flat box is refused for an image or a
  line of text once there is a kind to refuse it against.
- **A flat shape is a divide-by-zero everywhere a ratio is taken.** Both the
  transform's own unit scale and `elementPlacements`' fall back to the other
  extent; a zero-width vertical rule scaled by `1` would have moved without
  resizing, and `targetW / 0` spreads NaN into every coordinate below it.

`transform_on_canvas` 491 → **514** for the shape clause on `size`, the boards
shape 14,305 → **14,328** and agent 8's floor 9,974 → **9,997**. The suite
2,664 → **2,677**. `render:check` unchanged (1 AGREES, 4 CLOSE) and still blind
to any of this — no board with a stored export carries an agent-drawn shape.

One live `design:check` on the one real page that has shapes on it, asked to run
a short rule across the card and turn a dark band into a full-page panel: three
rounds, $0.04, one `transform_on_canvas` call carrying **both** of the cases this
change is about — `size: [0, 900]` on the rule, which the old positivity guard
refused outright, and `size: [1000, 1000]` on the 800×520 panel, which contain
would have answered with a square covering half the page. The rule came back
`[490, 50, 490, 950]` with its points scaled to `[[0,0],[972,0]]`, and the panel
`[0, 0, 1000, 1000]`. Both were unreachable an hour earlier: the model would have
been handed `notFound` for objects `read_canvas` had just listed to it.

**`restyle_on_canvas` built.** The sixth tool is `object-restyle.ts`, declared
once in `agent-tools.ts`, executed for agent 6 in `tools.ts` and reached by agent
8 through `tool-canvas.ts` — the module the five already go through, unforked, so
requirement 3 is a fact about the module graph. Batched, capped at
`CANVAS_RESTYLE_LIMIT` 10, revision-guarded on the keyed queue, no-op detected.
Six things the contract above does not say and the build settled:

- **A change is the bucket and a field is the refusal.** `restyled` entries
  carry `{ objectId, set, refused? }`: a change asking `opacity` and `fill` of an
  image sets the opacity and names the fill back on that same entry. The put
  refuses whole because an object landing bare is one the model reasons about as
  though it got what it asked; nothing lands here, and the object keeps what this
  call could not set. A change whose every field is refused is `refused` whole,
  so every change still lands in exactly one of the four.
- **Addressability is `read_canvas`'s answer, asked rather than re-derived.**
  `readableTarget` is exported from `object-read` and this tool calls it, so an
  arrow, a freehand stroke and a zero-extent rectangle are `notOnBoard` here for
  the same reason they are absent there — invariant 13 from the write side.
- **A bound label is refused toward its container**, the dead end
  `transform_on_canvas` already names by hand.
- **A grouped element is restyled alone.** A transform is rigid because a photo
  torn out of its stack is broken; recolouring one chip of a palette is what
  recolouring one chip means.
- **`fontSize` moves the drawn height with it**, and the put's box-derived
  `LAYOUT_TEXT_MAX_FONT` 96 does not reach this door at all — that clamp is a
  property of deriving a size from a box, and there is no box here. *Which makes
  this the door the put's own clamp note now points at* (`canvas.md` §XI.2's
  amendment): a line the put cut to 96 is one restyle away from the size it was
  placed for, at the place it was placed, where the note's original
  `transform_on_canvas` route asks the design to work a size back out of a box.
- **The page refusal does not name `set_page_background` yet**, since a refusal
  pointing at a tool the model does not hold is a round spent on an unknown-tool
  error. It says "the page's own background"; the name goes in when §XI.4 lands.

**Amended — `font` alone is a re-break too.** The `fontSize` bullet above is
half of one rule. The block re-wrapped when the *size* moved and not when the
*family* did, which was right for exactly as long as every face was measured with
one table of Helvetica's advance widths — and that table was wrong about
excalidraw's own default and backwards about the monospace (`canvas.md` §XI.2's
**Built** note, `compositor-v2.md` §VIII's fifth **Corrected** block). So a change
carrying `font` and nothing else now re-settles the breaks and the drawn height
against the family it is about to leave the block in, on a live board: the
monospace body copy on the spec-sheet page above sets **867** units wide in
Cascadia in an 875-wide card, where the same words broken as Helvetica would have
measured 682 and packed on until they overran it by roughly a seventh.

Measured, same project, minutes apart: `restyle_on_canvas` **664** declaration
tokens, the boards shape 13,641 → **14,305**, agent 8's instruction
2,512 → **2,593** and its floor 9,229 → **9,974**. `render:check` unchanged
(1 AGREES, 4 CLOSE) — and it still cannot see any of this, because none of the
five boards with a stored export carries an agent-drawn shape. One live
`design:check` did the whole of "the names have to carry, the scrim is too
heavy" in **one** restyle call, three rounds, $0.03, against the put half's
twelve rounds and $0.17; and asked `fontSize: 96` for type that was at 92, with
512 declared and no clamp in the path, which is §VIII's flaw with nothing left
standing between the ask and the scene.

**Put half built.** `put_on_canvas` now takes `kind: "shape"` and the ten style
fields. What is true today: a shape put names its box
(there is no house rule for where a colour field goes), a shape's box may be
flat (`[465, 430, 465, 570]` is a rule), a `fill` with no `stroke` said lands
with no outline, a `fill` on a `line` is refused toward `stroke`, `colour` takes
no `transparent`, and a field asked of the wrong kind takes the whole put down
rather than landing the object bare — the put has no per-field remainder, which
the restyle will. Out of range is refused rather than clamped, on invariant 7:
`strokeWidth` 0–100, an explicit `fontSize` 12–512 (`CANVAS_TEXT_MAX_FONT`,
a typo guard at a quarter of the largest preset's edge). The vocabulary lives in
one module, `object-style.ts`, which both doors read.

Measured the way §IV's were, same project, minutes apart: `put_on_canvas`
**600 → 1,088** for eleven fields, the boards shape 13,641, and agent 8's
instruction 2,114 → **2,512** for §II.2's type paragraphs — its own floor
8,343 → **9,229**. That is the largest single addition this file has recorded
and the cut order in `canvas.md` §XI.6 now points at the half just built.

**Read half built.** `read_canvas` now answers the fourth kind and the
`unaddressable` remainder; the three tools above are still designed. The
declaration grew by the one paragraph that names them, measured the way §IV's
were (`npm run floor`, same project, minutes apart): `read_canvas` **301 → 364**,
the boards shape 13,090 → **13,153**, agent 8's own floor 8,280 → **8,343**.
Two divergences from §XI.1 the code decided: a text element bound to a
container is counted in the remainder as well (`1 label bound to a shape` —
invariant 13 has no exception for the fifth thing the renderer draws), and a
shape is read on one positive extent rather than two, because a rule is a `line`
with no height and requiring area of it would drop it.

**The page reads widened to the fourth kind.** `inspect_board`'s arrangement,
`get_page`'s blocks and the page a user attaches now carry shapes, through one
opt-in on `boardItems` (`{ shapes: true }`) rather than a widened default — the
readers that place a picture under what is there, seat one in a slot or count
what a board holds all count what they are handed, so a scrim in that list would
be offered to a template as a block to seat. Three things the tables did not
say, each of them a consumer:

- `pageBackground` — the *photograph* standing behind a page — read the element
  at `z === 0`, which with shapes in the list is the scrim under the photograph.
  It now takes the back-most element that is not a shape, which is also what
  makes a page's own ground (§XI.4) safe to put at the back of every page.
- `pageChoiceNote`, the chip under the composer, says "5 blocks" and had to
  count them: the picker and the prompt describing one rectangle differently is
  the failure its own comment names.
- `scenePreview` steps over shapes — a miniature draws a slot's worth of
  picture or of type and `SlotKind` has no third value.

No declaration moved: this is all answer content, so agent 8's floor stands at
**9,997** and the boards shape at **14,328**. The suite 2,677 → **2,693**.
`design:pages` over the 19 real boards reads 47 pages, one of which — the page
two live design runs drew on — now stands at 391% ink with `1 image, 4 shape, 4
text`, and it was the only page in the app whose brief was lying about being
empty. `render:check` unchanged again (1 AGREES, 4 CLOSE); no board with a
stored export carries an agent-drawn shape yet, so fills and strokes are still
untested against excalidraw's own renderer.

**Built after it (the routing), which closes Stage 0.** A page carrying shapes
takes `compose_moodboard` down the edit-in-place branch. It is *not*
`standsAsComposed` answering no — the pictures on such a page are all still
sitting in their slots, and that predicate is asked in six other places that
would have stopped naming the template of a page still standing in it. It is a
second question asked beside it, `pageCarriesShapes` in `page-compose.ts`, reading
the same opt-in `boardItems(elements, { shapes: true })` the page digest does.
Never consulted for a page of its own (`newPage: true` draws it empty), null-page
meaning the whole scene on a board with no page frame, and an arrow does not
count — the three readable kinds are the whole of what is ground.

No declaration moved again: agent 8's floor stands at **9,997**, the boards shape
at **14,328**, and the suite 2,693 → **2,702**. `design:pages` says how large
this decision is today: of 47 pages on 19 real boards, exactly one carries shapes,
so one page in the app routes differently than it did yesterday. `render:check`
unchanged (1 AGREES, 4 CLOSE).

One trap it hands §XI.4: the page background is a `rectangle`, so the day
`set_page_background` lands every page with a ground set is a page "carrying
shapes" — and agent 4 could compose onto none of them, including every page
"Let's Vibes" makes. That exclusion list has to reach this predicate too.

**Built after that (the writes answer for what they left).** The five canvas
writes now report the type they put beyond reading, as `cannotBeRead` on their
own result — `{objectId, ink, ground, ratio, wants, fontSize}` per line, capped
at `CONTRAST_NOTE_LIMIT` three with `cannotBeReadMore` counting the rest, and
`cannotBeReadNote` saying the two ways out. Agent 8's only, on `CanvasToolNotes`'
standing rule: agent 6 places the user's own words in the user's own colours, so
its answers are byte-identical to what they were, pinned by a test.

Four things the build settled that no contract had said:

- **It is a change, not a state.** `get_page` says which lines on a page stand
  too close in colour to their ground (§IV.2). A write says which lines *this
  call* put there — the pairs failing after it that were not failing before.
  A call that leaves a bad pair exactly as bad as it found it says nothing,
  which is what keeps it off every round of a page whose palette holds no
  legible pair at all.
- **All five doors, and the comparison is over the page rather than the argument
  list.** Only one of the five is about colour: a put lays the ink down, a
  restyle sets that ink *or* repaints the block a dozen lines stand on, a
  transform walks a line off the card it was legible on, a reorder puts a block
  between the two, and a removal takes the card out from under it. Naming only
  the objects a call named would miss every one of the last four.
- **Whole pages are read either side, and that is the cheap way.** A page nobody
  wrote to reads identically both ways and yields nothing, so the arithmetic is
  its own filter and there is no set of touched ids to keep in step with five
  writes. It is two `pageRenderPlan` builds per page per write — no font, no
  bucket, no codec.
- **The ids it may name are `readableTarget`'s.** A bound label's pair is real
  and its id is one every canvas door refuses by name, so offering one would hand
  back the loop stage 0 closed, at a sixth door.

No declaration moved: this is all answer content, so agent 8's floor stands at
**10,503** and the boards shape at **15,136**. The suite 2,961 → **2,973**.

Two live `design:check` runs, same ask, same board, minutes apart, say what it is
worth: **with** the note `worst pair 8.4:1, all 13 clear`; **without** it (patched
out) `worst pair 6.1:1, all 13 clear`. Both arms put type in the palette's browns,
both looked, both spent one `restyle_on_canvas` fixing it. The second look was
already enough on this ask. What the door buys is the tail the second look misses:
of 78 designer runs on this database, **0** never call `get_page` and **8** end
with a write nothing looked at afterwards.

**Amended — the geometry read carries what a restyle takes.** The
`read_canvas` paragraph above says "per kind the `referenceId` and title, the
line's words, or the page's name/preset/size", and for a line of type that was
the whole of it: the words and a box, while the sixth tool wrote four fields
onto it and the picture beside the list drew all four. It now returns, on a text
object, the `colour` it is set in and its `fontSize` always, its `font` when the
family is a choice somebody made and its `align` when the type is not set left —
the same absence-is-the-default rule `strokeStyle` and `rounded` already read
by. `opacity` moved off the shape and onto every kind that takes it, which is
the three both style doors write it on: a photograph at 40% is the case
`canvas.md` §XI.2 names first and it was the one the read could never say.

The family is a word rather than excalidraw's integer, `fontNameOf` in
`object-style.ts` — the vocabulary table read backwards, so a name this answers
is a name `restyle_on_canvas` takes. 9 answers `sans` (excalidraw draws 2 and 9
from the same Liberation files); excalidraw's older faces answer `"other"`,
because absent here means the hand family and Virgil is not it.

Measured the way §IV's were (`npm run floor`, same project, minutes apart):
`read_canvas` **364 → 390** (+26 for the type clause and for naming
`restyle_on_canvas` in the read-before-you-write sentence), the boards shape
15,136 → **15,162**, agent 8's own floor 10,503 → **10,529**. The suite 2,991 →
**3,002**. On the 30 boards on this database it is 616 text objects that now say
what they are set in — 57 distinct inks, four families, 12 of the 30 boards
setting more than one of them — and 22 faded elements, every one a rectangle or
a line, so the fade half is latent and the type half was not.

## VII. Many conversations, and clearing one

A project is one conversation and always has been: `ChatMessage.projectId`,
`chat.list` reading that project's last `CHAT_LIST_LIMIT` rows, and
`orchestrator.send` reading the same page back as history before the turn runs
(§IV, "History off the wire"). That was right while a project was an afternoon.
It is wrong now that a project is a gallery the user comes back to for a week,
and it is wrong in two directions at once.

**There is no way to start fresh.** `historyWindow` spends its sixteen messages
and 6,000 characters on whatever was last said in the project, so Tuesday's
argument about a crop is what primes Wednesday's ask about a poster. The only
door out is a new project — which is a new gallery, and the pictures are the
whole point of the one you are in.

**There is no way to finish.** A thread that has served its purpose stays under
the composer forever. Nothing in the app deletes a message; the only thing that
does is deleting the project.

So: a project holds **many conversations**, one open at a time, switched from the
column's own header; and a conversation can be **emptied** without being lost and
**deleted** when it is not worth keeping. Nothing about the model changes — no
new tool, no instruction clause, no declaration byte. The floors (§IV) do not
move, and that is a deliberate property of the design rather than a happy result:
the model never learns that there is more than one conversation, because from
inside a turn there is not.

### 1. The entity

A **`Conversation`** row: `id`, `projectId`, `title`, `createdAt`, `updatedAt`.
`ChatMessage` moves off `projectId` and onto `conversationId`, cascading from it
the way it cascaded from the project.

**The message does not keep `projectId` beside the new column.** Two owners of
one fact is a row that can name a conversation of one project and a project of
another with nothing to say so, and the only thing the denormalization buys is a
join every door already pays for: `chat.list`, `chat.record` and
`orchestrator.send` each begin with an ownership check, and that check now reads
`conversation.project.userId` in the same query it already ran.

**`seq` does not change.** It is a global Postgres sequence and monotonic
everywhere, so it is monotonic within any subset of rows — including one
conversation's. Nothing renumbers, nothing restarts, and a cleared conversation's
next message simply carries a larger number than the ones that are gone. The
index becomes `[conversationId, seq]`; `[projectId, seq]` goes with the column.

**`updatedAt` is what orders the switcher** — the thread you last spoke in sits
at the top, which is the only ordering a user can predict without reading. It is
`@default(now())` and touched explicitly, inside the same write that appends the
messages, rather than left to `@updatedAt`: Prisma's marker fires when the
*conversation* row is written and a turn writes `ChatMessage` rows — and a
rename would bump a thread to the top of a list whose whole promise is "the one
you last spoke in". One extra `UPDATE` on a mutation that already costs seconds
and cents.

**Built:** the timestamp is captured at the *top* of the mutation and passed
down, not read at the moment of the write. A turn runs for ninety seconds and
writes its rows at the end, so a long question asked in thread A before a short
one in B would otherwise sort below B for having committed later. One helper —
`touchConversation(tx, id, at)` in `src/server/chat/conversations.ts` — and a
source-text test (`conversation-doors.test.mts`) holding that only the two doors
that mean *spoken in* call it. `vibes.designPage` deliberately does not: a run
answering its own six pages over twenty minutes is not the user speaking again,
and `vibes.start` already stamped the thread with the moment the form was
submitted.

The alternative — ordering by `max(seq)` of a conversation's messages — was
rejected for one reason rather than for cost: an emptied conversation has no
max, and it would sort last on the day it was cleared, which is the day it is
most likely to be reopened.

### 2. Which conversation is open

**The browser's, not the project's.** Which thread is on screen is a property of
the window looking at the project, and there is no `Project.activeConversationId`
column: two tabs on one project would write it against each other, and the loser
would find its column swapped out from under a half-written message.

So the selection lives in `localStorage`, keyed by project, and is validated
against the list on load — a selection naming a conversation that has since been
deleted falls back to the most recently updated one rather than to an error. A
project whose selection has never been made opens its most recent conversation,
and a project with none opens **the unspoken chat** (3).

**Built, and the paragraph above states the reason wrongly.** `localStorage` is
shared across every tab of one origin, and a `storage` event fires in the others
on every write — so it does not give the per-window property on its own. What
gives it is that the store **never subscribes to that event**: it reads at mount
and is never told about anyone else's choice. The conclusion stands; the reason
is the absent listener, and it is written down in `open-conversation.ts` because
nothing in the type system can hold it.

**One storage entry for the whole app**, holding `Record<projectId,
conversationId>`, rather than one key per project: a key per project is an
unbounded set of entries nothing ever cleans up, and the read is one `getItem`
either way.

**The store keys by conversation.** `chat-log.ts` holds a `Map` keyed by
`projectId` today; it becomes a map keyed by `conversationId`, and everything the
log holds that is not a row — the draft, the picked pages, the in-flight flag,
the error — goes with it. Switching threads mid-sentence therefore costs nothing:
the sentence is still there when you come back, for exactly the reason the draft
was moved out of the component in the first place (§IV, "The client"). The
once-per-session `hydrated` set keys the same way.

### 3. A new chat costs nothing until it is spoken in

**"New chat" writes no row.** The column enters a fresh state under an id the
**browser mints** — `crypto.randomUUID()` at the press — with no conversation
behind it. The first thing said creates the conversation and its messages in one
transaction.

**Built, and this is the one decision that changed under review.** The design
above had the id come *back* from the server: a synthetic `new:<projectId>` key,
the first write opening a row, and the browser re-keying its store onto the id it
was handed. That races, with a permanent and silent consequence.

> No conversations yet. You type a message; the turn runs for ninety seconds.
> While it runs you crop a photo in the properties panel. `recordCutTaken` fires
> `chat.record` with no conversation id, so the server opens **thread B** for the
> note. The turn then finishes and opens **thread A** for the pair. The column
> shows the note; the row is in a thread nobody will open; the model's history —
> read server-side from rows — never carries it again.

Three `chat.record` calls in flight is three threads. So the browser mints, the
store is keyed by that id from the first keystroke, and every write door
**creates-if-absent under an ownership check**. §VII.3's actual property — *no
row until something is said* — is kept whole, and the synthetic key, the re-key,
the double-create and the selection/store split-brain all go with it.

The ownership check is not optional and not an `upsert`: look the id up, and if a
row exists it must belong to this user **and** to `input.projectId`, or it is a
`NOT_FOUND` — otherwise a guessed id writes into someone else's thread. The
create is `createMany … skipDuplicates` (`ON CONFLICT DO NOTHING`) and not a
`create` in a `try`/`catch`, because it runs inside a transaction and in Postgres
a statement that errors aborts the whole transaction: catching the unique
violation would turn a handled race into `25P02` on every statement after it.

Two reasons, and the second is the load-bearing one. A button placed next to a
list gets pressed reflexively, and an empty conversation is a row in the switcher
for a conversation nobody ever had. And an empty conversation has no first
message, which is what it would be *named* by (4) — so it would have to be drawn
as "New chat" beside the other three "New chat"s that were opened the same way.

The consequences are small and they are all on the write doors:

- `orchestrator.send` takes `conversationId`, required. It opens the thread if it
  is not there yet, in the same short transaction that writes the
  `[user, assistant]` pair — after the turn and never around it, so a turn that
  dies still leaves nothing and no Postgres transaction is held open for the
  length of a Gemini call. A thread deleted from a second tab mid-turn is
  therefore *re-opened* by the turn's own write rather than the paid answer
  being thrown away.
- `chat.record` takes it too, on the same terms. An event — a cut taken in the
  properties panel, a board thrown away from an offer — opens a conversation
  when there is none, because a record has to have a home and the note is
  genuinely the first thing said in that thread.
- `vibes.start` opens its own (9), and never writes into whatever thread the
  user happened to have on screen.

**An unspoken thread does not survive a reload**, and pressing "New chat" while
already sitting in one does nothing. The first is right because an empty chat is
not worth restoring; the second because minting a second unspoken thread would
strand the half-written sentence in the first with no row in the switcher to get
back to it.

### 4. Titles

**`title` is empty by default and empty means derived**: the conversation is
labelled by its own first user message — first line, cut at a word boundary,
`CONVERSATION_TITLE_LIMIT` 60 characters, ellipsis where it was cut. Renaming
writes the column, and a written title is the one that shows.

Derived rather than stored-at-creation because a stored derived title is a second
copy of a sentence the user can delete, and it goes stale the moment they do. A
hand-written name survives being emptied — the user wrote it about the thread,
not about the message.

**Built, and the sentence above about `chat.clear` is wrong.** "Clear says
nothing about titles" produces a switcher of identical "New chat" rows, which is
verbatim the state §VII.3 refuses empty rows to avoid — the design would create
by one door exactly what it forbade by another. So `clear` **materialises the
derived title into `title` first**, in the same transaction, before the message
it was derived from goes. The sentence is: *the thread keeps the name it had;
what goes is the record.* A thread with nothing derivable — one whose only
message was a part this build cannot read — is left deriving rather than given a
label nobody wrote.

The cost is that the switcher has to read one message per conversation: the
earliest `role: "user"` row of each, `take: 1` under the list. That is a lateral
join over at most `CONVERSATIONS_PER_PROJECT` (7) rows on an index that exists
for other reasons, and it is the shape that cannot be wrong.

**No model-written titles.** A summarizing call per thread is a real bill for a
label the user recognizes better without it — the sentence they typed *is* how
they remember which conversation this was.

### 5. History is the conversation's

`orchestrator.send` reads its history from `conversationId` rather than from
`projectId`, and that single line is the whole feature: the window is spent on
the thread being asked in.

**What does not become per-conversation is everything else.** The brief, the
gallery, the boards, the pages, the skills — every fact primed before any tool
(§I) — is the project's, and stays the project's. Two threads in one project
compose onto the same boards and see each other's work, because they read the
board rather than the chat. A conversation partitions *talk*, not the project.

This is worth stating loudly because it is the thing a reader will get wrong: a
new conversation is not a clean project, and a picture generated in one is in the
gallery of both. The evidence is on the board, and the board is not a thread.

`chat.list`'s gone-ness read (§IV, "Gone-ness at load") is unchanged in shape —
one bulk existence check over the subjects the conversation's attachments name,
scoped through `conversation.projectId` instead of straight off the row.

### 6. Clearing one

**`chat.clear { conversationId }`** — every message of that conversation
deleted, the conversation kept.

What it does **not** touch is the sentence that matters, and the confirm has to
say it: the boards, the pages, the cuts and the generated pictures those turns
produced all stand. The conversation is the *record* of the work and not the
work. What goes is the words and the tiles above them — which is not nothing,
because after a board is deleted its tile's snapshot is the only place its title
survives (§IV, "Gone-ness at load"), and clearing a thread throws that away for
good.

**From the user's own click, and only ever from there.** There is no
`clear_chat` tool and there will not be one: it would be a tool that deletes the
only account of what the tools did, offered by the thing being accounted for.
Same family as `discard_board` and `discard_reference` — the model may offer, the
user disposes — except that here the model does not even offer.

On the open column, clearing empties the log for that key and leaves the draft
alone. A half-written message is work, and the user asked to lose the record, not
their sentence. It does **not** touch `updatedAt`: a thread emptied today is the
one most likely to be reopened, and sorting it to the top is the reverse of
§VII.1's own argument for what the ordering means.

**Built:** three things hold the same messages in the browser — the store's log,
the store's once-per-session hydration mark, and the `chat.list` query entry —
and any two of them left in disagreement is a resurrection bug. A `clear` without
the `removeQueries` leaves a `staleTime: Infinity` entry holding the exact rows
the server has just deleted, ready to be laid back under the column the next time
it mounts. So they move together, through `useChatCacheReset` — which has a third
caller the design did not anticipate: the **Vibes run panel, after each page**.
`vibes.designPage` writes its assistant row server-side and nothing tells the
browser, so the run's thread — which the switcher now invites the user into
mid-run — would show two rows of seven until a hard reload.

Confirmation is inline two-step arm/confirm, from `BoardTab` and
`RemoveReferenceButton`: there is no modal, no dialog component and no
`window.confirm` anywhere in this codebase, and adding one for this would have
been the largest new thing in the change. Both destructive doors are shut while
that thread has a turn on the wire — the store is module-level, so the header can
read `asking` even though it lives outside the column that started the turn, and
clearing thread B while a turn runs in A is correctly unaffected.

**`chat.remove { conversationId }`** is the other half, and it is not the same
door. Clear empties the seat you are sitting in; remove takes the seat away. The
rows cascade, the switcher loses the entry, and the column falls back to the most
recently updated conversation — or to the unspoken chat, if that was the last
one.

### 7. Limits

`CONVERSATIONS_PER_PROJECT` — the switcher lists the **50** most recently updated
threads. A ceiling on a read and not on the project, exactly as `CHAT_LIST_LIMIT`
is on messages: the fifty-first is still a row, still readable by id, and simply
not in the list the header opens with.

**Built without the union.** The plan had `chat.conversations` return those fifty
∪ whichever thread the client says is open, so a selection that had fallen out of
the fifty could still be named in the header. It cannot be: the open thread's id
lives in `localStorage`, which the server component that prefetches this list
cannot read — so taking it as an input gives the prefetch a cache key the browser
never asks for and costs every load after the first a round trip. It buys nothing
either. The column only ever opens a thread that is in this list, one this session
minted (named from the store), or a fresh one, so there is no thread on screen
this list cannot name; and a selection older than the fifty most recent falls back
to the most recent, which is `openConversationId`'s rule for a selection the list
no longer answers to.

There is no cap on *creating* one, because an unspoken chat is not a row (3): the
reflexive press already costs nothing, so there is nothing to ration.

### 8. The migration

Ordered, and the order is the point:

1. `Conversation`, with the FK to `Project` and `onDelete: Cascade`.
2. `ChatMessage.conversationId`, nullable, FK, `onDelete: Cascade`.
3. **Backfill**: one conversation per project that has messages, adopting all of
   them. `createdAt` from that project's earliest message and `updatedAt` from
   its latest, so the switcher's ordering is right on the first load rather than
   showing every old project as touched at migration time. `title` stays empty —
   the thread derives its own name from its own first message, the way a new one
   does, and no reconstructed label is invented for it.
4. `conversationId` `NOT NULL`; index `[conversationId, seq]`.
5. Drop `ChatMessage.projectId` and `[projectId, seq]`.

One deploy, because this app has one writer and no rolling deploys. If that ever
stops being true it splits at step 4: ship the nullable column and code that
writes both, then flip and drop. Written down here so the split is a decision
rather than a discovery.

**Built as one migration, `20260823170000_many_conversations`** — the first in
this repo to carry data statements. Prisma's own diff for this schema emits one
destructive `ALTER TABLE "ChatMessage" DROP COLUMN "projectId", ADD COLUMN
"conversationId" TEXT NOT NULL`, which fails outright on a non-empty table and,
on an empty one, silently loses which project every message belonged to. So the
file is scaffolded and then that statement is split, the backfill sits in the
middle and the drop moves last. **Every generated identifier is kept verbatim**:
a hand-picked constraint or index name is invisible to `migrate deploy` and then
makes the *next* `migrate dev` generate a phantom corrective migration, because
the shadow database replays the file and diffs the result against the schema.

The honest risk of one deploy: this app is on Vercel, `db:deploy` is a human
step, and a turn runs for minutes and writes its rows at the *end* — so a turn in
flight across the cutover fails at its last statement after doing all its paid
work. The mitigation is that there is one user and no traffic: run it when you
are not mid-turn.

**A migration lands in two places or it has not landed.** `DATABASE_URL` points
at local Docker, so `migrate status` answers about the wrong database and the
suite touches neither — `infra.md` records four days of invisible `P2022
ColumnNotFound` from a migration that only ever reached Docker. Rehearsed against
seeded rows locally (2 projects with messages in, 2 conversations out, 0 nulls),
then deployed through `db:tunnel` to Cloud SQL and counted again: 45 messages, 0
nulls, 2 conversations, dates off each project's own message range, `projectId`
gone.

### 9. The Vibes run gets its own thread *(withdrawn 2026-08-29 — see the end of this section)*

"Let's Vibes" (`compositor-v2.md` §IX) already writes itself into the
conversation — a user row carrying the purpose and one assistant row per page. It
now writes into **a conversation of its own**, opened by `vibes.start` beside the
board.

The run is a thread by any reading: it has one ask, a known number of answers,
and an end. Dropping six assistant rows into whatever the user last had open is
the case multi-chat exists to prevent, and the run is the one place in the app
that writes a conversation without a human typing in it.

Which means the id has to outlive the tab, because `vibes.resume` exists: a run
picked up the next morning must write its remaining pages into the same thread.
It goes on the board — **`Moodboard.conversationId`**, nullable — for the reason
`vibesBrief` is already there: `resume` reads the board and nothing else, and the
board is the thing both halves of the run agree on. (`Conversation.boardId` is
the same edge drawn the other way; it loses to precedent, and to the fact that a
hand-typed conversation is about no particular board.)

**Built with `onDelete: SetNull` written out explicitly**, even though Prisma's
default for an optional relation is already that: the generated SQL would be
right by luck, and `Cascade` here would make "delete this chat" silently delete
the six-page board the run produced — the exact opposite of the one sentence the
clear and delete confirms are built on (6).

**And `designPage` needs a rule for a board whose thread is gone**, which the
design did not give it. Null happens twice: a board composed before conversations
existed, and a board whose thread the user deleted mid-run. It **opens one and
writes it back**. Writing no row would leave a resumed run with no account of
itself, which is the thing `compositor-v2.md` §IX.2 exists to prevent.

**The column does not follow a Vibes run.** The user is watching the panel;
yanking their column onto a thread they did not open is the interruption
multi-chat exists to prevent. The thread is at the top of the switcher, and that
is enough.

The thread names itself the way any other does (4) — its first user row is
`Let's Vibes — <purpose>`, so the switcher reads `Let's Vibes — dusk wedding` with
no title column written.

**Withdrawn 2026-08-29 — a Vibes run gets no thread.** Everything above this
line describes what was built and ran for a week; none of it is live. The
`Conversation`, its ask row, the assistant row per page and the
`Moodboard.conversationId` stamp are all gone (`compositor-v2.md` §IX.2 carries
the amendment).

What the rule got right is that a run is thread-*shaped* — one ask, a known
number of answers, an end. What it got wrong is the step from there to a thread
being *worth writing*: nobody typed in these, nobody read them, and the batch
that followed (`multi-vibes-and-preview-prd.md` §II.3) turned one per run into
one per board, up to twelve per submission, all of them ahead of the threads the
user actually opened. A thread nobody reads is switcher clutter with a write
path attached.

The run's account was never only in the thread, which is why nothing is lost
with it: the purpose is the board's title, the whole brief is on
`Moodboard.vibesBrief` verbatim, and each page's design call is its own
`AgentRun` row — which is what the run panel reads. `Moodboard.conversationId`
stays in the schema, nullable and unset for Vibes boards; the `SetNull` reasoning
above still holds for the column, and nothing writes it now.

### 10. What this is not

Named because each was considered and left out, not because nobody thought of
them:

- **No branching.** "Continue from this message in a new thread" needs a copy
  rule for the tiles above it and an answer for what the tools already did, and
  neither is worth writing before anyone has asked twice.
- **No search across threads.** Fifty titles in a list is a project's worth of
  conversation; a search box over `parts` is a JSON scan and a feature of a
  product with a year of history in it.
- **No sharing, no export.** The conversation is the account of the work; the
  work is already exportable as the thing it is (`canvas.md` §IX).
- **No archive state.** Clear and remove are two doors and that is one more than
  most of this app gives you. A third that hides a thread without deleting it is
  a state the switcher has to explain.
