# AGENT TOOLS

How the agents of tech-spec §III reach the project — what each one is allowed to
call, what an answer looks like, and how that answer reaches the user.

## I. The seam

A **toolset** is a set of declarations to hand a model plus the one function
that runs whatever it calls. It is assembled per request and closed over the
project it may touch, so the project id is never an argument the model can
write — that is the whole access-control story. `src/server/agents/orchestrator/tools.ts`.

A tool answers with a `ToolOutcome`: `result` is the JSON the model reads back,
`attachments` is what the user sees. Two readers, two halves — the model
gets ids and tags, the chat gets thumbnails, and neither is served by being
handed the other's.

Images never cross as bytes. The catalog carries ids; an agent that has to
*look* at a picture is given its `gs://` uri as a file part, from code. Bucket
paths are stripped before anything reaches the model, because a model handed one
will eventually put it in a sentence, and the signed-URL indirection exists to
stop exactly that.

### And no tool answers with less than it was asked for in silence

Every bounded call in this layer truncates rather than refusing — a ceiling here
is legibility or tokens, and a refusal would charge an honest ask a whole round to
find out the number. The rule that makes truncation safe is that **the answer
names what the ceiling cut off**, and three doors were breaking it:

- `show_references` (`SHOWN_LIMIT`, 8). `pickReferences` reported ids that
  answered to nothing and dropped ids that answered to a real picture past the
  limit — so a call naming twelve came back with `shown` of eight, `notFound` of
  none, and nothing to say the other four had been asked for. The comment one line
  above it already stated the rule ("a silent difference between what it asked for
  and what appeared is a reply that describes pictures the user cannot see");
  the failure was arriving through the other door. Now `overLimit`, reported as
  `notShown`.
- `swap_on_board` (`SWAP_LIMIT`, 4 then — 10 now) and `reword_on_board`
  (`REWORD_LIMIT`, likewise).
  Both did `.slice(0, LIMIT)` on the parsed pairs. Six exchanges asked for, four
  made, four listed — under a status reading *"done as a scene edit — every other
  picture on that board is exactly where it was"*. Two cuts the user had taken
  never reached the board and the reply said they had. Now `notMade` /
  `notReworded`, each with a note saying to call again with them rather than to
  report them done, since a second call is free.
- Both parsers also dropped a half pair — `{putOn}` with no `takeOff`, a blank
  `to` — on the correct argument that a misaligned pair is worse than a missing
  one. Correct to drop, wrong to drop quietly: a model that sent three things and
  is answered about two has no way to find the third. Now counted as `unreadable`
  with the note that names the missing end.

Reported on the *refusal* path as well as the success path, which is the branch
that matters more: "nothing on that board changed" is a confident sentence, and a
request that never ran reads to the user as one that was tried.

That closes the sweep. Every remaining cap in the layer already says what it left
out — `referenceCatalog` carries `total` beside `shown`, `currentBoardBrief` says how
many boards the project holds beside the one it names — and names the tools that
reach the others, which is the stronger version of the same rule: a cap that only
*says* what it left out still leaves the model with no way to get it, `layoutBlocks`' two caps are
reported as `notOffered` and `linesNotOffered` (§IV) — so there is no bound in the
tool layer the model is not told about.

### And no picture is described as plain when nobody has read it

The sweep above is about what a ceiling cut off. There is a second silence with
the same shape and no ceiling in it: **a photograph with no tags**.

Agent 2 runs out of band. `reference.add` files a QUEUED `AgentRun` in the same
transaction as the row and a worker claims it later, so a user who uploads
eight frames and asks for a moodboard in the same breath is asking about pictures
whose tags have not landed. `digestTags` answers `undefined` for a reference with
no `Analysis` row, `referenceDigest` omits the field, and the line came out:

```
ref-7 · Ridge · 4:3
```

Which is exactly the line a picture agent 2 *did* read and found nothing worth
saying about produces. One blank, two meanings, and the model reads the wrong
one: it answers "that one is fairly plain — no strong colour or light" about a
photograph nobody has looked at. Every downstream consumer inherits it —
`compose_moodboard` hands the compositor a block with no tags, and agent 4's whole
judgement is tag adjacency ("two references sharing a palette read as one idea
when they touch"), so the board is composed on shape alone under a reply that
describes a reading.

Four decisions:

- **Three reasons, not one flag.** `pending` (a queued or running job) arrives on
  its own; `failed` and `never` do not, and are the two the note has to give a
  next step to (below). A single "unread" mark would have the model telling them
  to wait for tags that are never coming — the one way this can be worse than the
  silence it replaces. `unreadReason` maps the latest run's status; `SUCCEEDED`
  maps to *null*, because a succeeded run wrote an `Analysis` row, so a succeeded
  run beside no properties is a picture the model found nothing in.
- **The mark is on the line, the explanation is under the list.** Three or four
  tokens per marked line (`· not read yet`) against one sentence carried once, and
  neither is paid by a project agent 2 has finished with — the note is emitted
  only when something is marked, and the "will have tags in a moment" and "will
  not get tags on their own" clauses only when the project is in those states.
  An unmarked line with no tags therefore means what it should: read, nothing
  found.
- **The read is a second query, and it is gated on there being a blank to
  explain.** `unreadReasons` runs only when some row has no analysis, so the
  commonest turn — a user talking about pictures uploaded yesterday — pays
  nothing for it. That is the same rule the board priming follows: a priming read
  is affordable only while it is cheap in the common case — which is why it now
  reads one board rather than all of them.
- **`compose_moodboard` says it after the fact too.** `notReadYet` names the
  pictures the compositor was given with nothing to reason about, with a note that
  they were arranged on shape alone and that the board can be laid out again once
  the tags land. The board is still filed — a picture with no tags still has a
  shape, and shape is most of a layout — so this is a caveat on the reply, not a
  refusal. `list_references` carries `UNREAD_CATALOG_NOTE` on the same terms,
  since it is the one door that lists *cuts*, and a cut filed a moment ago is as
  unread as a photograph uploaded a moment ago.

The general rule, which is the one §I above states about ceilings pointed at a
different mechanism: **an absent value and an unknown value are not the same
value.** A cap that truncates, a parser that answers null (iteration 40) and a
column that has not been written yet all reach the model as the same nothing, and
the model reads every one of them as a fact.

### And the one thing the user said themselves is not kept from the model

Everything in a digest so far was read *off* the picture: the shape is arithmetic
on two columns, the tags are agent 2's reading, and the title now is too — agent
2 writes a few words for what the picture is *of* onto `Analysis`, so the name on
a catalog line is the uploaded filename only for a picture nobody has read yet.
(See `orchestrator-tool-reference.md` §III, *Titles*, for why that column and not
`Reference.title`: a generated name on the reference row would make an unread
picture indistinguishable from a read one.)
There is exactly one field in the `Reference` row the **user** wrote, and it
was the one field the tool layer did not select — `isFavorite`, the star in the
gallery and the lightbox.

It was not merely absent. `GALLERY_ORDER` is `[{isFavorite: "desc"}, {createdAt:
"desc"}]`, and the brief is built off that read, so the model was being handed a
list *ordered by a fact it could not see* — and, when `CATALOG_LIMIT` bit, a
truncation that kept the starred ones for a reason it was never told. The head
said so wrongly on top of that: "The 24 most recent", of a slice that is the
user's picks first and the newest of the rest after them.

Four decisions:

- **A word on the line, present or absent, never false.** `· starred`, placed
  ahead of the shape rather than after the tags, because the tags are a comma
  list and a word appended to one reads as another tag. `favorite: false` on
  twenty-three lines is the tokens of a fact nobody needed.
- **The head describes the order it truncated in.** `starred first and then
  newest`, or plain `newest first` when nothing is starred — the sentence exists
  to say which photographs are *not* on the list, so it has to name the rule that
  decided.
- **One sentence under the list, and only to a project that has a star**, on the
  terms `unreadNote` established: what the mark is (their own pick, not anything
  read off the image), what to do with it (prefer it when choosing what to show or
  what goes on a board, give it the largest slot), and that the assistant **cannot
  star or unstar** — that is the user's. A model that thinks it can set the
  signal will report having set it.
- **It reaches agent 4 as a block field, not as prose.** `BlockBrief.favorite`
  rides through `referenceDigest` → `briefOf`, and the compositor's instruction
  gains one bullet: a starred block outranks anything read in the tags, takes the
  largest slot that suits its shape, and is never the block the compositor leaves
  off. That is the whole point of carrying it — "which picture is this board
  *about*" is the question the largest slot asks, and the user had already
  answered it.

The general rule this one adds to §I's family: **an ordering the model cannot see
the reason for is a fact withheld from it.** The three silences above are values
that were cut, that failed to parse, or that had not arrived; this is a value that
was never asked for, and its cost is not a wrong sentence but a judgement made by
proxy — agent 4 deciding what the board is about from tags a machine read while
the user's own answer sat one column away in the same table.

### And the thing the whole project is *for* is not the one value with no reader

The star above is the user's judgement about one picture. There is a column
holding their judgement about the **whole project** — `Project.brief`, in the
schema since the first migration, doc-commented as "a user's working session:
a brief" — and after fifty iterations of priming it had no reader and no writer.
`project.create` accepted it; the only form that calls create sent `brief: ""`.
The workspace header rendered it; there was nothing that could ever put a
character in it. No agent selected it.

So the orchestrator, whose entire opening instruction is *help them articulate the
look they are chasing*, was routing every turn without the paragraph in which the
user had already articulated it. Agent 4 chose what a board argues from tags;
agent 3 framed a cut from an intention typed into one message. The standing intent
behind all of it was one `SELECT` away and no query asked for it.

Four decisions:

- **First in the priming, not last.** `projectBrief` opens `tools.brief()`,
  above the catalog and the boards. The catalog is a list of what the user
  *has*; the brief is what they have it *for*, and every line under it is read
  against it. Ordering is the cheapest way to say which is which.
- **The title is said either way; the note is not.** A project with no brief gets
  one sentence naming it and saying there is no brief — closing §I's silence for a
  handful of tokens, and naming the project is itself a word the user chose.
  What it does *not* get is the paragraph explaining what a brief outranks: that
  is prose about a value the project does not have, paid on every model call of
  every turn. Same gate as `starredNote` and `unreadNote`.
- **Cut at 1,200 characters, on a word, out loud.** The column holds 5,000, which
  is ~1,250 tokens on *every* model call — a third of a turn's measured ~3,800
  base, on turns that never mention the brief. But §I's rule holds: the cut is
  reported (`the first N characters of a longer brief`), because a user's own
  words silently halved is the model answering from half a brief while believing
  it read one.
- **Three things the text cannot say about itself.** That it outranks anything
  read off a picture when deciding which references matter; that *this message
  wins* where the two disagree, since a user asking for something the brief
  does not mention is changing their mind rather than making a mistake; and that
  the assistant **cannot write it** — the same rule the star needed, for the same
  reason (a model handed a signal with no way to set it reports having set it).

And the writer, which is the half that makes the reader worth anything:
`project.setBrief` (ownership in the `where` of an `updateMany`, so someone
else's id writes nothing and reads as a 404) behind an editable paragraph in the
workspace header — with the line *the assistant reads this on every message*
beside the save button, because a user who does not know it is read writes
nothing worth reading.

The general rule: **a column with no writer is not an unused feature, it is a
value the product asserts exists.** The header rendered `brief || "No brief
yet."` for fifty iterations, which is a promise; the star was a signal the model
could not see, and this was a signal nobody could send.

### And a mark the model can read is a mark it can act on

The three unread marks above told the model why a picture had no tags and what
would happen next. For two of the three the answer was *nothing* — a reading that
failed, and a picture nobody ever queued, do not arrive on their own — and the
next step the note gave was "the user can ask for the analysis again from
that reference's properties panel". A capability the assistant could see, name,
and not reach. `read_references` is that door: **agent 2 as an agent-tool**, and
the first tool in the list that is answered by another agent the reply does not
wait for.

The whole of it is filing jobs. The analyzer is a queue — a job is an `AgentRun`
row a worker claims out of band — so the tool files one per picture and wakes a
worker, exactly as `reference.requestAnalysis` does from the panel. Four
decisions in it:

- **Nothing in the answer carries tags, and the status says so.** Every other
  tool here answers the question it was called about. This one answers "I have
  asked", and a model that reads it as "and now I know what these look like"
  writes a paragraph about a picture nobody has read — the exact failure the
  marks were added to prevent. The declaration says it before the call and the
  status says it after.
- **The decision is made off the marks the model was shown, not off a second
  read.** A picture with no mark has been read (tags are the evidence), and
  "pending" is the queue saying a job already exists. So the tool re-reads
  nothing: an id the model was told is "never read" is one this queues, which is
  what makes the answer explicable. The one thing the marks cannot see is a job
  the *user* filed from the panel during this turn, which costs a duplicate
  reading of one picture and nothing else.
- **The worker is woken even when nothing was filed.** That is the panel's own
  rule and it is not a formality: a run left `RUNNING` by a worker that died is
  reclaimed once its lease is up, so an already-queued picture is one that needs
  a worker rather than another job.
- **The ceiling is counted across the turn, not per call**, and the set that
  counts it is also what stops a model naming one picture in two rounds from
  buying two readings of it — the shared reference read is taken once per turn,
  so its marks never learn about a job this turn filed. Both halves of a bitten
  ceiling are reported as one `notQueued` list, per §I above.

The declaration is gated on `stalled` — pictures marked "could not be read" or
"never read" — rather than on every unread picture, because one merely waiting
its turn arrives without anybody asking: declaring the schema for it would be a
cost paid on every round of the one window in which nothing needs doing. The
instruction's own sentence is gated identically, so the floor of a turn does not
move on a project agent 2 has finished with, and the model is never pointed at a
call it was not given.

The pictures on their way go in the chat as reference tiles, which open the
gallery at that picture — where the analysis actually shows up.

**The door is closed again, deliberately.** `read_references` no longer files
anything: it returns the properties agent 2 already wrote, and the whole of them
(below, and `orchestrator-tool-reference.md` §III). So the capability this section
was written to reach is back where it was — a re-reading is the user's own,
from the properties panel — and every sentence above that told the model to call
for one now says that instead.

Two things are worth keeping from the argument even so. The marks stay three, for
the reason they were three: a queued run arrives on its own and a failed one does
not, and one word for both would have the model promising tags that are never
coming. And the *next step* stays in the note, because a mark with no next step
is a fact the model can only repeat. What changed is which of the two failures is
worse. A next step the assistant cannot take is a sentence the user reads as
a shrug; a next step that names a tool the turn was not handed is a round spent
finding that out and a reply claiming a reading was asked for. The second is
worse, so the note names the panel.

### And a job that was filed is never reported as a job that failed

The tool above does two things and only the first of them is the work. Filing a
job is what puts a picture on agent 2's list; waking a worker is an optimisation
over the scheduled drain (infra.md §XIII), which empties the queue whether or not
anybody knocked. They were wired as one operation, so the optimisation could sink
the work:

- `kickAnalyzerWorker` registers the drain with `after()`, and `after()` **throws
  outright** when there is no request to run after. Every caller that is not a
  round trip is in that position — the command-line harness, a cron tick, any
  future background turn. The throw came *after* the jobs were filed, so
  `read_references` returned to the model as an error while the pictures were
  already queued. The model's only sane next move is to tell the user it
  failed, or to ask again — which files the same readings a second time and buys
  each of them a second vision call.
- The same shape one layer down: `enqueue` was awaited inside the loop with
  nothing around it, so a queue that refuses the sixth picture threw away the
  answer about the five already filed.

So the two are now told apart in both directions. `kickAnalyzerWorker` answers
**whether a worker was woken** rather than throwing, and a failed enqueue is
caught per picture and named as `couldNotQueue` beside the ones that went. The
status has three readings instead of two, because "in a moment" is a promise:

| what happened | what the model is told |
|---|---|
| jobs filed, worker woken | reading them now, in the background |
| jobs filed, no worker startable | queued, waiting to be read — do not promise the tags in a moment |
| nothing to file | nothing was sent to be read |

This is §I's rule read from the other side. Everywhere else in this file the
danger is an answer claiming *more* than happened; here it was an answer claiming
*less* — and the cost of that one is paid in vision calls, since the remedy the
model reaches for is to ask again.

It also makes agent 2's door reachable from the harness for the first time.
`npm run smoke -- --drain` runs the queue once the conversation is over, so the
one tool whose agent the reply does not wait for can be watched to the far side:
two queued readings drained live at 2,016 in / ~300 out each, $0.02 the pair,
with both `Analysis` rows written and the tags appearing on the next turn's
brief.

Both halves of this section outlived the tool. `read_references` files nothing
now, so `kickAnalyzerWorker` answering instead of throwing is the *upload* path's
correctness — `reference.add` and the panel's own ask are its callers, and every
one of them is a round trip that `after()` is happy with except the harness. And
`--drain` is still the only way a harness run sees agent 2 to the far side: the
readings it drains are the ones an upload filed, and without it every picture in
a smoke conversation answers `read_references` with nothing stored.

**One picture answers it with nothing stored and something to say.** Since
`generate_image` landed, a `read_references` answer also carries `drawnFrom` —
the description a drawn picture was made at, off `Reference.generationPrompt` —
on a `read` line beside the analysis and on a `notRead` line instead of one.
The model's conversation window carries text and no tool calls, so the words it
drew a picture at are gone by the next turn and the row is the only copy; a
variant of a drawing is asked for from this and nowhere else. It is the one
thing this door says about a picture nobody has read, and it is not a
description of the pixels — it is a quotation of the ask.

### And two tools in one round do not edit one board at once

The orchestrator runs every tool a round asked for with `Promise.all`, which is
right for the reads and for two crops of two different frames. It was wrong the
moment two of those calls named the *same board*.

Every board write in this layer is a read, a decision and a revision-guarded
`updateMany`: `swap_on_board`, `reword_on_board` and `compose_moodboard`'s four
branches. Run side by side they both read the same revision, one write lands and
the other's guard matches no row — so the losing tool answers *"that board was
changed while I was editing it — the user has it open, so tell them and ask
again"*. Nobody had it open. The turn collided with itself, the edit the user
asked for was lost, and the sentence they were handed to explain it was untrue.

This is not a hypothetical shape of call. "Swap those two around and fix the typo
in the headline" is one message, two free tools and one board, and iteration 24
recorded the model emitting two calls in a single round with identical millisecond
timestamps. The most expensive version of it is worse: `compose_moodboard` has
already paid the compositor by the time its write is refused, so a lost race is a
FAILED run row with real spend on it.

`keyedQueue` (`src/lib/util/keyed-queue.ts`) is the whole fix — one task at a time per
key, held on the toolset, keyed by `boardId`. Three decisions in it:

- **Keyed by board, not the round.** The calls worth running side by side are the
  expensive ones — two crops are two vision calls with nothing between them — and
  serialising the round would make every turn answer at the speed of its slowest
  tool. Two boards edited in one round still run together.
- **The read moves inside the queue, not just the write.** Serialising the
  `updateMany` alone would fix nothing: the second edit would still have decided
  what to write from the scene as it was before the first. The whole tool runs in
  turn, so the second reads the board the first left behind — and both edits land.
- **The revision guard stays exactly where it is.** It is for the user's own
  tab, which a queue inside one request cannot see and must not pretend to. What
  the queue removes is the conflicts a turn generates against itself, which is
  what makes the guard's message true on the one occasion it now fires.

`inspect_board` is deliberately not queued: it changes nothing, and making a read
wait behind a compositor call is a turn that answers slower for no gain.

## II. Which tools which agent gets

| Agent | Tools | Why not more |
|---|---|---|
| 2 analyzer | none | one vision call, one schema out; it is given the image and answers |
| 3 cropper | `crop_image` (Pillow-equivalent, deterministic) | the model returns `box_2d`; the cut is arithmetic, so the only tool it needs is the one that does the arithmetic |
| 4 compositor | none | assignment only — blocks and slots in, `[{blockId, slotId}]` out; the Excalidraw elements are built by deterministic code from the slot constants |
| ~~5 presenter~~ | — | **not an agent as of 2026-08-23** (tech-spec §III.5). A deck is one slide per page: the board already made every judgement a deck could make, so the Slides call is a mapping and lives in `src/server/decks/`, reachable from agent 6 as a `FunctionTool` |
| 6 orchestrator | `list_references`, `show_references`, the free board reads and edits, `generate_image` and `build_deck`, then agents 2–4 and 8 as agent-tools | it routes; every judgement it has is another agent's, and everything else is a function |

The rule the table encodes: **a model emits judgement, code emits pixels and
coordinates.** Agent 3 says which rectangle, not which pixels. Agent 4 says
which slot, not where the slot is. Every tool below the orchestrator is
therefore deterministic, and every one of them is cheap.

The orchestrator's row is the set it can *ever* have. What it is handed on a
given turn is narrower, because a declaration is paid for on every round of every
turn and a tool this project cannot call is that spend for nothing —
`orchestratorTools` gates the list on three counts (photographs, cuts, boards)
and `orchestratorInstruction` cuts the matching prose. Before the first upload it
gets one of twenty-eight — `generate_image`, the one tool that needs no id and the
one whose call is how a project stops being empty; before the first board it gets
seven — and five of those seven
are built for the project as well, so a declaration offers no parameter and names
no other tool that this project has nothing to call it on. See §VI.

### Orchestrator, in order of arrival

0. *The project itself, before any tool.* It opens with what the user called
   the work and the **brief they wrote for it** — the *project brief*,
   `projectBrief`, off two small
   columns, above everything else because everything else is read against it, and
   carrying the one paragraph the text cannot say about itself: that it outranks
   what agent 2 read, that this message wins where the two disagree, and that the
   assistant cannot write it (§I). A project with no brief gets the title and one
   clause saying so, and none of the paragraph. Then the photographs are primed into the
   system instruction as one line each — id, title (agent 2's name for it, or the
   filename it was uploaded under while it is unread), shape, what it keeps, agent
   2's tags, or the reason there are none — by `catalogBrief`, off the same read
   the tools use, and the
   project's **current board** beside them by `currentBoardBrief` — id, name,
   page size, page count, page names — plus the number of boards the project
   holds in all. One board rather than every board: the priming names the one
   the user has open, and the rest of the project is reached through
   `list_boards` and `get_board_brief`
   (`orchestrator-tool-reference.md` §II.3, §III). **Done**, and it is the
   cheapest change in the file: see §VI.
   A photograph agent 2 has not read yet carries a mark saying so rather than an
   empty space where the tags go, because the empty space is what a picture that
   *was* read and found plain also looks like (§I). A photograph the user
   **starred** carries that too — the one field on the line they wrote themselves,
   and the one that already decided the order the list is in (§I).
   There *was* deliberately no `list_boards`, on the argument that a further
   declaration is tokens on every round of every turn while the ids a turn needs
   are already in the priming. That argument held only while the priming carried
   every board. Now that it carries one, the ids of the rest have to come from
   somewhere, and a board the model cannot name is a board it will confidently
   rebuild as the one it *was* told about — so the two tools are the door the
   old cap never had. Measured: the declarations cost +329 tokens and the
   sentence naming them +95, against 262 saved on the priming, for +162 (+1.1%)
   on an eleven-board project and less on every board past that
   (`orchestrator-tool-reference.md` §III). The scenes are still never read for
   this — a board's elements are up to two megabytes each, and both tools answer
   off the same four digest columns the priming is built from.
1. `list_references` — the same catalog as a call, and the door to every picture
   and its properties: the photographs *and* the crops, which are the one thing
   priming does not carry and are now in the answer unless the call asks them
   out. Capped at `CATALOG_LIMIT`, with the total said separately so a truncated
   list is not read as the whole gallery. Gated on there being a picture at all
   rather than on there being a cut — the priming makes its answer a repetition
   for the first `CATALOG_LIMIT` photographs, which is a reason for the model not
   to spend a round on it rather than a reason to withhold the door. **Done** —
   see `orchestrator-tool-reference.md` §III.
2. `show_references` — put named pictures in the chat beside the reply.
   **Done.**
3. `crop_reference` — agent 3 as an agent-tool. Input: one reference id — a
   photograph, or **a cut the user wants changed**, which is asked of the frame
   that cut came out of with its box attached rather than cropped again (a box
   inside a box can only take less of the photograph, and the version of a version
   it filed had no way into the panel) — an
   intention, an optional shape — *any* ratio the user names, said as
   width:height, rather than one of six, **or a loose shape said as a word**
   (`square`, `landscape`, `portrait`, `rectangle`), which is framed around the
   subject rather than cut to a ratio they never asked for — and optionally the
   **board the cut is for** —
   a board the picture it would replace is already on, whose slot the cut is being
   made to fill.
   Naming the board holds the cut to that slot's *exact* shape rather than to one
   of the six named formats, which is the only way the widest openings any
   template makes can be filled at all. Answers with an *offer*, not a version,
   and attaches it; an offer that names a board takes that picture's place on it the
   moment the user accepts the cut, so there is no `swap_on_board` left to
   call. Whichever way the shape was said, it rides the offer into the properties
   panel and onto the filed row, so the review says it, a nudge is asked at it and
   a later nudge of the row still is. Without a board the answer names the boards
   the cut's own picture is **standing on**, since taking an offer changes no
   canvas and a model told nothing swaps the picture that already exists on
   instead. **Done** — see §V.
4. `discard_reference` — the picture they want out of the project, put in front
   of them with a Remove button on it. Not an agent, not a model call and **not a
   delete**: the picture comes off the shared read, the boards are one query, and
   the row goes when the user presses the button. The same argument
   `discard_board` rests on (below) with a longer reach — deleting a photograph
   deletes every cut made of it, and every board showing the frame or one of
   those cuts is left with a hole — none of which the model can see, so all three
   are in the answer. **Done** — see §IV.
5. `read_references` — the whole of what agent 2 wrote about a named picture.
   Input: `referenceIds`. Not an agent and not a model call — one read off the
   references the turn has already taken — and what it carries that nothing else
   does is the **palette**, the **rationale** and the tags under **each dimension's
   own name**: `digestTags` flattens the five into one list and drops both of the
   others, which is right for a list of every picture and wrong for the one
   picture the user is asking about. A picture with no analysis is left out of
   the answer rather than described in it, and named beside it, because every
   field would come back empty and an empty palette reads as a picture with no
   colour in it. It used to be agent 2's door instead — it filed a job per picture
   and woke a worker, and it was the one tool here that answered "I have asked"
   rather than the question — which put the marks' next step in the assistant's
   reach for the first time and is the one thing this change gives back: a failed
   or never-read picture is re-read from the properties panel again. **Done** —
   see §I and `orchestrator-tool-reference.md` §III.
6. `inspect_board` — what a board holds, read off its own scene: the pictures in
   reading order, the lines set on it, the page, and — for a board still standing
   as it was composed — which pictures sit loosely in their slot and the shape a
   cut of each would have to be. Not an agent and not a model call — one query —
   and it exists because without it the only way to find out what is on a board,
   or whether it fit, was to rebuild it. **Done** — see §IV.
7. `duplicate_board` — a second board holding exactly what one they already have
   holds, with the original left untouched. Not an agent and not a model call —
   one query and one write — and it exists because every other door in this list
   changes the board the user is looking at, so "keep that one and try it with
   the tall shot" had no honest answer at all: a rebuild replaces the arrangement
   that works, and a new board pays the compositor to re-decide every slot from a
   set the model had to read off the board and restate. The copy carries the
   template as well as the scene, so it is still a board something can be measured
   against. **Done** — see §IV.
8. `discard_board` — the board they want gone, put in front of them with a
   Discard button on it. Not an agent, not a model call and **not a delete** —
   one query, and the row goes when the user presses the button. It is the
   only tool here that offers where it could file, and the reason is not
   mechanical like agent 3's: nothing stops the server deleting the row, and what
   stops it is that this is the one act in the project nothing can undo. It
   exists because `duplicate_board` gave the assistant a way to multiply boards
   and none to clear one up, so "bin the first one" routed to a rebuild of the
   board they wanted gone. **Done** — see §IV.
9. `swap_on_board` — one picture in the place of another, on a board that is
   otherwise left exactly as it is; and, when both are pictures the board already
   holds, the two **trading places**. Not an agent and not a model call — a scene
   edit, revision-guarded — and it is the last step of the crop→board loop, which
   until now went through a rebuild that reflowed the whole board to move one
   picture. **Done** — see §IV.
10. `reword_on_board` — one line of text on a board said differently, with the
   line keeping its place and every picture keeping its slot. Not an agent and not
   a model call — the same scene edit `swap_on_board` is, revision-guarded — and
   it exists because the only previous route to changing what a line *says* was
   `compose_moodboard`'s add/remove of captions, which is a rebuild that reflows
   the board. **Done** — see §IV.
11. `compose_moodboard` — agent 4 as an agent-tool. Input: intention, the
   references to consider, optional lines of text and an optional template, and
   optionally a `boardId` — a board to **rebuild in place** rather than a new
   one to file, with `addReferenceIds`/`removeReferenceIds` for changing which
   pictures are on it without having to name the ones it already holds, and
   `addCaptions`/`removeCaptions` for the lines of text on the same terms — a
   rebuild keeps the lines the board carries rather than writing them from the
   call, which is what used to delete a headline on a call about a photograph —
   and a
   rebuild keeps the template the board was composed at unless it has run out of
   room for the pictures — and `boardId` with a `title` and nothing else is a
   **rename**, which writes the name and leaves the arrangement alone rather than
   paying the compositor to re-decide it — and add/remove of a picture *or* a
   line on a board the user has **arranged themselves** is a scene edit rather
   than a rebuild, since there is no template to reflow into and a rebuild would
   invent one over their arrangement — while on a board that is still **standing in
   its template** the same add/remove keeps every picture in the slot it is in and
   asks the compositor only about what is joining, so a call about one photograph
   moves one photograph and a removal costs no model call at all. Answers
   with the board id, whether it was rebuilt or filed, what it placed and what it
   could not — including a line the *named* template has no block for, since
   seven of the ten carry no text at all and a headline dropped by that comes back
   in the same word as one the compositor chose to leave off — which pictures sit
   loosely in their slot and the shape a cut of each would have to be, and
   attaches the board. **Done** — see §IV.
12. `build_deck` — a `FunctionTool`, not an agent-tool (tech-spec §III.5). Last,
   and only once a board exists. One slide per page in preview order — the
   board's stored `previewOrder`, which defaults to reading order
   (multi-vibes-and-preview PRD §III.5/§III.7) — each
   carrying that page's cached render and its references' analyzer tags as
   speaker notes. No model call anywhere below it, which is why it is the one
   entry in this list whose failure mode is an API error rather than a refusal.
13. `generate_image` — the `IMAGE` model as a tool, and the first in the list
   that makes a picture rather than reading, cutting or arranging one. Input: a
   description, and an optional shape said the way `crop_reference` says one.
   The bytes come back server-side, so unlike agent 3 it does not stop at an
   offer: the PNG lands in the project's own prefix and is filed as a reference
   row — `origin: GENERATED`, agent 2 enqueued — in the same shape the web
   import files one, and the id in the answer is usable by `put_on_canvas` and
   `compose_moodboard` in the same turn. It exists for the picture the gallery
   never holds — the background behind a composed page — and the instruction
   holds it behind the gallery wherever there is one: a photograph that fits is
   preferred over a picture nobody took, and a reply says when a picture was
   generated rather than passing it off as found. The empty project is told
   neither by the instruction nor by the declaration, since it has nothing to
   prefer; the project holding only its own drawings is told the same thing for
   the other reason — reach for the one you drew rather than paying the dearest
   call here to draw a different picture of the same description. Ungated, so it is the one declaration an empty
   project carries, and the picture it files is resolvable by the tools that
   arrange pictures on the next round of the same turn. **Done** — see
   `orchestrator-tool-reference.md` §III (build divergences in its §IV) and
   tech-spec §III.7.

## III. How a result reaches the chat

A `ChatAttachment` carries what it takes to draw the result *and* what it takes
to walk to it. It is a union of two kinds, because there are two kinds of
result — each of which can also carry a question about itself:

- **reference** — thumbnail, caption, and the frame it was cut from.
- **board** — the board id, how many photographs are on it, *what it says*, in
  what shape, the *arrangement itself*, and a cover behind it. One board has one name: the
  template it is standing in ("6 photographs · Hero left") for as long as every
  picture is still in a slot of it, and the page ("6 photographs · 1920×1080")
  once the user has moved one — the same caption whether the tile came from
  the compose that made it, a read of it, a swap the model made, or the swap
  `crop_reference` makes when it files a cut for that board. The rule lives in one
  place (`boardShown`) because a dozen doors now draw this tile, and the one before
  it drifted for four iterations while the reason for its branch went stale.
  A board has no picture of its
  own until a tab has drawn one (`renderUri` is written by the browser), and the
  cover — the photograph the compositor put in the opening slot — is the fallback
  for a board with nothing placed on it.
- **board, with the question on it** — the same tile, plus `discard: true`. A
  board offered for discarding is not a fourth kind: same id, same key, same
  arrangement, same click into the tab row, because what is being decided is
  precisely whether to keep *that*. The flag is what puts the Discard button
  under it — outside the tile, since the tile is itself a button and the board
  stays openable while the question is up, which is most of how the question gets
  answered.
- **reference, with the question on it** — the same tile, plus a `discard`
  payload. Same argument as a board's, and the payload is two numbers rather than
  a flag for one reason: after the row is gone there is nothing left to ask how
  many cuts went with it or which boards it was holding up, and the note the
  conversation gets is written *after* the delete. It is drawn wide, which no
  other reference tile is, because it is a decision rather than one of the
  project's pictures.

**A cut arrives as an ordinary reference tile.** `crop_reference` cuts the pixels
on the server and files the row, so by the time the answer reaches the chat there
is a picture in the project to point at: an id, a thumbnail of its own bytes, the
caption and the frame it came out of. That is `attachmentOf(<the cut>)`, the same
call `show_references` makes of any picture, and it is why there is no crop kind
in the union.

There was one, and it was the only attachment that ever carried a thing the
project *could* hold rather than a thing it held — the frame's own thumbnail, the
four numbers of the box, and the whole `CropOffer`, because there was no row to
fetch the cut back from and asking again would have been a second vision call to
arrive at a box the chat was already drawing. The tile blew the frame's thumbnail
up inside a box of the cut's shape until only the kept region was in it
(`cropPreview`: a scale and an offset in percent, both axes scaled independently
so the region came back out at the frame's own ratio). It was an honest picture of
a decision and it is a worse picture of a cut than the cut — and a soft one, since
a box keeping 4% of a frame is ~130px of a 640px thumbnail drawn at ~170px wide.
Real bytes retired all of it (§V).

**A cut the user made themselves comes back.** The tool's own cuts are in the
chat already — it filed them, and the reply is written beside them. The properties
panel is the other door and it is out of the conversation's sight: a user who
frames a box there by hand leaves the chat holding a project it can no longer
describe, and the assistant's next step (put the cut on the board in place of the
frame) would begin with an id nobody had said out loud.

`cut-taken.ts` is that return. When the user keeps a cut, the chat gains a line —
the cut's id, the frame's id, what it keeps and at what shape — and the cut itself
under it, drawn from its own bytes and clicking through to the frame *at* that
row. Three things decide the shape of it:

- **It is an event, not a state.** The cross-column channels beside it —
  `reference-inspection`, `board-selection` — answer "what is being pointed at
  now", so they are stores a late reader can read. A cut being taken happens once
  and reading it twice would say it twice, so the client half is a listener set
  with nothing to read: `announceCutTaken` calls whoever is listening and it is
  gone. The cost is a note lost if the chat is not mounted, which is the right way
  round — a note arriving an hour later, under an answer about something else, is
  worse than no note.
- **It is the user's turn on the wire and a note on screen.** The model has
  to read it as new information rather than as its own claim, so it rides up as
  a `user` turn in the history; the user did it with their hands rather than
  by typing it here, so it is drawn as a muted line and not a bubble.
- **Every kept cut, not only the ones the chat asked for.** It was the other way
  round while the chat could offer a crop: the note rode a flag set when an offer
  was adopted, because narrating a box the user framed alone into a conversation
  nobody was having is tokens on every later turn for an event the assistant never
  asked about. The argument inverts with the change — a cut the assistant made is
  a cut it already knows about, so a hand-framed one is the only cut it can be
  ignorant of, and keeping the gate would have left the whole path dead.

It costs no model call and no round. What it buys is the round it would
otherwise take: without the id in the conversation the only way to name a
fresh cut is `list_references` with the crops, and even then the model is
picking the one that just appeared out of a list of cuts of the same frame by
reading their labels.

**And a cut made for a board is on it before the reply is written.** The loop the
loose-fit note starts — "this sits loose, here is the shape that closes it" → cut
→ put it where the frame was — used to have a turn of conversation in the middle
of it carrying no decision, and then a click in another column carrying the whole
of it. Neither is left: `crop_reference` takes the board as an argument and makes
the swap itself, in the call that files the cut, by calling `swapPictures` — the
same edit `swap_on_board` makes, revision-guarded the same way and disowning the
stored render the same way. That makes a crop a scene write, so the tool queues on
`boardEdits` like every other one. Four things it has to get right:

- **The board is read before the vision call.** An id the model invented costs a
  sentence, not a photograph — the same rule every other refusal in that tool
  follows.
- **A frame that is not on the board still gets its cut.** The crop was asked
  for and is worth having; what cannot happen is the swap. So the board is
  dropped rather than the crop refused, and the answer says so — a model told
  nothing would report a board change that never comes.
- **A board that refuses the write is said, not thrown.** The user has it open and
  has saved since, so the revision guard misses. The cut is filed either way and
  `notPutOnBoard` carries the guard's own sentence; the run still succeeded, and
  only the cut is attached — a board tile beside a sentence saying the board did
  not change shows the user the opposite of what they were told.
- **The board is shown, not described.** A swap that landed answers with the
  `BoardAttachment` for the scene it just wrote, so the chat draws the new
  arrangement behind the cut. Whether the crop closed the gap is a question about
  a picture, and the miniature is the answer to it in the same message.

What none of this depends on any more is the chat being mounted. The swap used to
be made by the panel that filed the cut: the board came out right whether or not
the sidebar was listening, but the *note* about it rode the event bus and was lost
when nobody was. Both the edit and the sentence about it are in the tool's own
answer now.

**A board is shown as the arrangement, not as one photograph off it.** The same
argument, one level up: a board *is* the thing the pictures were put into, so a
tile showing the hero photograph is showing the one part of it that is not the
board. `boardPreview` turns the placements into a box each in percent of the
page, and the tile draws a page-shaped rectangle with them inside it. There is no
canvas, no render and no fetch beyond the thumbnails the strip would have loaded
anyway.

Three things it gets from being the same arithmetic the scene is written with:

- **The page's own shape.** A portrait masonry board is a tall sliver in the
  strip and a widescreen diptych nearly fills it. That is the first true thing
  about a board and a cover photograph cannot say it at all.
- **The boxes are `fitInSlot`'s, not the slots'.** A photograph contained in a
  slot it does not match is drawn loose here too, with page showing either side —
  so the gap the answer's `looseInSlot` names is the gap the user can see,
  in the same reply. §IV's compositor→cropper seam, made visible rather than
  only stated.
- **Images before text, and angles in degrees.** The order `composedScene`
  writes them in, so a caption lands over its photograph; excalidraw's radians
  about an element's centre are converted once, because that is what a CSS
  rotate already is.

The same miniature is drawn from a *stored scene* by `scenePreview`, which is
what lets `inspect_board` show a board nobody just composed — including one the
user dragged together, which has no placements anywhere. Two differences fall
out of reading elements instead of a plan: the caption says the page
(`6 photographs · 1920×1080`) rather than a template name, because the layout is
not stored and a rearranged board is no longer the shape it started as; and the
rectangle the percentages are of is the page *union anything dragged off it*
(`sceneBounds`), since a hand-arranged board has no obligation to stay on the
page and a preview cropped to it would omit the picture they just put beside it.

What it does not do is render: the miniature has no text glyphs (a headline at
96px tall is a grey bar), no shadows and no background beyond the page. It is the
composition, not the picture — and the picture is one click away, which is the
whole point of the click.

**But what a board says is carried beside the arrangement, not in it.** That grey
bar was recorded above as an acceptable omission and it is not, in the one reply
where it matters: asked to change a headline and rename the board, the assistant
answered correctly and the tile beside it read `4 photographs · Polaroid scatter`
over a miniature drawing the new words as a featureless smudge. The subject of
the whole turn was invisible in the result it produced.

It cannot be fixed in the miniature. A `POLAROID_SCATTER` text slot is 1000×105
on a 2048 page — 5% of the height, which is five pixels in a 96px tile, and
letters at five pixels are the grey bar with extra steps. So a `BoardAttachment`
carries `lines` (the words, in reading order) and `linesOver` (how many did not
fit), and the tile sets them under the title as quoted text where they can
actually be read. Four decisions in it:

- **The words, not a count.** `boardContents` already returns the lines and
  `caption` already counted the photographs, so the cheap fix was
  `4 photographs · 1 line`. That says a headline exists; it does not say the
  headline changed, which is the sentence the reply is making. The caption gets
  the count *and* the tile gets the strings.
- **Read from the same place the caption is.** `boardShown` takes them off the
  stored scene in reading order, so a rewording door and a reading door agree —
  the same one-board-one-name argument that put `boardShown` in one file. The
  compose door takes them off the *seated* blocks rather than off the call's
  `captions`, because a line the block budget left off (§IV) is not on the board
  and a tile quoting it would be describing a board that does not exist.
- **Capped, and the cap counted.** Three lines at 60 characters. A composed board
  is at most two lines by `LAYOUT_MAX_TEXT_BLOCKS`, but a hand-arranged one has
  no bound at all and neither does what the user typed into it — and a tile
  that simply ended after three would read as a board with three lines on it.
  §I's rule applied to a drawing rather than to an answer.
- **Nothing new crosses the wire that was not already there.** The lines are the
  board's own text, already read to caption it; the cost is the characters
  themselves, bounded at 180.

Clicking is not decoration — tech-spec §IV: a result the user cannot open is
one they have to go find again by hand. `attachmentTarget` says where a click
lands, and it is a union too: `{view: "gallery", inspectId}` or
`{view: "moodboard", boardId}`. Two rules worth stating:

- **A cut opens the frame it came from, at that cut.** A cut's properties are a
  step *inside* that panel — the versions list under the frame — and the panel
  has no way in at a cut from outside, so the target carries the frame to open
  (`inspectId`) *and* the row to land on (`versionId`). tech-spec §IV asks for
  the second half by name: a frame with nine cuts under it is the right panel
  and the wrong answer, since the user is left hunting the row the assistant
  just showed them. `version-focus.ts` carries it across the columns, the list
  scrolls to that row, rings it and draws its box on the frame above, and the
  request is put down the moment the user points at the list themselves —
  the mark is the assistant's sentence, not a state of the cut.
- **A board opens as a board.** `board-selection.ts` is the same module-store
  shape as `reference-inspection.ts` and solves the same cross-column problem,
  with one difference: the request is *cleared* when the user clicks a tab
  themselves, so a board composed an hour ago cannot pull the view back off the
  one they are working on.

There was a third rule and it went with the offer: a crop attachment opened the
frame it was drawn on with the box itself attached (`{view: "gallery", inspectId,
offer}`), because the panel is where a box is judged — over the frame at the size
the frame is shown, by a review that already measures coverage, pixel size,
duplicates and "the model ignored the nudge", and a second review in a sidebar
strip would have been a worse copy of it. That argument still holds for the box a
user frames themselves, which is why the panel's own crop flow is untouched. What
the chat shows is no longer a box to judge but a cut to look at, and a cut opens
by the first rule above like any other row.

The chat is also what tells the cache a board exists: a composed board is a row
`moodboard.listByProject` has never seen, and that list is what decides which
board the click is allowed to open. So the sidebar invalidates it on any reply
carrying a board attachment.

Attachments are merged across tool rounds and de-duplicated by
`attachmentKey` — kind *and* id, so a board and a reference that share an id are
two attachments. A model that lists the gallery and then shows three of it has
answered once, and the chat draws one reply.

De-duplication is first-wins for a picture and **last-wins for a board**, and the
instruction is what makes the board an exception. It tells the model to read a
board before it changes one, so the commonest two-tool turn about a board is
`inspect_board` and then an edit of the same one — and first-wins drew the tile
from the read, which is the board as it stood *before* the change the user
just asked for. A later view of a board therefore replaces the earlier one and
keeps its place in the strip: the position is where the conversation first
mentioned it, the content is how it now stands. A photograph's bytes do not change
inside a turn, so a picture is never redrawn either: a cut is a row of its own and
keys apart from the frame it came out of without help.

Attachments do **not** go back up as history. The model's own tool calls are
what put them there; shipping them back would have it reading its own output as
new evidence.

### And the conversation is not owned by the column that draws it

Everything above is about getting a result into the chat. None of it survives if
the chat is the thing that holds it — and it was: the messages, the attachments
and the settled offers were `useState` inside `ReferenceSidebar`, which the
workspace renders *conditionally* on the sidebar being open. The collapse arrow
sits directly above the messages. One click unmounted the component and deleted
every board tile, crop offer and cut this pipeline had paid for, with no warning
and nothing to undo. Switching to the moodboard and back was safe; tidying the
column away was not.

So the conversation is a value (`@/lib/chat-log`) held in a per-project module
store (`app/projects/[id]/chat-log.ts`) that the column reads. Four decisions in
it:

- **The turn runs outside React.** `sendTurn` is a plain async function in the
  store, not a `useMutation`: the request is paid for the moment it is sent, so a
  user who collapses the sidebar while the assistant is thinking has to come
  back to the *answer*, not to their own question with nothing under it. The wire
  (`ask`) and the cache work the answer implies (`onAnswered`) are passed in, so
  the store never learns about tRPC or query keys — and the closures survive the
  unmount because the query client is a singleton.
- **The taken-cut event is subscribed from the workspace, not the chat.** A cut
  filed in the properties panel is the one cut the conversation is not already
  holding, and the note it leaves is what lets the next turn name the new row. It is announced where
  something is always mounted, so taking a cut with the assistant collapsed still
  records it. That reverses iteration 19's "a cut taken while the chat was closed
  is not news an hour later" — it is not an hour later, it is this session, and
  the conversation is the record of it.
- **Nothing is persisted.** Every picture in a log is a signed URL with an expiry
  on it, so a conversation restored from `localStorage` tomorrow would be a column
  of broken tiles under sentences describing them. What survives is what is still
  true: the page's lifetime, which is exactly as long as the URLs are good for.
- **Keyed by project**, because two projects are two conversations and the
  assistant is a per-project seat.

The half-written message is in there too, and emptied by the same transition that
sends it rather than by the composer — the box is cleared *because* the message
left, so the two cannot disagree about whether it was sent. It is the same bug in
miniature: the collapse arrow is two inches above the box.

This is the fifth cross-column module in that directory and the first that is
neither a selection nor an event — `reference-inspection`, `board-selection` and
`version-focus` each say what is being pointed at *now*, `cut-taken` says what
just happened, and this one accumulates.

### And a turn that does not arrive keeps what was typed

The store fixed where the conversation lives and left one path in it that still
threw the user's work away. `chatFailed` recorded the error and stopped the
flight; the message stayed on screen as an ordinary question, the composer had
already been emptied by the ask, and there was nothing anywhere to send again.
A rate limit, a dropped connection or a preview model having a bad minute — after
a turn that can run the better part of a minute — cost the user the paragraph
they wrote, and the only way back was to type it out from what they could read of
it in the column.

So a failed message is *marked* rather than left as a question or dropped:

- **It is kept and drawn as unsent** — a dashed bubble with `Send again` under it,
  which sends it as a new turn and drops the marked copy, so the column shows the
  question once rather than claiming they asked twice.
- **It does not go up as history.** `chatHistory` is the eligibility rule that
  `historyWindow` is the size rule for: a message the model never saw is not part
  of the conversation, and carrying one has the assistant answering a question it
  was never asked, directly above the same question being asked again.
- **The mark is found by walking back from the end**, not by taking the last
  message: a cut taken in the properties panel lands as an event while the turn is
  in flight, so the question that failed is not reliably the bottom of the column.
  A model reply on the way back means nothing is unanswered and nothing is marked.
- **The failure still owes the cache work.** The tools write as they are called, so
  a board filed on the round before the one that broke is a row in the database
  with no tab and no tile to say it exists. `onFailed` invalidates the board list
  for the same reason `onAnswered` does — a turn that broke is not a turn that did
  nothing.

## IV. Agent 4, in two halves

The compositor splits exactly where agent 3 does, and the split is what keeps it
cheap.

**The template half is code.** `src/lib/layout/moodboard-layouts.ts` holds the ten
layouts of tech-spec §III.4 — page size plus slots, built from a margin and a
gutter rather than from a table of magic numbers. `RANDOM` resolves *before* the
call (`resolveLayout`), on one rule: **seat the most blocks, on the tightest
template that seats them, and break a genuine tie by an injected `pick`** so a
test — or a caller wanting the same board twice — can say which. The model is
therefore never asked to choose a template and assign to it in one breath.

The rule was the block *count* for thirty-five iterations, and the count is the
wrong question in both directions — see "The template that could not hold what
it was given" below.

**The assignment half is one text call.** `src/server/agents/deprecated/compositor.ts`
sends `layoutBrief` + the blocks and gets `[{blockId, slotId}]` back. No image
parts: a board of nine photographs costs about what a sentence of chat costs,
because agent 2 already read the pictures and the tags are what composition
turns on. The brief carries each slot's *shape* and *share of the page*, never
its coordinates — a model given four numbers per slot spends tokens
re-deriving what "large" means.

A block carries one thing that is not a reading of the picture: `favorite`, the
user's own star (§I). It is the answer to the question the largest slot asks
— which picture is this board *about* — so the instruction ranks it above the
tags and forbids leaving it off, and it is the only field in a brief that
outranks what agent 2 saw.

What comes back is held against the layout by `planAssignments`, which reports
rather than throws: an id in no list, a slot filled twice, a photograph sent to
a text slot. Five images placed and one misfiled is a board with a hole in it,
which is closer to what was asked for than no board — and the report is what
lets the orchestrator say so.

What it does *not* get a say in is whether a picture makes the board at all when
there is a slot free for it. Measured (iteration 15): asked to add a second
photograph to a two-slot board, it placed one and dropped the other as a poor fit
for the slot's shape — on a rebuild, a deletion. So `seatUnplaced` runs after
`planAssignments` and sits any leftover block in a free slot of its kind, in
reading order, and the answer names them (`seatedWhereThereWasRoom`) because
reading order is not a judgement about the look. Surplus is still surplus: a
tenth photograph on a nine-slot grid has nowhere to go. And a plan that placed
*nothing* is not rescued — that is a compositor that answered nothing usable, and
filling the page in reading order would file it as a board.

Images are *contained* in their slot, not filled. Excalidraw stretches an image
element to its box, so filling a slot edge to edge is a photograph squashed to a
shape it was not shot at. Making a photo fit a slot is agent 3's job, and this
is the seam where the two agents meet.

### The template that could not hold what it was given

`resolveLayout` picked the template whose *total* slot count matched the block
count. Ten templates, every count from two to nine covered, ties at six and seven
broken by chance — it reads as complete, and it drops blocks at both ends of the
mix, because a slot has a **kind** and the count does not.

Only three of the ten templates have a text slot at all, and the smallest of them
has six slots. So:

- **Two photographs and a headline** is three blocks. Three blocks resolved to
  TRIPTYCH — three image slots, no text slot — and the compositor was offered a
  caption with nowhere to put it. The headline was reported `unplaced` and the
  board came back without it. The same held for every board of fewer than six
  blocks, which is most of them: `captions`, `addCaptions` and `removeCaptions`
  are three of `compose_moodboard`'s parameters and they only ever worked at
  exactly six or seven blocks.
- **Six photographs** is six blocks, and both templates that hold six blocks hold
  *five pictures and a line* — POLAROID_SCATTER and HERO_LEFT are 5 img + 1 text.
  So a board of six photographs was composed on five image slots and one
  photograph was dropped. The seven-block tie was the same shape: half of it was
  MASONRY, which has no text slot, so a five-pictures-and-two-lines board had a
  coin-flip chance of losing both lines.

Iteration 3 recorded the first half of this as a note about the spec ("the tie
table only holds if the count is *total* slots") and resolved it by counting text
blocks in the total, which is what made the second half possible. The tie table
is not wrong; reading a template as *n slots* rather than as *n image slots and m
text slots* is.

Seating fixes both with one rule and no new concept. `seats(layout, blocks)` is
`min(imageSlots, images) + min(textSlots, texts)` — how many of these blocks this
template can actually carry — and the template with the highest count wins, the
tightest of those breaking the first tie and chance the second. Four consequences:

- **Every pure-photograph count is unchanged** except six and seven, which are
  the two that were wrong: 2→SPLIT, 3→TRIPTYCH, 4→FILMSTRIP, 5→GOLDEN_RATIO,
  6→MASONRY, 7→MASONRY, 8→MOSAIC, 9→GRID_3X3.
- **The spec's six-block tie survives exactly**, because it is a real tie: five
  pictures and a line is seated by POLAROID_SCATTER and HERO_LEFT alike, both at
  six slots. The seven-block tie dissolves, because it never existed — MASONRY
  could not seat the board EDITORIAL_SPREAD was tied with.
- **Tightest-first, not largest-first.** A board of three photographs and a
  headline goes to POLAROID_SCATTER with two image slots standing empty. An empty
  slot is a board the user recognises; a missing headline is not — the same
  argument `layoutForBoard` already makes for keeping a shrunk board's template.
- **The clamp at both ends falls out** rather than being a separate branch: one
  photograph seats one on every template, so the tightest is SPLIT; thirty seat
  nine at most, so GRID_3X3 wins. Nine photographs *and* a headline is the mix no
  template holds — GRID_3X3 seats nine of the ten, which is the most any of them
  can, and the headline is reported `unplaced` as it always would have been.

`holds()` — the predicate `layoutForBoard` uses to decide whether a board keeps
the template it was composed at — is now `seats(...) === blocks.length`, which is
what it already meant. And the test that pinned the bug is worth recording: it
asserted that a FILMSTRIP board given a caption *outgrew its template and was
handed FILMSTRIP back*. The reason read as correct (four blocks, four slots) and
the behaviour was the board giving way to a template that still could not carry
the line.

### And the budget that counted blocks when slots have kinds

The same mistake one layer down, and it survived the fix above. `layoutBlocks`
caps what reaches the compositor at `COMPOSE_BLOCK_LIMIT` (12) — a *token*
ceiling, so that a user naming eighty references does not pay for a catalog
twice — and it kept the lines ahead of the photographs when the cap bit, on the
argument that a board missing its ninth photograph is the board that was asked
for while one missing its title is a board with an empty block on it.

That argument holds for a title. It was applied to a list. A caption per
photograph is an ordinary ask — "make me a board of these ten, with what each one
is under it" — and it came out as **ten lines and two photographs**: the twelve
blocks of budget went to text in the order the two lists were concatenated, and
`resolveLayout`, doing exactly what the section above rebuilt it to do, seated
what it was given. EDITORIAL_SPREAD, two pictures, two lines, and eight
photographs the compositor was never shown.

The cap is now per kind, and the number is not a taste: `LAYOUT_MAX_TEXT_BLOCKS`
is `max(textSlots)` over the ten templates, which is **two**. A third line is not
one twelfth of a board — it is a block no template on the list has anywhere to
put — so offering it can only take the place of a photograph one *does*. The
images then take the rest of the budget as they always did, and "text first when
the cap bites" survives intact, bounded to the two blocks it was ever about.

Three consequences worth naming:

- **The surplus lines are said, not swallowed.** `linesNotOffered` reports them
  with a note stating the ceiling is a property of the templates rather than of
  the call, so the orchestrator says which words did not go on instead of
  offering to try again with fewer. This is `notOffered` for pictures, which has
  existed since iteration 8 and had no text half.
- **The no-op branch had to say it too.** A board already carrying two lines,
  asked for a third, produces no joining block and no write — and the answer read
  "nothing changed — everything named was already on that board". True of the
  pictures, false of the line, and the user would have been told their words
  were on a board that does not carry them.
- **The ceiling is in the declaration.** `captions`' description now states that
  no template carries more than two lines, which is the cheapest place to put it:
  a ceiling in a tool description is enforced by the model before the call (§VI),
  where the same ceiling discovered by a report costs a round.

The hand-arranged branch is deliberately uncapped. `placeLinesOnBoard` sets a
line above the arrangement with no template anywhere near it, so there is no slot
to run out of — the cap is a fact about the ten templates and applies exactly
where they do.

### And the line the template had nowhere to put

There is a second way a line does not go on, and the budget cannot see it: the
template the model *named* has no text block at all. Seven of the ten have none.
Found on the first live turn of a boardless project — asked for a board "and give
it a headline", the model named `TRIPTYCH`, and the headline reached the
compositor as a block with no slot of its kind. It came back as `unplaced`, which
is the same word a photograph the compositor *chose* to leave off comes back as,
and the reply reported the headline as "set as the board's title" — true of the
title, false about the board.

`RANDOM` has never had this problem: `resolveLayout` seats by kind, so a headline
and two photographs land on a template that holds a headline (the section above).
It is reachable only through the one decision the model makes about a template
without being told what is in it — its **name**.

So it is answered on both sides of the call, which is the split this layer keeps
arriving at:

- **Before it**, in the declaration: `layout`'s description names
  `LAYOUTS_WITH_TEXT` — the three templates that carry a line — and says that
  naming any other with captions in hand leaves the line off, so leave it out and
  let the template be chosen. Forty-eight tokens on every model call, in the one
  place a routing rule is enforced for free — against a wasted compositor call and
  a board the user has to ask for again. Replayed verbatim after the change, the same
  sentence left the layout out and the headline went on the board.
- **After it**, in the answer: `linesWithNoSlot` names the words and
  `linesWithNoSlotNote` says the template has no text block, that the line is not
  on the board, and which templates would carry it. Derived from the table, so a
  template added with a text slot joins the list on its own.

The distinction against `linesNotOffered` is worth keeping: that one is the
*budget*, which is a fact about all ten templates, and this one is a fact about
the one that was picked. Collapsing them would make "no board carries a third
line" and "this board carries none" the same sentence, and only the second has a
remedy the user can be offered.

### The seam itself: which pictures do not fit

Containment has a consequence the board shows and nobody was told: a portrait in
a cinema frame is on the page with a band of empty either side. `slot-fit.ts`
measures it after the scene is written and `compose_moodboard` says so —
`looseInSlot`, worst first, each one naming the picture, its slot, the share of
it the picture covers, and the shape a cut would have to be.

Three things make that a crossing rather than a report:

- **The shape is one `crop_reference` already takes.** `nearestCropAspect` picks
  from `CROP_ASPECTS`, the same six shapes the tool's `aspect` enum is drawn
  from, so the hand-off costs no new declaration, no new model call and no
  coordinates. The orchestrator reads the answer and makes a call it could
  already make; the user takes the cut in the panel, and the taking is what
  puts it in the place the frame had — the board rides on the call the note asks
  for (`boardId`), so the exchange ends where the decision is made rather than
  back in the chat. What was missing was the sentence that starts it — and, for a
  while, the call that ends it.
- **Nearest is measured in log space.** Shape distance is multiplicative: a
  linear difference calls 2.39:1 and 1.85:1 near neighbours while splitting
  hairs around the square, which is the wrong end to be precise at.
- **The gain is the gate, not the floor.** A fit is only reported when the cut
  would buy `SLOT_FILL_GAIN` more of the slot than the picture already covers.
  A crop is the most expensive call in the pipeline, so a cut that closes two
  points is not worth a photograph read — and this is also the loop guard.
  HERO_LEFT's supporting strips are 3.52:1, wider than any shape on the list, so
  a picture *already cut* to 2.39:1 for one still sits under the floor. Gated on
  the floor alone, every rebuild of that board would ask for the same crop of the
  same picture forever — and now that the tool files what it cuts, that is a row
  each time rather than an offer nobody took.

A board that fits says nothing at all, so the whole feature costs zero tokens on
the boards it has no opinion about.

### Putting the cut where the frame was

The last step of that loop went through `compose_moodboard`'s add/remove for four
iterations, and it was the wrong call the whole time. A rebuild pays the
compositor to reassign *every* slot: the user accepts a board, asks for one
picture to be replaced by a cut of itself, and gets back an arrangement nobody
asked for. On a board they had dragged into shape by hand it is worse than a
reshuffle — the arrangement is the thing that is lost.

`swap_on_board` is that step as what it actually is. A replacement has no
assignment left to decide, because the answer is already known: the cut goes
where the frame was. So there is no judgement to buy, no model call, no run row —
one scene edit, guarded on the board's revision like every other server-side
write, and nothing on the board moves except the box that had to. `crop_reference`
ends in this same function when it is given a board, rather than carrying a second
swap of its own.

`board-swap.ts` is the whole of it, and the only interesting decision is which
box the new picture gets:

- **Still in its slot → refit to the slot.** `scenePlacements` (§IV) already
  answers "is this picture where the template put it", so a seated picture is run
  back through `fitInSlot` against the *slot*, not against the smaller box the
  loose original was drawn in. That is the entire point of the exchange: the gain
  the crop was made for only shows up against the opening.
- **Moved by hand → same centre, same area, its own shape.** There is no slot to
  refit to, and containing the picture inside the old element's box would shrink
  it a little on every swap. A user who sized a photograph on a board they
  arranged sized its *weight*, so the weight is what is preserved.
- **No recorded size → the box it found.** The same call `slotFill` makes: a fit
  nobody can check is worse than a guess.

**Both pictures already on the board is a trade, not a refusal.** Naming a
picture the board already holds as `putOn` used to be turned away — swapping it
in would draw one photograph twice — and turning it away left "swap those two
around" and "put that one where the wide shot is" with no route but a rebuild:
the compositor paid to reassign every slot in order to make a move whose *both
ends* the user had already named. It is the same edit with the same two box
rules applied twice, once for each place: each element keeps its index in the
array (z-order is array order), carries the other picture, and is re-boxed
against the slot it is now standing in or against the room it was occupying. It
is reported as `tradedPlaces` rather than as `swapped`, because it is a different
sentence to the user: nothing joined the board and nothing left it.

Two things it still refuses rather than does. A picture no element carries is
named (`notOnBoard`) rather than ignored — it means a different picture was meant,
and only the user knows which, and that stays the fault worth naming even
when the *other* end of the pair is on the board. And an element may only move
once a call: two pairs naming the same picture out do not both land on it (the
second is an honest `notOnBoard` miss, since nothing carries it any more), and a
picture put on twice is `alreadyOnBoard` — the second pair would drag it out of
the place it has just landed in and leave the first one empty.

The pair is an object (`{takeOff, putOn}`) rather than two parallel arrays. Two
lists the model has to keep aligned is the mistake the caption ids were already
renamed around, and here a misalignment puts the wrong cut in the wrong place
without anything being able to tell.

### And saying the line differently is not a compose either

A board is pictures *and* text, and the argument above had only ever been applied
to the pictures. Changing what a line **says** — a typo, a different word, the
same headline in other words — had exactly one route: `compose_moodboard` with
`removeCaptions` for the old wording and `addCaptions` for the new. That is a
rebuild. The compositor is paid to reassign every block, and a user fixing
*exterios* gets their photographs back in different slots.

On a board with **no template of its own** it is not even a reshuffle. A
hand-dragged board stores `layout: null`, so `layoutForBoard` picks a template by
block count and `composedScene` writes that template's scene over an arrangement
that never had one. The whole board is destroyed to correct a letter.

`reword_on_board` is that edit as what it is. Nothing about the wording of a line
is open to judgement: the words are the user's, the block is the one already
carrying them, and the box is the one the board is standing in. So it is the same
shape as the swap — no model call, no run row, one revision-guarded scene write,
`renderRevision` disowned because the stored picture still has the old words in
it. `board-text.ts` is the whole of it.

Four decisions in it are worth stating:

- **The box is deliberately left alone.** A composed text block is pinned to its
  slot's width (`autoResize: false`), and the height a compose writes is already
  an estimate excalidraw replaces the moment the block is edited. There is no
  canvas here to measure a new one with, so guessing would move a block that has
  no reason to move.
- **Both strings are written.** Excalidraw keeps `text` (drawn, after wrapping)
  and `originalText` (as typed). Writing one would let the block resurrect the old
  wording the moment it was opened for editing — the same trap `composedScene`
  already had to write around.
- **Matched case-insensitively, compared exactly.** The model quotes a line back
  out of `inspect_board`, so a retyped capital or a doubled space must still find
  the block — but "ACT TWO" → "Act two" is a real change, so whether anything
  *happened* is compared on the words themselves. The key ignores case because
  that is how the line is quoted, not because the board reads the same either way.
- **A blank `to` is not a deletion.** Taking a line off a board reflows what is
  left, which is a compose. The declaration says so, so the routing happens before
  the call.

The refusals are the same two the swap has, for the same reasons: a wording no
text element carries is `notOnBoard` with the note telling the model to read the
board and quote the line, and a block may only be reworded once a call — the
second pair naming the same line is reported as the miss it now is rather than
silently overwriting the first. A line that already says exactly that is
`alreadySaysThat`, which is a no-op worth naming because the reply would otherwise
claim a change the board did not make.

### And on a board they arranged themselves, adding a picture or a line is not one either

The reword section above names the failure mode and then only fixes it for the
wording of a line: on a board with `layout: null` a rebuild does not reflow, it
**invents** a template from the block count and writes that scene over an
arrangement that never had one. The other two verbs — put **on** the board, take
**off** it — were still in that path for both of the things a board holds, and
they are the commonest thing anybody says about a board they are building.

So `compose_moodboard` now branches before the compositor. `changesContentsOnly`
reads the *call* (a picture and/or a line named to go on or come off, nothing else
that reopens the arrangement — no `referenceIds`, no `captions`, no template) and
`standsAsComposed` reads the *board*, and when the call is only a change to what
the board holds and the board is not standing in its template, `board-place.ts`
and `board-line.ts` make the edit against the stored scene: no model call, no run
row, one revision-guarded write, `renderRevision` disowned, `layout` and the page
size untouched.

The two halves were built an iteration apart and the split is worth recording,
because it is the same shape the reword found: a fix aimed at one of the two
things a board holds leaves the other live. Pictures were taken out of the rebuild
path first; `addCaptions` on a hand-arranged board still deleted it. The audit
question is not "is this verb safe" but "is this verb safe **for each mutable set
on the record**", asked once per set.

Three things it had to get right:

- **The gate is "does it still stand", not "was it ever composed".** A board with
  `GRID_3X3` on the row and one photograph dragged out of its slot is an
  arrangement the user made, and reflowing it away is the same loss as
  reflowing a board that never had a template. `standsAsComposed` was written in
  iteration 24 to decide what to *call* a board; it answers this too.
- **A board still standing in its template keeps the compositor**, and that is not
  a concession — but only for what is *joining* it. A four-slot FILMSTRIP gaining a
  fifth picture wants a template that holds five and every slot reassigned, which
  is exactly the judgement the compositor is for; a four-slot FILMSTRIP with a free
  frame wants one picture placed and nothing else touched. The next section is that
  distinction.
- **Where the picture goes is arithmetic, not a decision.** It joins in a row
  under the covering rectangle of everything on the board, centred on it, at the
  **median** longest edge of the pictures already there — not the drop's own 320,
  because a photograph arriving among six large ones at a fifth of their size
  reads as a mistake; and not the mean, because one picture blown up to a backdrop
  is a deliberate thing a user does and should not resize everything that
  follows it. Deliberately not `sceneBounds`, which always covers the page: a
  board whose pictures sit in one corner would otherwise put the new one a
  page-height away from them.
- **Where the line goes is the same arithmetic, pointed the other way.** A line
  is set **above** the covering rectangle, across its width, centred, at the
  median font size of the type already on the board (a board carrying no type at
  all sizes it at 5% of the arrangement's width, clamped to the layout's own
  bounds). Above rather than below for two reasons: it is where a title goes, and
  it is the one region of a hand-arranged board reliably left empty, since joining
  pictures go underneath — so a picture and a line added in the same call cannot
  land on each other. Several lines named at once stack downwards onto the board
  in the order they were given. `autoResize: false` and the arrangement's width,
  for the reason `composedScene` pins a text block to its slot: a headline left to
  size itself shrinks to its own words and stops being one.
- **A line is matched by its words, because it has no id.** The same rule
  `lineSelection` and `rewordOnBoard` use — whitespace collapsed, case ignored,
  read through both `text` and `originalText` — so a wording quoted back out of
  `inspect_board` still finds its block. `LINE_NOT_ON_BOARD_NOTE` is now shared by
  the rebuild and the in-place edit rather than written twice: a mis-quoted line is
  the same mistake whichever branch took the call, and two copies of the sentence
  would have drifted into two different next steps.

It is a **branch rather than a seventh tool**, and the reason is the one thing the
model cannot know: the boards brief names the template a board was *composed* at,
and reading every board's scene to prime a turn is the query §VI refuses. A
declaration the model could not route to would be worse than no declaration. The
routing is a fact about the stored scene, so it is decided where the scene is —
and the answer says which branch ran, because the model asked for a rebuild's
argument and got a scene edit, and the one thing it must not report is that the
board was laid out again.

### And on a board that is standing, only what is joining it is composed

The section above ends by handing the composed board back to the rebuild, and the
rebuild asks the compositor for an assignment of **every** block to **every** slot.
On a board that does not exist yet that is the whole question. On a board the
user is looking at it re-decides eight placements to answer a call about one —
so "put the sunset on it too" moves nine photographs, and the eight that moved were
not mentioned by anybody.

That is a correctness problem rather than a taste one, and the crop→board loop is
what makes it one. A cut asked for a board is held to the **exact shape of the
opening it is filling** (§V), which is the most expensive thing this pipeline does:
a photograph read, bought to make one picture fit one slot. A reflow that moves it
into a different slot spends that read for nothing and hands the loose-fit report
the same picture again.

So `keptSeats` splits the blocks before the call. A picture still sitting where the
template put it — the strict `scenePlacements` pairing, for the fifth time — keeps
its slot; a line still set at a text slot's own box, matched on its words, keeps
its slot; and the compositor is asked only about what is left, against only the
slots that are free. Three gates, all of which have to hold:

- **the call names a change** (`changesContentsOnly`, the same predicate the
  hand-arranged branch reads) — "lay it out again" is a rebuild and must stay one,
  and it arrives as a `boardId` with no change on it;
- **the template is the board's own** (`layoutForBoard`'s reason is `kept`) — a
  board that outgrew its template, or one given a template by name, has a different
  set of slots and nothing to keep;
- **the board is standing in it** (`standsAsComposed`) — pinning half a board the
  user has been dragging around would be the pipeline deciding their hands
  meant the template.

What falls out of it:

- **A removal costs no model call at all.** Nothing joins, so nothing is open to
  judgement: the picture leaves, the rest keep their slots, and there is no
  compositor call and no `AgentRun` row. The cheapest version of every lever in
  §VI — a paid call replaced by nothing.
- **A call that changes nothing writes nothing.** A picture named on that is
  already on leaves the scene it would be rewritten to identical to the one that is
  stored, so the write is skipped: a revision bump would hand an open tab a
  conflict, and a dropped `renderRevision` would blank a preview that is still a
  true picture of the board.
- **The compositor is told what it cannot see.** It is given the free slots as its
  layout and the kept blocks as `inPlace` — slot id plus the same digest the
  blocks carry. Without that, "put neighbours beside each other" is unanswerable:
  it would be composing a half-full board with the other half invisible.
- **The kept block is the offered one, not the element.** The element's box is
  already contained in its slot, and re-containing a contained box is idempotent
  only by luck of the arithmetic; taking the reference's own recorded size means a
  rebuild redraws the picture rather than re-fitting a fit.
- **The two lists are merged in slot order.** What stayed and what was just placed
  are two lists and the board reads in one — so the merged plan is sorted by the
  template's slot order before the scene is written, which is also what makes the
  cover (the first image slot) and the miniature honest.
- **The seating rule still runs on the whole board.** `seatUnplaced` is given the
  full layout and the full block set with the kept placements already in it, so a
  compositor that answers nothing usable still does not drop the picture the
  user named — it is seated in the first free slot of its kind, exactly as on a
  new board.

The refusals are the rebuild's own: emptying a board is refused before the write,
a picture the board never held comes back as `notOnBoard` rather than as a shrug,
and one already on it is `alreadyOnBoard` — a board must not draw the same
photograph twice, which is the swap's rule as well. The lines report the same four
things under their own names (`linesAdded`, `linesRemoved`, `linesNotOnBoard`,
`linesAlreadyOn`), kept apart from the pictures' because a wording the board never
carried is a different mistake from an id that is not on it and the reply has to
quote words rather than name an id. The one case that reads as a duplicate and is
not: the same line named to come off **and** go on is a move, so it is set again
rather than reported as already there.

**The scene write is code too.** `moodboard-compose.ts` turns the plan into a
board row. A drop goes through excalidraw's `convertToExcalidrawElements`, which
lives in the editor bundle and reaches for `window` — so a board written by an
agent, with no tab open and no canvas anywhere, cannot use it. What it can do is
emit the fields that decide how an element *looks* and leave seeds, versions and
fractional indices to excalidraw's own `restore` on open. Two orderings matter:
images are written before text so a caption lands over the photograph it
captions, and text blocks survive the block cap before photographs do — a board
missing its ninth photo is the board that was asked for, one missing its title
is a board with an empty block on it.

A caption is given an id of its own (`caption-1`) rather than the slot id it
might land in: blocks and slots are two lists the model has to keep apart, and a
block called `text-1` in a layout with a slot called `text-1` is an assignment
that reads as correct whichever way it was meant.

What the answer says it did *not* do has two halves, and only one of them is the
compositor's. `unplaced` is the blocks the model was given and left in the tray.
`notOffered` is the references that never reached it: `pickReferences` caps the
selection at `COMPOSE_BLOCK_LIMIT` and `layoutBlocks` keeps captions ahead of
photographs when the cap bites, so a user who named fourteen references and a
title has two of them dropped before the call. The plan cannot see those — it
only knows the blocks that were sent — so the executor works them out by
difference and names them. Otherwise the orchestrator is told to "say what was
left off" and is not told the half of it that happened on our side of the call.

The board is **filed, not offered**. A moodboard is a scene the user then
pushes around; a first draft they have to accept before they can see it is a
draft they judge from a description. That is the opposite call from `crop_reference`,
and for a concrete reason: a crop's pixels are cut in the browser, a board's
scene is JSON.

### Rebuilding a board they already have

tech-spec §III.4 gives agent 4 "all current blocks" as its input, and the reading
that makes that sentence do work is the second call: *lay this board out again*.
So `compose_moodboard` takes an optional `boardId`, and with one the tool rewrites
that board instead of filing a new one. Leave `referenceIds` out and the selection
is read off the board's own scene — `sceneReferenceIds` over the stored elements —
so "make that a 3×3" costs no round of naming ids back at us. That is why
`referenceIds` is no longer a required parameter and the executor refuses a
*new* board with nothing named instead.

Four things a rebuild has to get right, none of them about the model:

- **The id is checked, not trusted.** It arrives in a model argument, so the row
  is read `where: {id, projectId}` — the same rule that keeps the project id out
  of every other tool's arguments.
- **The write is guarded on the revision that was read**, exactly as the autosave
  is. The read and the write sit either side of a model call, which is the one
  window a user's own save can land in; the loser is told the board changed
  and the tab keeps its work and offers a reload. The compositor was already paid
  for by then, so that refusal is a FAILED run row *with* the spend on it.
- **The stored picture is disowned** (`renderRevision: null`). It is a render of
  an arrangement that no longer exists, and left standing the tab row would show
  the old board as the preview of the new one until somebody opened it.
- **The name is kept.** A rebuild is not a rename: renaming "Act two exteriors"
  to whatever the user said while asking for a grid is a second, unasked-for
  change to something they already own. A `title` argument still renames it.
- **It is destructive, and the answer says so.** The scene is replaced whole,
  including anything the user drew on the board by hand — which is what
  "lay it out again" means, but not something an assistant should discover for
  them afterwards. The tool's answer names it (`rebuilt in place … instead of
  what was on it`) and the instruction tells the orchestrator to ask first when
  the board may have been arranged by hand. `moodboard.duplicate` is the escape
  hatch that already exists for keeping the version that works.

**Putting a picture on, taking one off.** The rebuild above answers "lay it out
again"; it does not answer "and put the sunset on it too". Naming the whole set
in `referenceIds` is the only shape that call had, and it is the one shape the
model cannot fill honestly: a board is primed by id, title and page size, so the
pictures on it are exactly what the orchestrator does not know. Asked to add one
it would have listed its guess at the board, and every photograph it failed to
guess would have come off — silently, since the tool has no way to tell a
deliberate replacement from a forgotten picture.

So the model names the *change* — `addReferenceIds`, `removeReferenceIds` — and
`boardSelection` applies it against the board's own scene. Which keeps the
division of labour the whole file rests on: the model emits the judgement (this
picture belongs on that board), code emits the set. It costs one model call, no
extra round, and two parameter descriptions on the declaration.

The alternative was priming what is on each board, and it is the wrong trade for
the reason iteration 12 already found: the contents live in `elements`, which is
megabytes a turn that never mentions a board would pay for. A change applied
blind is cheaper than a set read aloud.

What the edit could not do is reported rather than swallowed, on the same terms
as `unplaced` and `notOffered`: `notOnBoard` is an id asked off a board that never
held it — the model having meant a different picture, which only the user can
settle — and `alreadyOnBoard` is a picture it asked to add that was already
there. Emptying a board is refused before the model call, since a page of slots
with nothing in it is not a board and the refusal costs nothing.

**And the lines it carries.** A board is pictures *and* text — several templates
have a text slot and `captions` is what fills it — and the rebuild above kept
half of that. The blocks were built from `captions` alone, so a call with no
captions in it (which is every call that is about a photograph: "add the sunset
to that board") wrote the board back with its headline deleted. The same hole
`addReferenceIds` was invented to close, in the half nobody had walked.

So the lines follow the pictures exactly: `lineSelection` bases a rebuild on the
board's own text — read off the stored scene by `boardContents`, which
`inspect_board` was already using — and takes `addCaptions`/`removeCaptions` as
the change, with `captions` demoted to the outright replacement it always was.
The four outcomes are reported the same way and kept in their own fields
(`linesAdded`, `linesRemoved`, `linesNotOnBoard`, `linesAlreadyOn`), because a
reply about a line has to quote the words where a reply about a picture names an
id.

One thing is different, and it is the only interesting part: a line has no id.
It *is* its words, so there is nothing else to point at one by — the model quotes
a line back out of `inspect_board` to say which one it means. The match is
therefore on the words normalised (whitespace collapsed, case ignored) rather
than on the string, since a retyped capital is not a different line; and a
wording the board does not carry is reported as `linesNotOnBoard` with the note
that sends the model to read it, on the same reasoning as the picture's
`notOnBoard`: the model is quoting the user rather than the board, and only
the user can settle which line was meant.

**The board remembers its template.** `resolveLayout` answers the question a
*new* board asks — which template suits this many blocks — and that is the wrong
question for a board that already exists, because the user is looking at it.
Asked to add one picture to a five-block spiral it returns a six-block template,
so the board they recognised is replaced by a different one nobody asked for; and
since two templates hold six blocks and two hold seven, a rebuild that changed
*nothing* could still flip the board on a coin. The shape of a board is most of
what it is.

So `Moodboard` gained a `layout` column — written by every compose, null for a
board the user dragged together — and `layoutForBoard` decides a rebuild's
template from it:

- a template the model **named** wins, as before;
- `RANDOM` means *choose me a new one*, so it overrides the stored template —
  otherwise there would be no way to ask for a reshuffle at all;
- otherwise the board **keeps** the template it was composed at, for as long as
  that template has room. Room is counted per kind, since a caption cannot be
  seated in an image slot;
- and when it no longer has room, the count decides — `outgrew` — and the answer
  carries a sentence telling the orchestrator to say the shape changed. A board
  with a slot standing empty is a board the user recognises; one silently
  reshaped because they took a picture off is not, so shrinking never re-picks.

The template also joins the primed board line (`id · title · W×H · GRID_3X3`) and
`inspect_board`'s answer as `composedAs`. Three tokens a line, and what they buy
is the model being able to tell a change of shape from a change of contents
before it asks for either — plus the honest caveat that it is what the board was
*composed* at, not a claim about where things are now, since the positions
`inspect_board` reports are read off the scene and the user may have dragged
half of it since.

**And a rename is not a compose.** The bullet above says a rebuild keeps the
board's name unless a `title` is given, which is right — and it left the other
half of the sentence live: a call that gives a title and *nothing else* was still
a rebuild. "Call that board Act two" therefore reached the compositor, paid it,
and wrote back the arrangement it had just re-decided. The name changed and so
did the board, which is the one thing the user did not ask for.

Nothing about a rename is open to judgement — no picture joins the board, none
leaves, no line changes, the template is untouched — so nothing is asked.
`renamesOnly` reads the *call* (title present, every list empty, no template
named) and the executor writes the title column alone:

- **no model call and no run row**, on the same terms as `inspect_board` and
  `swap_on_board`: this is the third free tool path, reached through a paid tool's
  declaration rather than a seventh declaration of its own, which is what keeps it
  off every round of every turn (§VI);
- **unguarded, with no revision bump.** The title is not part of the document an
  open tab is autosaving, so bumping the revision would hand the user a
  conflict — a reload of work they were in the middle of — as the price of a
  rename. This is exactly the write `moodboard.rename` makes from the browser;
- **`renderRevision` is left standing**, for the first time on this path. Every
  other server-side board write disowns the stored picture because it is a render
  of an arrangement that no longer exists. A rename does not touch the
  arrangement, so the render is still a picture of this board;
- **the tile is drawn off the scene as it stands** (`boardShown`), so the board
  comes back into the chat under its new name looking exactly as it did.

The predicate reads the call rather than the resolved selection deliberately: a
rebuild with no references named means *the ones it already has*, so by the time
`boardSelection` has run, a rename and a reshuffle are the same value. And the one
ambiguity it can be wrong about — "rearrange it and call it Act two", with no
template named — is answered in the answer rather than guarded against in the
call: the status says the board was renamed and *not* laid out again, and names
the call that would. A model that meant the other thing makes it in the same turn;
the alternative is charging every rename for the reflow it did not ask for.

### Reading a board without rewriting it

Both features above hand the model a *write* it has to use blind, and that left
one shape of question with no answer at all: **what is on this board?** The
boards are primed by id, title and page size, and the contents are deliberately
not primed (megabytes of `elements` on every turn that mentions no board). So the
only call that could have answered it was `compose_moodboard` with no
`referenceIds` — a rebuild — which pays a compositor call and replaces the
arrangement in order to *ask a question*. That is not a missing feature, it is a
destructive read.

`inspect_board` is the read. One query, no model call, and it answers with:

- **The pictures in reading order**, numbered. Reading order rather than z-order
  because that is the order the user counts in: "take the third one off" is
  about the board they are looking at, and z-order is about what excalidraw draws
  last. `readingOrder` bands by *overlap* — two things are one row when the lower
  one's midline is still inside the row above — so it needs no guess at how tall
  a row is meant to be. On a staggered layout there are no true rows and a tall
  picture chains its neighbours into one long sweep; that is the least wrong
  answer available without knowing the template, which is not stored.
- **The lines set on it**, and a count of the images that name nothing this
  project holds. A reference deleted out from under a board keeps its *position*
  and is marked `gone` — the number is what the user is counting.
- **No tags.** The photographs are already primed with theirs. What a board adds
  is which of them and in what order, so repeating the vocabulary here is the
  same paragraph bought twice.

It reads a board the user dragged together as readily as a composed one,
which is the other half of why it is elements-in rather than placements-in: a
board that has been rearranged has no assignment anywhere, and `elements` is the
only description of an arrangement that survives.

**And which pictures do not fit.** The same `looseInSlot` report the compose
below makes, for a board nobody just composed. It was unreachable while the board
row remembered nothing about how it was built — that was recorded here as a bound
on what any scene read could say — and the template column added for the rebuild
is what removed it: the slot rectangles are constants, the board names the
template it was composed at, and a picture still sitting where that template put
it can be measured against its slot off the scene alone. `scenePlacements` is
that pairing, and the two halves of why it works are worth stating:

- **The element carries the photograph's shape.** A contained fit preserves the
  aspect ratio, so the element's own width and height are all `slotFill` needs —
  the reference's pixel size, which §I strips at the tool edge, is not wanted.
- **The pairing is strict, and silence is the point.** A picture counts as being
  in a slot only if it is the box `fitInSlot` would have drawn — contained,
  centred, touching an edge, at the slot's own angle. Anything moved, resized or
  turned since is the *user's* arrangement, and reporting the gap between it
  and a slot nobody is using any more would be the pipeline arguing with the
  hands that composed the board.

The note beside it is shared with `compose_moodboard` (`LOOSE_IN_SLOT_NOTE`),
because a loose fit found by reading and a loose fit found by placing are the
same situation and want the same next call. What this closes is the last place a
question about a board could only be answered by rewriting it: "does this board
look right?" used to cost a compositor call and a new arrangement, and now costs
the query that was already being made.

The cost is one declaration on every round — about 120 tokens, against the ~4,400
a turn already spends on routing — and it buys back a compositor call plus the
rebuild the user did not ask for. It is also the first tool here whose
description tells the model what *not* to do with another tool ("never rebuild a
board to find out what it holds"), which iteration 10 measured to be free
enforcement: a ceiling written into a description is obeyed before the call.

On the chat's side the same board attachment does the work — it is the same board
id, so the click still opens it — plus one cache rule: `moodboard.scene` is
fetched once and pinned (the editor is initialised from a document, so it never
refetches on mount), which means a rebuilt board would open from the stale copy.
The chat drops that copy when a board attachment arrives, but only while nothing
is showing it: dropping a scene the editor is mounted on would unmount the canvas
under the user's hands. An open board finds out the way any other tab does.

### And a version of the board they want to keep

Every board door above changes the board the user is looking at. That is
right for each of them on its own — a swap, a reword and a rebuild are all things
said *about* a board — and together they left a shape of ask with no honest
answer: **"keep that one and try it with the tall shot."**

The two calls a model could reach for were both wrong, and wrong in the way this
run keeps finding: every call succeeds, every write is correct, and the result is
not what was asked for.

- `compose_moodboard` with the `boardId` — it varies the board by *replacing* it.
  The version that worked is gone, and nothing downstream can tell that from a
  rebuild the user asked for.
- `compose_moodboard` without one — a new board, from a set the model had to read
  off the first with `inspect_board` and then restate. So it pays a compositor
  call to re-decide every slot, comes back arranged differently, and is short of
  whatever the restatement forgot. A "copy" that looks nothing like what it copied.

`duplicate_board` is the copy. One query, one write, no model call, and four
decisions in it:

- **The scene is copied by value and nothing is asked.** Copying is not a
  judgement, so no agent is involved: the same division of labour as everywhere
  else here, with the model choosing *that* a variation is wanted and code
  producing it. The variation itself is then made on the copy with the free scene
  edits that already exist — which is the whole reason this is worth one
  declaration rather than a mode on the compose.
- **The template travels with the scene.** The user's own duplicate had
  dropped it since iteration 20 added the column: a copy with no `layout` is a
  board nobody composed, so `inspect_board` cannot say what sits loosely on it and
  a rebuild of it re-picks a shape by block count. A variation of a board that no
  longer looks like it is the defect the copy exists to prevent, arriving one call
  later. Fixed in both doors.
- **The copy is named against the boards this turn has already made**, not only
  against the ones the project had. The boards read is taken once per turn, so two
  copies in one turn would otherwise both be "Act two (copy)" — two tabs the
  user cannot tell apart, which is exactly what `duplicateBoardTitle` was
  written to prevent.
- **It is queued on the board it copies** (§I). It writes to a board nobody else
  can be holding, but it *reads* one that this turn may be editing, and "fix the
  typo and then give me a version with the tall shot" is one round. Queued, the
  copy is of the board as the turn leaves it.

The source's picture is inherited by a bucket copy where the source's render is
current, exactly as the user's own duplicate does it and for the same reason:
a board is only ever drawn by a tab that has it open, and the copy is not open. It
is best effort — a copy without a preview is what every new board is anyway, and
failing a write that landed would be the answer claiming less than happened (§I).

### And the board they want gone

`duplicate_board` (above) gave the assistant a way to *multiply* boards and none
to clear one up. The sentence after "keep that one and try it with the tall shot"
is reliably "bin the first one", and the nearest call a model could reach for it
was a rebuild of the board the user wanted deleted — a call that succeeds, a
write that is correct, and an answer that is not what was asked for.

`discard_board` closes it, and it is **the only tool in this layer that offers
where it could file.** Agent 3's offer is mechanical: the pixels are cut in the
browser and there is nowhere on the server for a chat-driven crop to become a row
(§V). Nothing of the kind is true here — `moodboard.remove` exists and the
executor could call it. Four decisions:

- **The last hand on it is the user's.** Every other board write in this
  layer is recoverable by asking for the other thing: a rebuild can be rebuilt, a
  swap swapped back, a reword reworded. A deleted scene is gone. So the tool
  reads the board, draws it, and answers with a status saying in as many words
  that nothing has been deleted and the button is theirs — the same shape of
  answer `crop_reference` has carried since iteration 5, for a different reason.
- **The answer names the loss, not the id.** The model cannot see what is on a
  board (§IV), so "shall I delete board-7" with nothing after it is a question the
  user cannot answer without going and looking. The tool answers with the
  picture count, the lines, the page and the template, and the tile draws the
  arrangement — which is the whole of what a discard costs.
- **A tile whose board is gone stops being a way in.** `activeBoardId` falls back
  to `boards[0]` for an id the tab row does not hold, so a click on a stale board
  tile opens *somebody else's arrangement* — a dead click, which iteration 49
  recorded as the one failure in this pipeline reported to neither the user
  nor the model. `ChatLog.discarded` is what makes it stop: the tile stays under
  the reply that was about it, drawn at half opacity and captioned `Discarded ·`,
  and it is a `span` rather than a button.
- **Both doors announce it.** The chat's own button records the discard directly;
  the tab row's delete announces it through `board-discarded.ts`, the second
  cross-column *event* in this directory (after a taken cut) and for the same
  reason — it happens once, and reading it twice would say it twice in the
  conversation. The note that lands says the board is gone, that **the id no
  longer names anything**, and that the photographs are still in the gallery. The
  first clause is for the model, which would otherwise pass a dead id to a tool
  later in the same conversation; the last is for the user, because "I
  discarded the board" is a sentence that can be heard as having lost the
  pictures on it.

What it costs is one declaration on every round of a project that has a board,
and one query when it is called. What it prevents is a compositor call that
replaces the arrangement the user asked to keep.

### And the picture they want gone

The same offer, one object over — and the completeness question iteration 53
wrote down ("of any object with a full set of content edits, ask whether
copy/delete/keep-a-version exist at all") re-run against the *reference* rather
than against the board. A board can now be composed, read, copied, edited and
discarded. A picture could be listed, shown, read, cropped and put on or taken
off a board, and there was no way to take it out of the project at all — while
the gallery has had a Remove button on every tile since long before the assistant
existed.

The nearest call a model could reach for "bin the blurry one" is
`compose_moodboard` with `removeReferenceIds`, which **lands, looks correct
afterwards, and is not what was asked**: the picture comes off one board and
stays in the project, on every other board, with all its cuts. That is iteration
52's shape exactly — a model holding an ask it cannot place will reach for the
call that can place something.

`discard_reference` is the answer, and it is the second tool that offers where it
could file. Four decisions, three of them the board's and one that is not:

- **The last hand on it is the user's**, for a reason stronger than a board's.
  A discarded board is a scene that can be composed again out of pictures that
  still exist; a deleted photograph is the bytes, and `reference.remove` takes
  them out of the bucket. So the tool reads, draws and answers with a status
  saying nothing has been deleted and the button is theirs.
- **The answer names the reach, which is the part that is new.** Deleting a frame
  deletes every cut made of it — the schema cascades, and `versionDescendants`
  walks it, so a cut *of a cut* is named too — and every board showing the frame
  or any of those cuts is left with an element pointing at nothing. Both are
  invisible to the model, and the second is invisible to the *user*: a frame
  kept off every board while a crop of it holds up two is exactly the case a
  plain "which boards show this" read answers "none" to. `removalUsage` already
  split those two halves for the gallery's own confirm; the tool reads it the
  same way and reports them apart, because a board showing only a cut is a loss
  the user cannot check by looking at the tile they are removing.
- **A tile whose picture is gone stops being a way in.** This is the sharper
  instance of the dead click iteration 49 found: the tab row at least opens *a*
  board for an id it does not hold, while `inspectReference` on a picture the
  gallery no longer lists resolves to nothing and the panel simply does not move.
  `ChatLog.discarded` holds it — one map, keyed by kind, because what it means is
  "the subject of this tile is not there any more" — and the tile is drawn at half
  opacity, captioned `Removed ·`, as a `span`.
- **Every door announces it**, and there are three: the chat's own button, the
  gallery tile's Remove, and the versions list's (a cut is a reference, and
  deleting one goes through the same mutation). Each announces through
  `reference-discarded.ts` on *success*, so a removal that did not land is not
  announced — and each announces only what it knows: a board scan that failed
  leaves the boards out of the note rather than claiming the picture was on none.
  Absent is unknown, not zero, which is §I's rule read one more time.

One vocabulary note, because it was a decision rather than an accident. The tool
is `discard_reference`, in the family `discard_board` is in, because the name is
what tells the model these two are one kind of act. Every string the *user*
reads says **remove** — the button, the caption, the note — because that is what
the gallery's own control beside the same act has always said, and one act with
two names in one session is the defect §III already had to fix once for boards.

What it costs is one declaration and one short instruction paragraph on every
round of a project that has a picture, plus one query when it is called (and none
at all on a project with no boards). What it prevents is a board edit reported as
a deletion.

## V. Agent 3, and why it offers instead of files

> **Superseded, and now in code.** `crop_reference` files the cut in the turn
> that asks for it: `sharp` decodes the original out of the bucket,
> `src/server/references/cut.ts` cuts the region and makes the thumbnail in the
> same pass, `src/server/references/file-version.ts` writes the row and the
> analyzer job — the same function `reference.addVersion` now files the panel's
> cut with — and the chat is handed the cut as an ordinary reference tile whose
> id resolves for the next round of the same turn. A `boardId` cuts *and* swaps
> in the one call, through `swap_on_board`'s own executor, and the tool is queued
> on `boardEdits` because it writes a scene now.
>
> So the premise this section opens on is gone: there *is* somewhere on the
> server, and there always could have been — it was a missing library rather
> than a decision. The chat's half of the offer is out of the tree with it —
> `crop-offer.ts`'s module store, the adoption effect in `useCropReference`,
> `CropOffer.forBoard`, `cropPreview`, `CropAttachment`, the crop tile, the
> `taken` map that settled it and `moodboard.swapReference`, the mutation the
> browser made the board swap with — so the paragraphs below on the offer, on
> what declining costs, on how the offer travels and on the board the cut was
> going to be for are history rather than description. Everything about the
> loop, the shapes, the slot the cut is held to and the nudge holds unchanged.
> What the build decided differently: `orchestrator-tool-reference.md` §IV.
>
> The properties panel is untouched. `planCrop`, Keep / Discard / Adjust and
> `cut-taken.ts` all stand: a user framing a crop by hand is choosing a box and
> wants to see it before it becomes a row. What did change there is that keeping
> one is now announced to the chat *always* rather than only for a box the chat
> had offered — with no chat offers left, the hand-framed cut is the only one the
> assistant can be ignorant of, and the note it rides in on says so in the user's
> own voice ("I cropped this myself") rather than crediting an offer nobody made.

The cropper's tool ends at an offer because it cannot end anywhere else: the
pixels are cut in the browser, on bytes read back same-origin (§II.6), so there
is nowhere on the server for a chat-driven crop to become a row. `crop-offer.ts`
is that offer — the same four numbers `planCrop` hands the properties panel,
plus the id of the frame they are numbers of — and it is pure, so the tool that
makes one and the browser that takes one agree on what one is.

The constraint turns out to be the right design anyway. A cut nobody wanted is
the commonest thing agent 3 produces, and a chat that filed them would answer a
wrong box with a row, its bytes, its thumbnail, its analysis and the delete that
follows. Declining costs the call that was already made and nothing else.

The offer travels by `crop-offer.ts` in the client — the same module-store shape
as `board-selection.ts`, with one thing more to carry, since a board is opened
by id and an offer is not in the database at all. It is taken *once*: the crop
hook clears the store the moment it adopts it, so a user who opens the same
frame an hour later is not handed a box they already declined. From there it is
an offer like any other — nudgeable, takeable, droppable — because the hook it
lands in is the one the panel's own ask uses.

### The loop, and what it costs

tech-spec §III.3 asks for prompt → deterministic validation → re-prompt with the
validation error appended, three attempts and then a refusal. `crop-attempt.ts`
is the validation half — pure, so "usable box" means one thing whichever door
the crop came in by — and `cropReference` is the loop around it.

Two faults are named, and both are the model's to fix: an answer that is not a
rectangle, and a strip thinner than `CROP_MIN_SIDE`. The second is why the loop
earns its keep beyond the spec: downstream a sliver and a box that trims nothing
collapse into the same null out of `cropRegionOfBox`, and the caller reports that
as *"the whole frame is the shot"* — of a 12-unit strip, the opposite of what
happened. Caught here, it is said as what it is and the model gets to answer
again.

What is deliberately **not** a fault is the whole frame. The cropper is told to
answer with it when the frame is the shot, so re-prompting would be paying a
photograph read to argue with an instruction we wrote. That refusal stays after
the loop, where it always was.

The correction is appended to the *conversation*, not folded into a fresh
prompt: the model has to see the box it is being told about. That means the
frame is re-sent on every attempt, which is what makes the ceiling a real cost
lever and not a formality — so there is a second, tighter stop. A model that
repeats the box it was just told was wrong has said everything it has to say
about this frame, and `sameCropAnswer` ends it there rather than buying the same
answer twice. `attempts` rides back on the result and onto the `AgentRun` row,
because a box got right first time and one reached on the third read are the
same crop and not the same bill.

Three refusals are said in words rather than thrown, and one of them is said
*before* the call: a frame whose pixels were never recorded cannot be held to a
format at all (`unfittableAspect`), and reading that first is what keeps the
refusal from costing a vision call to arrive at. The other two are after: a box
that could not be opened out to the shape, and "the whole frame is the shot",
which is the cropper reading the photograph correctly and not a failure.

### The shape a cut is held to, when the cut is for a board

The six shapes in `CROP_ASPECTS` are the vocabulary a *user* asks in —
scope, widescreen, a square for a grid, a portrait for a phone — and they are
the whole of the form's picker. They were also, until now, the whole of what a
cut could be, and that made
a hole with a number on it: the widest name on the list is 2.39:1 and the widest
opening any template makes is HERO_LEFT's supporting strips at **3.52:1**. A
picture cut to the nearest name still left a third of that strip showing, and
`SLOT_FILL_GAIN` — correctly — refused to offer a photograph read for it. So the
four strips of one of the ten templates were slots nothing could ever fill, and
the loose-fit report stayed silent about them by design.

`crop_reference` with a `boardId` now holds the cut to the **slot itself**.
Which opening a picture is sitting in is a fact about the scene, not a
judgement, so it is read (`slotShapeFor`, off iteration 22's `scenePlacements`)
rather than asked for — the same division of labour that has the model say which
rectangle and the code say which pixels.

Four things it has to get right:

- **Refine, not override.** The slot's shape replaces an asked-for one only when
  that one is the *nearest name* to the slot — which is exactly what the
  loose-fit report told the model to pass. A user who asks for a square on a
  scope-shaped opening gets a square.
- **Say it.** The answer carries `heldToSlot`, because the cut is not the shape
  the argument named and a reply quoting the argument back would name a shape the
  cut is not.
- **Only where pixels are known.** A ratio is a ratio of a frame's pixels, so a
  frame whose size was never recorded is left alone rather than refined into the
  refusal `unfittableAspect` makes — which would be made *after* the photograph
  had been read.
- **Only in an opening.** `scenePlacements` is strict, so a picture the user
  dragged out of its slot, and every picture on a board that never had a
  template, is cut at the shape that was asked for. Cutting it to a shape nobody
  is holding it to would be the pipeline arguing with their hands.

A shape within 2% of one of the six names is *said* by that name and cut to it
(`cropShapeAt`), so GOLDEN_RATIO's 1.75:1 accent is a 16:9 cut and a SPLIT panel
measured at 0.999 is a square. That costs up to 2% of the fill and buys a label
the column, the review card and the version list can all read — an order of
magnitude under the 32% gap it closes on a HERO_LEFT strip.

The consequence upstream is that `looseFits` now measures the gain against the
opening rather than against the nearest name, which is what it should always
have meant. The loop still terminates, and more cleanly than before: a picture
cut to its slot fills it, is above the floor, and is never mentioned again.

### And the shape a cut is held to when the user simply says one

The slot closed the gap for the one caller that knows an exact opening, and left
the *user* on the six names: `crop_reference`'s `aspect` was a `z.enum` of
them, so "cut it 5:4 for the print" reached the cropper as 4:3 — the nearest name
— and the reply quoted 4:3 back as though that was what had been asked for. The
tech-spec asks for **"a specific ratio, or loose `square`/`rectangle`"**; the
enum was narrower than the spec and had been since the declaration was written.

The parameter is now a string in `width:height`, read by `cropShapeOf`:

- **Both sides, divided out, then canonicalised.** "5:4" and "1.25:1" are one
  shape with one spelling, because the pair goes through `cropShapeAt` — which is
  the same snap the slot shapes already use, so "1920:1080" comes back as `16:9`
  and a SPLIT panel's 0.999 comes back as `1:1`. One shape has one spelling in
  the column, which is what everything reading it back depends on.
- **The usual six are still named in the description.** They are what most asks
  are, and a model given no examples invents its own spelling of them. The
  description is also the only place this is stated — the system instruction is
  unchanged, so the floor of a turn moves by the difference between an enum of
  six strings and a sentence, which is roughly nothing.
- **An unreadable shape is refused, not dropped.** `cropAspectOf` answered null
  for anything off the list and the null was passed on as "no format asked for",
  so a cut framed around the subject came back under a reply saying it was held
  to the shape the user named — §I's silent-drop rule, live in the one tool
  that costs a photograph read. It is refused before the run row and before the
  call, and the refusal names what is readable, so the correction costs a
  sentence rather than a round.
- **A named ratio overrides the opening for free.** The refine rule is unchanged
  — the slot replaces an asked-for shape only when that shape is the nearest
  *name* to it — and a ratio the list does not carry is never the nearest name to
  anything. So "cut it 5:4 even though it is going in that strip" needs no new
  rule and no new argument.

Nothing downstream had to move: `CropOffer.aspect`, the `planCrop`/`addVersion`
schemas, the review card and the version badge already read a measured label
through `cropShapeOf`, because the board-bound cut above had already made them.
The form's picker stays a picker — it is a list of buttons, not a sentence, and
the six names are what a picker is for.

What the offer becomes once it is taken is §III's business rather than the
tool's: the row is filed in the browser, so the only place that can say so is the
browser, and it says it to the conversation that asked. That is the last step of
the loop the compose answer's `looseInSlotNote` writes out — crop at this shape,
take it, swap it onto the board — and until it existed the third step began with
an id the assistant had no way to know.

### And the shape a cut is asked to be when the user names no number

That fixed the *specific ratio* half of the spec's sentence and left the other
half — **"or loose `square`/`rectangle`"** — where it had been since the
declaration was written: nowhere. The description said `"square" is "1:1"`, so
"make it square", "a tall one", "not so wide" all reached the cropper as a format
the user never named, and the box was then opened out about its centre to
reach it. That is the same silent substitution the 5:4 case was, arriving through
the door the fix had just widened: a user who names a *shape* gets a *ratio*,
and the reply names the ratio back.

The `aspect` argument now carries either vocabulary, and they cannot collide —
`square` is a word and `1:1` is a ratio, so `looseShapeOf` is read first and
`cropShapeOf` gets what is left. Four words: `square`, `landscape`, `portrait`,
`rectangle`.

The difference between them is not vocabulary, it is **what happens to the box**:

- An *exact* shape is arithmetic the caller does. The model's box is opened out
  about its own centre until its pixels are that ratio, which is what makes "5:4"
  mean 1.25 and not 1.24.
- A *loose* shape has no ratio to open out to, so the box the model framed **is**
  the cut. The shape is a band it has to land inside — `LOOSE_SQUARE` (1.15) and
  `LOOSE_OBLONG` (1.2), wide where `CROP_SHAPE_TOLERANCE` is tight, because the
  point of a loose shape is that the subject decides the last few percent.

Which means this is also the first ask that makes **the spec's third validation
real**. §III.3 step 2 lists "box aspect within tolerance of the requested ratio",
and iteration 7 recorded that it could never fire: an exact shape is imposed
*after* the loop, so the model's own framing was never held to anything. A loose
shape has no afterwards, so `usableCropBox` takes the band and a box that missed
it is re-prompted with what it came out as — "that box is 4.00:1, which is not
roughly square" — inside the same three attempts, under the same
repeated-answer stop.

Four rules, each of them an abstention as much as a behaviour:

- **The band is measured in the frame's pixels**, because 0-1000 is a share of
  each edge of a picture that is not square. A frame whose size was never
  recorded is therefore not a refusal — nothing can be measured, so nothing is
  claimed: the words still go to the model and the check simply does not run.
  Refusing there would turn a working ask into a correction that arrives after
  the photograph was read.
- **The box is asked about after it is a box.** A 4:1 strip is answered as a
  strip, not as "not square" — a correction the model cannot act on is a
  photograph read spent on the wrong sentence.
- **The board slot refines a loose ask on the same rule, read the same way.** The
  slot replaces an asked-for shape when the opening already *is* what they asked
  for — `loose.holds(slot ratio)` where the exact path asks `nearestCropAspect(slot) ===
  aspect`. So "square for the board" on a square slot is cut to that slot exactly
  and stops being loose; "square" on a 3.52:1 strip stays square. Refining every
  loose ask would answer a word the user chose with a ratio they never named.
- **The offer carries `loose` beside `aspect`, not instead of it.** They are
  different promises: an exact shape is what the cut *is*, to two decimal places,
  while a loose one is what it was framed for and the pixels say how near it
  landed. So the chat tile says both — "Roughly square · 1:1 · Keeps 48%…" — and
  the tool answer says `framedAs`, which is what stops the model reporting a
  ratio nobody promised.

### And the same shape, everywhere the shape is only being carried

Widening the *vocabulary* was one door. The word then had to survive every path a
ratio already travelled, and it survived exactly one of them: the chat tile. Two
inches away, the properties panel — which is where the user actually decides
about a cut — dropped it at every step.

The concrete failure is the **nudge**. A user asks the assistant for a square
crop, gets an offer framed square, opens it in the panel and types "a bit
tighter". `refine` re-asks with `aspect: proposal.aspect`, which for a loose cut
is `null`, so the second answer is framed around nothing and comes back a
rectangle — the shape they asked for lost on the first adjustment, and the loop
the previous section built to re-prompt a missed band never runs, because no band
was sent. Around it, four more silences: the review card said nothing where it
says "Held to 16:9" for an exact cut, the filed row recorded nothing so the badge
was blank and a nudge of that row was unshaped too, the taken-cut note in the
chat named no shape, and the panel's own shape select offered six formats and no
words at all — so the vocabulary the assistant could be asked in was one a
user could not ask in directly.

The fix is one reader, `shapeAsked(value)`, and the rule it encodes:

> The two vocabularies are read **apart** wherever the difference does something —
> a ratio is opened out about the box's centre, a word is a band the box has to
> land inside — and read as **one** wherever the shape is only being carried.

Carried is most places: the column a cut records its shape in, the badge on a
row, the nudge that has to ask the next box at whatever the last one was asked at,
the run row's `aspect`. Those four stop having to know which kind they hold, which
is precisely what stops a loose cut arriving at any of them as a cut with no shape
at all. Where it is not carried but *used*, the split stays: `asked.shape` goes to
`cropBoxAtAspect`, `asked.loose` goes to the model and to `usableCropBox`.

Four decisions:

- **One column, both spellings.** `editAspect` now holds `1.25:1` or `square`,
  validated by `shapeAsked` so it still cannot hold anything unreadable. The
  previous note here said filing a loose cut with no `editAspect` was "accurate:
  it was held to nothing" — true and the wrong conclusion. A loosely framed cut
  lands at *some* exact ratio, so its pixels answer "what shape is it" and can
  never answer "what was asked", which is the question the badge and the nudge are
  both about. Two columns would have been two ways to spell one fact.
- **Both halves in the review, as in the chat.** An exact offer reads "Held to
  16:9 — "; a loose one reads "Framed roughly square — came out 1.09:1 — ". The
  word alone is a promise with no evidence and the number alone is one nobody
  asked for, which is the rule the chat tile already followed — the panel was the
  copy that had neither.
- **The note says framing, not a ratio.** "at 2.39:1" and "framed roughly square"
  are different prepositions because they are different claims, and a cut framed
  square is not *at* anything. The exact one wins if both somehow arrive, which is
  `cropOffer`'s own rule so the two doors resolve the collision identically.
- **The select routes on the value, not on a second control.** The lists do not
  overlap, so `looseShapeOf(value)` decides which argument the ask carries. Four
  words in an `optgroup` labelled "Loosely", because they are not a shorter list
  of formats.

`planCrop` gained a `loose` argument beside `aspect` for the same reason the tool
has both: they do different things to the box, so a caller that cannot tell them
apart is a caller that would open a loosely framed cut out to a ratio nobody
named. The band goes to the model with the frame's pixels; a frame whose size was
never recorded still answers rather than refusing, on the same abstention as
above.

### And a cut the user already has, asked to be different

Every shape argument above is about a cut being *made*. The thing a user says
next is about the cut they are looking at — wider, tighter, more headroom — and
until now the chat had exactly one thing to do with that sentence: pass the cut's
id to `crop_reference`, which cropped it. A box inside a box.

That answer is wrong in three separate ways, and the panel had already written all
three down. It can only ever take **less** of the photograph than the cut already
holds, so "a little wider" is unanswerable by construction. It files a version of
a version, and the properties panel opens on a *frame* — a cut sits inside that
panel as a row in the versions list, so a cut of a cut lands under a row that has
no panel of its own. And the offer it produced was therefore **unreachable**: the
tile's click target was the cut's id, `resolveSecondLevelSelection` answers null
for an id the gallery does not list, and nothing happened. The most expensive call
in the pipeline, spent on a box that could not be accepted.

The panel's own answer to the same sentence is `adjust`: ask the **frame** again
with the cut's box attached, so what comes back is another version of the frame,
beside the one it improves on rather than under it. `crop_reference` given a cut
is now that, reached from the chat:

> A cut named for cropping is a **nudge of that cut**, not a crop of it.

Five things follow, and each of them is a thing the panel was already doing:

- **The frame's bytes, the cut's box.** `cropNudge` reads the row's `cropBox` into
  `previous`, which is exactly what `planCrop` takes. To the cropper there is no
  difference between moving a box it answered with a second ago and moving one
  filed last week — which is why this needed no change to agent 3 at all.
- **The shape the row was cut at, unless a new one is named.** A nudge about a
  scope crop is about where the edges of scope sit; answering it unconstrained
  gives back a cut that is no longer the shape everything else on the board was cut
  to. Read through `shapeAsked`, so a cut filed as `square` is nudged as a square
  and not as the exact ratio it happened to land at — the previous section's rule,
  now reached from the other door.
- **The offer is drawn on the frame.** `referenceId` is the frame, so the tile, the
  click, the review and the filed row are the ones every other offer gets. The
  answer says `nudgeOf` — the named cut is untouched and still in the list — because
  the reply is about a different id from the one the model asked about, and a model
  told only `referenceId: <frame>` would report the user's cut as changed in
  place.
- **The origin travels.** `CropOffer.origin` is the filed row the box came from, and
  the review already knew what to do with one: it is excluded from the duplicate
  check (an offer that overlaps the row it is a nudge *of* is not a duplicate, it is
  the adjustment), it names what was moved, and an offer identical to it is reported
  as a nudge the model ignored. Without it the panel's own warning would have been
  exactly backwards on every chat nudge.
- **On a board, the cut is what it replaces.** `forBoard.takeOff` — the picture
  standing in the slot, which is the cut when the board is standing on a cut and the
  frame otherwise. Swapping the frame out would take off a picture the board does
  not hold and leave the old cut exactly where it was. Emitted only when it differs
  from the frame, so the ordinary offer's wire is unchanged, and the slot's own
  shape is read for whichever id is actually placed.

Two refusals, both before the vision call: a cut whose frame the project no longer
holds, and a cut whose region was never recorded — there is no box to move, and the
nested crop is the one thing that must not silently happen instead.

The general shape, which is now the third instance: **a capability the user's
UI has and the assistant does not is a hole, and the reverse is a defect.**
Iteration 45 found the panel's shape select missing four words the chat could
already be asked in; iteration 46 found agent 2 reachable only from a control the
model could name and not call. This one is both at once — the panel had `adjust`
and the chat did not, and what the chat had instead was worse than nothing, because
it spent a photograph read on an offer with no way in.

### And the board the cut was going to be for

Every rule above about a board is reached through one argument: `boardId`. Pass it
and the offer carries `forBoard`, the browser that files the cut swaps it in, and
the answer's `status` says so; pass a board the picture is not on and
`notOnThatBoard` says the swap cannot happen. Both branches are covered.

The branch nobody had written was the one where **no board is passed at all** —
and it is the common one, because the user does not say "on the Dawn Pitch
Board", they say "that square crop — tighter". There the answer said only
`offered, not filed`, which is true and is not the whole truth: the picture this
cut replaces may be *standing on a board right now*, and taking the offer changes
no canvas.

The live turn that found it did what a model does with a fact it does not have. It
had called `inspect_board` a round earlier, so it knew the board existed; it had an
offer that could not be put anywhere; and it closed the loop the only way it could
see — `swap_on_board`, with the cut that already existed. That call *lands*. The
board really does end up better than it was. And the reply read:

> I've also gone ahead and swapped this square cut onto the "Dawn Pitch Board" in
> place of the wider original shot… now that golden hour slot is perfectly filled!

Every clause of which is true about the **old** cut and false about the one being
offered. The user accepts the tighter cut and it goes nowhere near the board
they were just told was sorted.

So the answer now names them:

> `alsoOnBoards` — the boards standing on the picture this cut replaces, the
> sentence the model must not write, and the call that would close it.

Four decisions in it:

- **A report, not a binding.** Holding the offer to a board the user never
  named would change a board they did not mention *and* cut a different shape from
  the one they asked for — the slot's, not theirs. The board is named and the
  decision stays where every other board change in this layer leaves it. What the
  note buys is a *correct* next call: `crop_reference` again with that `boardId`,
  which is the path that already works.
- **The cut before the frame.** `boardsStandingOn` resolves `takeOff` in the same
  order the `boardId` path does, and one board holding both is named once, for the
  cut. A board standing on a cut loses that cut; told the frame, the model would
  swap out a picture that board does not hold.
- **`swap_on_board` named as the wrong move.** Not because the call is wrong in
  general — it is the right call for a cut the user already took — but because
  it is the move a model reaches for when it has an offer it cannot place, and it
  is the one wrong answer that looks right afterwards.
- **The read is the column priming refuses.** A board's `elements` are megabytes
  (§II item 0), so this is asked only of a project that *has* a board, only when no
  board was passed, and only once the offer is real — a refusal reached before the
  vision call pays nothing. It is one query beside a photograph read already spent,
  bounded by `CROP_CALL_LIMIT`, and it reuses `boardReferenceUsage`, which the
  gallery's own removal warning has read this way since long before.

Measured on the same sentence, before and after: the wrong version called
`list_references, inspect_board, crop_reference, swap_on_board` over three rounds
at $0.14 and wrote a board it should not have; the fixed version calls
`list_references, crop_reference`, writes nothing, costs $0.08, and the reply is
"taking it saves it as a new cut, leaving your original one intact". Naming the
board in the *message* takes the good path outright — `inspect_board,
list_references, crop_reference` with `boardId`, two rounds, $0.06, and the cut
held to the slot's own 1:1.

Still to wire: `build_deck`.

## VI. Cost

### What it is measured with

Every ceiling below bounds a *number of calls*, which is a guess at a bill. The
reading is `src/lib/agent/model-cost.ts`: `usageMetadata` off every Vertex response,
summed the way each agent spends it, and priced in one place.

Four things follow from that being one module:

- **Thinking tokens are output tokens.** They are reported apart from the answer
  and billed at the output rate, so a Pro call that reasoned for a page and
  replied in a sentence reads as twenty tokens unless the two are added up. That
  addition happens once, in `usageOf`.
- **Tokens are stored, money is derived.** `AgentRun` gains `model`,
  `promptTokens`, `outputTokens`, `totalTokens` — columns, not keys in `output`,
  because this is the one thing about a run that is summed across a project and
  a sum over JSON is a sum the database cannot do. A rate written into a row goes
  stale the day the price list moves; the counts never do. `MODEL_PRICES` is the
  one unmeasured thing on this page — everything either side of it is exact.
- **Every model call in the pipeline now writes a row.** Agent 2 already had one
  and now records what a batch of forty photographs came to; agent 3 wrote one
  from both doors and now says what the reads were worth as well as how many
  there were; agent 4 had none at all, and the *cheapest* call is exactly the one
  that needs one, because "cheapest" is a claim about a bill and a block cap gets
  raised on evidence or on a feeling; the orchestrator had none either, and its
  turn is the one that multiplies.
- **A failure is a spend.** The cropper's refusals are its expensive case — three
  photograph reads and no box — so `CropperError` carries its own usage out and
  the FAILED row records it. A ledger that counted only the successes would say a
  bad afternoon was cheap.

`agent.spend` reads it back, grouped by agent. That grouping is the point: one
number over the cropper and the compositor hides which cap to move. It is also
the answer to "monitor the cost" that does not need the Cloud Console — the
console bills a whole GCP project across every app on it and lags by hours, while
these rows are per user's project, exact, and already say which agent spent
it.

### What it came to, measured

`npm run smoke -- "<message>"` runs one real turn through `runOrchestratorTurn`
— the same function the chat's tRPC procedure runs, lifted out of it so the
harness cannot measure a copy — and prints the reply, the tools called, where
each attachment's click lands, and what the turn cost off the rows it just
wrote. Four turns on a two-picture project, every tool exercised:

| turn | tools | in | out | cost |
|---|---|---|---|---|
| "what have I got? show me" | list, show | 4,382 | 543 | $0.015 |
| "crop to the peak, 2.39" | list, crop | 6,198 | 1,427 | $0.029 |
| "moodboard of everything" | list, compose | 5,120 | 1,562 | $0.029 |
| "three crops of that photo" | list, crop ×2 | 8,243 | 1,432 | $0.033 |

Four things the table says that the ceilings above did not:

- **The routing is the bill.** The orchestrator spends ~4,400 prompt tokens a
  turn whatever is asked — 75% of a turn — against the cropper's 1,739 and the
  compositor's 698. Every lever in the list below caps the cheap half. The
  reason is structural rather than wasteful: the system instruction insists on
  `list_references` before any claim about the project, so every turn is at
  least two rounds, and every round re-sends the instruction *and* all four tool
  declarations. Cutting a round is worth more than cutting any agent. **Acted
  on** — see "The round that was bought back" below.
- **Thinking is most of the output, everywhere.** The compositor — "the cheapest
  call in the pipeline" — answered two block/slot pairs with 698 in and **928
  out**, more output than input. The cropper's single box: 747 out. `usageOf`
  reading `thoughtsTokenCount` is therefore not a detail; taking
  `candidatesTokenCount` alone would have under-read every agent by an order of
  magnitude. Confirmed exactly: on all eight rows the API's own
  `totalTokenCount` equals prompt + candidates + thoughts, gap zero, so the
  ledger accounts for everything Vertex reports.
- **The cap the model enforces is free.** `CROP_CALL_LIMIT` is stated in the
  `crop_reference` description, and asked for three crops the model asked for two
  and said so ("I can only process two crops at a time... let me know if you'd
  like the horizon next"). The executor's refusal never fired. A ceiling a model
  can read before it calls costs nothing; the same ceiling discovered by a
  rejected call costs a round. Both crops landed in the same round and both were
  counted — `cropsAsked` increments with no `await` between the check and the
  bump, so concurrent calls in one round cannot both pass a full budget.
- **The console is the worse instrument, measured.** Against
  `aiplatform.googleapis.com/publisher/online_serving/token_count` for the same
  window: minutes after the calls it had ingested about a third of them
  (5.6k of 15.7k input), and only after ~20 minutes did it converge to within 2%
  on input (24,356 vs the ledger's 23,943). Output it reads ~20% higher, which
  is unattributable by construction — the metric is the whole GCP project and
  other apps share it. Two instruments, and only one of them knows which agent
  spent it.

### The round that was bought back

The measurement above named its own fix: the expensive thing was not a tool, it
was the *round* the instruction forced before any of them. So the project is now
written into the turn instead of fetched by a call. `catalogBrief` renders the
photographs one line each — `id · title · shape · keeps · tags` — and
`runOrchestratorTurn` puts it in the system instruction, off the toolset's own
read, so a primed turn is still one database query.

Three things follow from where it is put:

- **In the instruction, not the conversation.** The brief is *state*, re-read on
  every message; a copy left in the history would be a stale gallery the model
  could still quote from. It is on every round for the same reason — the ids the
  model was handed on round one are the ids it resolves against on round two.
- **Lines, not JSON.** Braces, quotes and twenty-four repetitions of the same
  five keys are a third of a catalog's tokens and none of its content. Same
  argument that dropped the palette.
- **`list_references` survives, narrowed.** Priming carries the photographs and
  a *count* of the cuts made of them; the crops themselves are still a call. The
  count is what makes that call worth a round or plainly not worth one, which is
  cheaper than either listing the crops always or leaving the model to guess.

The same message iteration 10 measured, re-run:

| turn | tools | in | out | cost |
|---|---|---|---|---|
| "what have I got? show me" (before) | list, show | 4,382 | 543 | $0.015 |
| "what have I got? show me" (after) | show | **3,158** | 605 | $0.010 |

28% off the input and a round off the turn — the model went straight to
`show_references` and described both photographs correctly from the brief alone
("high-contrast, backlit wide shot… golden hour"), which is agent 2's tags being
read out of the instruction rather than out of a function response. The saving is
a round minus the brief, so it grows with the turn: every tool call the model
makes still re-sends the instruction, but it no longer has to buy a round to
learn what it is looking at. The one turn shape that pays slightly more is the
one that never mentions the project — a few hundred tokens of gallery on a
conversation about lighting in the abstract — which is the trade the table
above prices.

### A conversation, measured — and the two things it broke

Iterations 11–14 (priming, boards in the brief, rebuild in place, add/remove,
the loose-fit seam) were all built with the model call injected and none of them
had met Vertex. `npm run smoke` now takes several messages as one conversation,
carrying history exactly as the sidebar does — role and text, no tool results —
because everything interesting after iteration 12 is only reachable on a second
turn: "add the other photograph to that board" is a rebuild.

Four turns on the two-picture project, one conversation:

| turn | tools | in | out | cost |
|---|---|---|---|---|
| "what have I got in this project?" | show | 4,148 | 500 | $0.01 |
| "make me a new board called Dawn Ridge…" | compose | 5,211 | 1,583 | $0.03 |
| "add the Smoke test picture to that board as well" | compose | 5,533 | 2,077 | $0.04 |
| "take it back off, and crop the landscape to 16:9" | — | 2,167 | 851 | $0.01 |

Priming held: the first turn named both photographs and both boards with no
`list_references` round. The rebuild wrote to the board it was given rather than
filing a second one. And two things were wrong, both of which a test with the
model injected could not have found, because both are about what the model does:

- **The compositor deleted a photograph off a board that had room for it.** Given
  two blocks and a two-slot template, it placed one and left the 1.5 landscape
  off — its instruction said "a board is a selection" and "match shape to shape",
  and it read a wide photograph in a 0.94 slot as a poor fit. On a *rebuild* that
  is not a selection: the picture was on that board a moment ago and the write
  took it off, which is exactly the silent destruction iteration 13 closed the
  other door to. Fixed at both ends — the instruction now says place every block
  while a slot of its kind is free, and `seatUnplaced` seats whatever it drops
  anyway, in reading order, reported as `seatedWhereThereWasRoom` so the
  arrangement nobody composed is not passed off as composed. It refuses to rescue
  a plan that placed *nothing*: that is a broken call, and filling the page in
  reading order would file it as a board.
- **A turn came back with nothing and said "…".** No text, no function call, 851
  output tokens of thinking, $0.01. `finishReason` was being dropped one field
  away from where the answer was read, so the loop could not tell an empty
  candidate from a quiet one. Now `emptyReply` gives each reason a sentence with
  a next step in it, `MALFORMED_FUNCTION_CALL` — the one that is the model's own
  emission failing to parse rather than a decision about the message — buys one
  retry, and the reason lands on the turn's run row. The retry deliberately does
  not consume a tool round: it adds no tool result to the conversation.

Re-run after both fixes, same project: "add the golden hour landscape back onto
the Dawn Ridge board" placed **both** photographs (the model itself this time —
the backstop stayed idle and is now the guarantee rather than the mechanism), and
the message that had produced "…" came back as a two-tool turn — the board
rebuilt without the smoke reference *and* a 16:9 offer keeping 84% of the frame
beside it, both attachments clicking through to the right place. That second
result is a fix that made the failure legible rather than a proven cause: the
original candidate's reason was never recorded, so what is now known is that the
same message succeeds, and that the next one to fail will say why on its row.

### What the console says, once it has caught up

Three hours of this work, cross-checked against
`aiplatform.googleapis.com/publisher/online_serving/token_count` for the same
window:

| | input | output |
|---|---|---|
| the ledger, 20 runs | 56,875 | 14,286 |
| Cloud Monitoring | 53,969 | **14,286** |

Output matches to the token. Iteration 10 recorded the console reading ~20%
high on output and put it down to the metric covering the whole GCP project;
measured again with the runs settled, that gap was ingestion lag, not scope. The
input still reads 5% low for the same reason it did then — the last turn was
minutes old — which is the whole argument for the local ledger in one number: it
is exact immediately, and it knows which agent spent it.

### The conversation that could not get past twenty

Everything above prices what a turn *fetches*. The one input nobody had priced
is what the turn carries in from the last one, and it was unbounded: the chat
keeps every message it has drawn — scrolling back is the point of it — and was
sending all of them on every message. The router bounded the array at twenty and
**rejected** anything longer, so a project's twenty-first message failed
validation and so did every message after it. The conversation was over,
permanently, with a zod error under the composer. Nothing in the pipeline could
recover from it, because the only thing that could send less was the client.

`historyWindow` is what goes up instead, and it is applied at both ends. On the
client so the wire carries what will be read; in `runOrchestratorTurn` so a
caller sending more than fits gets a *shorter answer rather than a rejected one*
— an open tab running yesterday's script is the case that matters and it cannot
be told to send less. The router's cap survives as a bound on the payload (200),
not on the conversation.

Three rules, in order, and the order is the design:

- **Empty messages are not messages.** A blank turn is a speaker handed the
  floor who said nothing.
- **The recent end, by count then by size.** `HISTORY_TURN_LIMIT` (16 — eight
  exchanges, which holds a whole compose → crop → take → put-it-on-the-board
  sequence, the longest workflow the tools have) first, so the size pass never
  walks a thousand messages. Then `HISTORY_CHAR_BUDGET` (6,000 ≈ 1,500 tokens),
  because sixteen short exchanges and sixteen long ones are not the same amount
  of money. A single over-long message is *cut* to `HISTORY_TEXT_LIMIT` rather
  than dropped — the top of an answer is the answer — and the limit fits inside
  the budget, so cutting one can never empty the window.
- **It begins with the user.** A window whose first line is the assistant is
  a reply to a question that was dropped: the model reads its own answer as
  something it volunteered. This fires more often than alternation suggests,
  because a taken-cut note (§III) is the user's turn arriving without them
  typing.

Characters rather than tokens because the budget has to be spent in the browser,
where there is no tokenizer, and an approximation that never under-counts beats
a precise number that costs a call.

The run row records the conversation **as sent** plus `historyDropped`, so a
turn the model answered without the first half of the exchange is one whose
reply is explicable. What the window can lose is an id said in the conversation
and not used within eight exchanges — a taken cut's row id — which is
recoverable through `list_references` at the price of a round, and that is the
correct trade: pinning it would put a growing set of ids in front of the model
on every turn to save a round on the turns that scroll one out.

### Six tools, live — and the board with two names

The second testing iteration the objective asks for, run once the tool list was
complete. Everything from `inspect_board` onwards had been built with the model
call injected and had never been *routed to* by a real model. Five turns,
$0.13 in total:

| turn | asked | tools it chose | in | out |
|---|---|---|---|---|
| 1 | what's on the Golden Hour board? | `inspect_board` | 5,330 | 490 |
| 2 | a new board called Ridge Study with just the ridge photograph | `compose_moodboard` | 6,314 | 1,088 |
| 3 | does everything fit in its slot? | `inspect_board` | 5,976 | 805 |
| 4 | crop the ridge photograph to 1:1 so it fills its slot | `crop_reference`, `inspect_board` | 8,033 | 1,795 |
| 5 | put the smoke test picture in place of the ridge photograph | `inspect_board`, `swap_on_board` | 10,090 | 981 |

Every tool was reached by the sentence it was written for, with no
`compose_moodboard` rebuild used as a question or as an edit — which is what the
last three iterations were for. Three things worth recording:

- **The loop routed itself.** Turn 3's answer to "does it fit" was
  `looseInSlot` off the stored scene, and the model turned it into exactly the
  next call `LOOSE_IN_SLOT_NOTE` asks for — "I can offer you a 1:1 cut" — then
  turn 4 asked for that crop at that shape and told the user to accept it in
  the properties panel and come back. Two tools, two turns, one exchange nobody
  wrote a branch for.
- **The model reads the board before it writes it.** Turns 4 and 5 both called
  `inspect_board` first, unprompted, and it is the right instinct at the right
  price: a query before a write is free, and the alternative habit — writing on
  a guess — is the one the last three iterations kept finding. It does cost a
  round, which is the whole of turn 5's 10,090 input tokens.
- **The same board arrived under two names.** `compose_moodboard` captioned it
  "1 photograph · Split" and `inspect_board`, two messages later, captioned the
  same board "1 photograph · 1920×1080" — because iteration 18 taught the read
  door to name a board by its page, on the argument that the layout was not
  stored. Iteration 20 stored it. `standsAsComposed` is the fix and it is a
  question about the board rather than about the row: name it by the template
  while every picture on it is still sitting in a slot of that template, by the
  page once the user has dragged one out. Both read doors — `inspect_board`
  and `swap_on_board` — use it, so a swap that refits a cut to its slot keeps the
  name the compose gave the board, and a swap onto a picture that had been moved
  by hand does not.

The console agreed to the token, and from the command line: the Monitoring API's
`publisher/online_serving/token_count` over the window reads 92,618 in / 19,445
out against a ledger of 92,618 / 19,445 for the same 28 runs. Iteration 15 had to
wait for ingestion to see that; here it was already settled, and reading it with
`curl` against `monitoring.googleapis.com` is a check that fits in a script
rather than in a browser tab.

### Seven tools, live — the whole loop, and the board that would not say what it said

The third testing iteration, run seventeen iterations after the second. Everything
from `reword_on_board` onwards — the gated tool set and its composed instruction,
the rename branch, the in-place edits, the kind-aware template rule, the per-kind
block budget, a shape the user simply says, two tools editing one board in one
round — had been built with the model call injected and never routed to.

Six turns over a fresh project of four photographs and no boards, $0.22:

| turn | asked | tools it chose | in | out |
|---|---|---|---|---|
| 1 | what have I got in here? | `show_references` | 4,510 | 548 |
| 2 | a board from all four with the headline ACT ONE | `compose_moodboard` | 6,346 | 1,783 |
| 3 | what is on that board? | `inspect_board` | 8,150 | 1,043 |
| 4 | change the headline to ACT TWO, and rename it Dawn Study | `inspect_board`, `reword_on_board`, `compose_moodboard` | 13,020 | 908 |
| 5 | crop the golden hour one to 5:4 | `crop_reference` | 9,312 | 1,617 |
| 6 | crop them so they fill the slots on the Dawn Study board | `inspect_board`, `crop_reference` ×2 | 16,889 | 2,812 |

Every tool was reached by the sentence it was written for and every branch landed:

- **The kind-aware template rule holds against a real ask.** "All four with the
  headline" is four images and a line, which under the old count rule was five
  blocks onto a five-*image* template and a dropped headline. It composed on
  `POLAROID_SCATTER` — 5 image slots, 1 text — and wrote five elements.
- **Two tools edited one board in one round and both landed.** Turn 4's reword and
  rename ran through `boardEdits`; the board came out `Dawn Study` carrying
  `ACT TWO` at revision 1 — one bump, from the reword, because a rename does not
  touch the document. That is the fix of the iteration before this one, live.
- **A user-named ratio was cut at that ratio.** "5:4" reached the cropper as
  `1.25:1`, one attempt, keeping 83% of the frame — and in turn 6 the same tool
  refined two crops to `1:1`, the polaroid slots' own shape, carrying the board so
  the cut lands in place when it is accepted.
- **A ceiling in a description was enforced by the model, again.** Asked for four
  crops it made two and said "I can only run two of these at a time" —
  `CROP_CALL_LIMIT`'s refusal branch never fired, exactly as iteration 10 found.
- **The loop routed itself twice.** Turn 2's `looseInSlot` became an offer of 1:1
  crops in the same reply, and the user's "yes please" four turns later became
  two crops held to the slots with the swap promised on acceptance — with no
  `swap_on_board` call, because the crop carries the board.

And one defect, which only a live turn could have shown: **the tile did not say
what the board said.** Turn 4's whole subject was the headline; the tile under it
read `4 photographs · Polaroid scatter` over a miniature drawing `ACT TWO` as a
grey bar. §III has the fix and the reason it cannot live in the miniature.

The console agreed to the token, again, from the command line: Monitoring's
`publisher/online_serving/token_count` over the window reads 58,227 in / 8,711 out
against a ledger of 58,227 / 8,711 for the same nine runs — the cropper's image
tokens included. Widening the window to three hours picks up an earlier session
and reads 93,970 / 13,870, which is the metric's project-wide scope rather than a
disagreement: the window has to be the run's, not the console's default.

### Agent 2's door, live — and what a turn's bill is actually made of

The fourth testing iteration. Everything since the third — the loose shape a
user says in words and the six places it is *carried*, the unread marks, the
`read_references` door and the fix that stopped it reporting a filed job as a
failed one — had been built with the model call injected and never routed to.
Three turns plus a drain over a four-photograph project, two of them unread, $0.12:

| turn | asked | tools it chose | in | out |
|---|---|---|---|---|
| 1 | which have you not looked at? get them read | `show_references`, `read_references` | 8,696 | 843 |
| 2 | crop the silhouette to a squarish frame around the flower | `crop_reference` | 10,018 | 1,347 |
| 3 | a board of all four with the line Dawn Sunflowers | `compose_moodboard` | 10,159 | 1,788 |
| — | `--drain` | agent 2 ×2 | 8,062 | 1,162 |

Every branch landed and nothing needed fixing:

- **A loose shape survived the whole path.** "Squarish" reached the cropper as the
  band, came back at `[385,420,595,560]` — 780 × 780 pixels on a 5568 × 3712 frame,
  square to the pixel and *not* fitted by any ratio arithmetic, in one attempt —
  and the tile read `Roughly square · 1:1 · Keeps 3%`, both halves, with `square`
  on the run row rather than a ratio nobody promised.
- **The unread marks were read as marks.** The brief said `never read` against two
  photographs; the model named exactly those two, called `read_references` on them,
  and did not describe their look. After the drain their tags are in the next
  turn's brief and it read them straight back.
- **A job that was filed was reported as filed.** From the CLI there is no request
  to run `after()` on, so the kick failed exactly as iteration 47's fix expects: the
  answer said queued-with-no-reader-startable and the reply said "waiting to be
  read", where before that fix it said the whole call had failed.
- **A board composed on unread pictures said so.** `notReadYet` reached the reply
  as "the analyzer still hasn't finished reading two of these", beside the offer of
  cuts that `looseInSlot` had named — four images and a line onto `POLAROID_SCATTER`,
  five elements written.

The finding is about the bill rather than a defect. A probe of the raw
`usageMetadata` shows Vertex returning `trafficType: ON_DEMAND` and **no
`cachedContentTokenCount` at all** for `PRO` — not on the second call of a turn,
which shares a 3,834-token prefix with the first. There is no implicit cache
discount to lean on here, so the input of a turn is close to `modelCalls` copies
of the instruction-plus-declarations-plus-brief base:

| turn | model calls | base × calls | measured in |
|---|---|---|---|
| "remind me what the tags say" | 2 | ~4,040 × 2 | 8,074 |
| "which two sit loosest?" | 3 | 3,834 / 4,507 / 5,258 | 13,599 |

Both numbers now leave `orchestrate` and land on the turn's row as `rounds` and
`modelCalls`. They are different numbers on purpose: a round is a tool result
added to the conversation and is what `MAX_TOOL_ROUNDS` caps, while a model call
is what is billed — the answering call follows the last round, and the
`MALFORMED_FUNCTION_CALL` retry buys a call without buying a round. The comment
on `usage` had claimed since iteration 1 that this was "the number that makes
`MAX_TOOL_ROUNDS` a measured ceiling"; neither number had ever left the function,
so a three-call turn was indistinguishable on the ledger from one large call.

The console agreed to the token for the third time, over the run's own window:
58,609 in / 6,739 out against a ledger of 58,609 / 6,739 for the same eleven runs.

### The brief, the star and the nudge, live — and the board the offer forgot

The fifth live run, and the first with a project that has all three of the things
the last three iterations added: a **user's brief** (51), a **starred**
photograph (50), and a **cut to nudge** (49). Four turns, $0.33, and the ledger
matched Cloud Monitoring **exactly** — 85,644 in / 12,401 out over the run's own
thirteen-minute window, to the token, which is now the third time the window has
been the only thing that had to be right about the console.

Everything the three iterations claimed, held:

- **The brief was read as the argument, not as decoration.** Asked to "pick
  whichever of these carry the brief best", the reply came back in the brief's own
  terms — wide, low, blown-out sky, backlit silhouetted drama — and the compositor's
  recorded `intention` had been written from it rather than from the message.
- **The star outranked the tags.** `POLAROID_SCATTER`, four photographs and a
  headline; the starred frame landed in the 700×467 slot against 680, 660 and 640,
  and the reply said "your starred rim-lit shot takes the most prominent spot".
  Agent 4's one block field that beats what agent 2 read, doing exactly that.
- **A nudge was routed as a nudge.** `crop_reference` on a cut id produced
  `nudgeOf` on the run row, the frame's bytes with the cut's box attached, the
  loose `square` inherited off `editAspect` with nobody restating it — and it took
  **two attempts**, which is iteration 43's aspect-band validation firing on a live
  answer for the first time rather than in a test.

The defect it found is the one in §V above, and it is worth recording *how* it
presented, because the tool layer did nothing wrong: every call succeeded, every
write was correct, and the board genuinely improved. What was wrong was a sentence.
The model, holding an offer it could not place on a board it knew about, called
`swap_on_board` with the cut that already existed and then described that as the
cut it had just offered. Four calls, three rounds, $0.14, and a board revision
spent on a picture the user had not asked to move.

Which makes it the fourth live run in five to find something about **what the
answer says** rather than what the code does — model judgement (15), a naming rule
(24), a tile that could not express its result (42), and now a consequence the
answer knew and did not mention. The one run that found nothing of that kind found
a gap in the ledger instead (48). Injected tests prove the plumbing; a real turn is
still the only thing that prices a silence.

Re-run on the same sentence after the fix: two calls, no board write, $0.08, and
the reply is about the cut alone. Naming the board in the message takes the good
path outright at $0.06.

### The tools a project cannot use

Every lever above prices what a turn *fetches* or *carries*. The one thing left
was what a turn carries before anybody says anything: the system instruction and
the six tool declarations, re-sent whole on every round of every turn. Measured
as characters (≈4 per token), that floor is 12,631 — 8,270 of declarations and
4,361 of instruction — and it is paid by a user who has not uploaded a
photograph yet as surely as by one rebuilding their fourth board.

Most of it is unusable most of the time. `inspect_board` and `swap_on_board` both
take a board id, and the only ids there are come from the boards brief — so on a
project with no boards they are two declarations that can only be called wrong,
under a paragraph of instruction about rebuilding, adding, removing and swapping
on boards that do not exist. `list_references` is for the *cuts* (iteration 11
narrowed it to that when the photographs were primed), so on a project nobody has
cropped it is a tool whose whole description explains why not to call it. And on
a project with nothing uploaded, every one of the six can only answer "no
reference called that".

So the set is a function of what the project holds — three counts, off the two
reads the brief already makes:

| The project | Tools | Chars (≈ tokens), per round |
|---|---|---|
| nothing uploaded | none | 844 (≈211) — **−93%** |
| photographs, no cuts, no boards | show, crop, compose | 7,458 (≈1,865) — **−41%** |
| photographs and cuts, no boards | + list | 8,154 (≈2,039) — **−35%** |
| photographs, cuts and boards | all six | 12,631 (≈3,158) — unchanged |

Three things this had to get right:

- **The instruction is gated on the same counts as the declarations.** They are
  the same waste — prose about `swap_on_board` costs what `swap_on_board`'s schema
  costs — and, worse, an instruction that describes a call the model has not been
  given is an instruction to make a call that cannot be made. So the instruction
  is written in sections and `orchestratorInstruction(brief, state)` assembles the
  ones this project has something for. Called without a state it still returns all
  of them: a caller that does not know what the project holds should get the whole
  instruction rather than a guess at it.
- **The set is resolved per round, not per turn.** A project can gain its first
  board *inside* a turn — that is what `compose_moodboard` does — and a
  declaration list settled before the loop would leave the board tools out until
  the next message. `orchestrate` therefore takes `tools` as a list *or* a
  function and asks each round; `referenceToolset` counts the boards it files so
  the answer changes without a second read.
- **Asking has to be free.** `declarations()` and `brief()` run off the same two
  cached reads — the references the tools share and the four board columns the
  brief already names — so gating costs no query. A gate that cost a round would
  be spending the thing it is trying to save.

What it does *not* do is trim the descriptions themselves, which are the
larger half of the floor and are written the way they are because a ceiling or a
routing rule in a description is obeyed before the call rather than refused after
it (iterations 10, 18, 23). Those are live-validated prose; shortening them is a
change to model behaviour, not to a number.

### And what a declaration *says*, gated on the same counts

The floor is now measurable exactly rather than as characters ÷ 4, because
`countTokens` is free: `npm run floor [projectId]` renders the real system
instruction, the real brief and the real declarations for a project and prices
each part. On the local project with four photographs, a cut and four boards:

| | Tokens per model call | Share |
|---|---|---|
| instruction | 1,528 | 28% |
| the project, primed | 768 | 14% |
| declarations | 3,090 | **57%** |
| **the floor** | **5,386** | |

Two things that table says which the character estimate did not. The floor has
grown 39% since it was last measured at ~3,834 — five tools have been added and
every one of them is paid on every model call of every turn, with no cache
discount to soften it. And the declarations are now the *majority* of it:
`compose_moodboard` alone is 879, `crop_reference` 559.

Which is where the gate above stopped one level too early. It decides which
tools a project is handed; it did not touch what a handed tool *says*. Five of
`compose_moodboard`'s ten parameters are about rebuilding a board — a call a
project with no boards cannot make. `crop_reference`'s `boardId` is a whole
parameter about boards, and half its `referenceId` is about nudging a cut. And
four declarations sent the model to `list_references` for ids on projects that
were never handed `list_references`, which is worse than spend: **a tool named
in a description is a tool the model will try to call.**

So the four declarations that vary are built per project — `showReferencesFor`,
`discardReferenceFor`, `cropReferenceFor`, `composeMoodboardFor`, off the same
`ProjectState` the list and the instruction are gated on, resolved per round so
the turn that files the first board gets the rebuild half back on the round
after it:

| The project | Declarations, before | After | |
|---|---|---|---|
| photographs only | 1,662 | **915** | −45% |
| photographs and cuts | 1,865 | 1,152 | −38% |
| photographs and boards | 2,753 | 2,682 | −3% |
| everything | 2,858 | 2,924 | +2% |

Read against the whole floor rather than the declarations alone, a project with
photographs and no boards pays 2,255 tokens per model call where it paid 3,002 —
**−25% of everything it is charged before the user has said anything.** The
+2% at the bottom is the price of the two correctness halves: "an id from the list
in your instructions" is longer than "an id from list_references" and it is what
the model can actually act on, and 48 of those tokens are the templates-that-carry-text
clause below. A test pins the rule rather than the numbers — no declaration
handed to a project may name a tool that project was not given.

### Three doors that only offer, live — and the headline the template could not hold

The sixth live run, and the first for `duplicate_board`, `discard_board` and
`discard_reference` — three tools built with the model call injected and never
routed to. Four turns, $0.21.

| Turn | Called | Calls | In | Out | Cost |
|---|---|---|---|---|---|
| "keep the Dawn Pitch Board, give me another version with the silhouette in place of the low angle" | duplicate_board, swap_on_board | 3 | 19,452 | 1,780 | $0.06 |
| "bin the Dawn Study board" | discard_board | 2 | 13,235 | 2,052 | $0.05 |
| "get rid of the negative space frame entirely" | discard_reference | 2 | 12,110 | 708 | $0.03 |
| "make me a board … and give it a headline" (boardless project) | compose_moodboard | 2 | 7,886 | 1,422 | $0.03 |

All three doors routed correctly on first contact and all three left the
database exactly as they found it: the copy was made and the swap landed *on the
copy* (silhouette and low angle traded places there, the original's `updatedAt`
untouched), the board offer named its four pictures and its line and deleted
nothing, and the picture offer named all four boards standing on it and deleted
nothing. The two-tool turn also confirmed the merge rule live — one tile for the
copy, drawn as it stood after the swap rather than as `duplicate_board` first
returned it.

What it found was in the fourth turn, which was there to check the new gate:
asked for a board **with a headline**, the model named `TRIPTYCH`. Seven of the
ten templates have no text block at all, so the headline reached the compositor
as a block with no slot of its kind and came back as `unplaced` — the same word a
photograph the compositor *chose* to leave off comes back as. The reply then said
the headline was "set as the board's title", which was true of the title and
false about the board.

Two fixes, and the split between them is the one this layer keeps arriving at.
Before the call: the `layout` parameter now names the three templates that carry
text and says that naming any other with captions in hand leaves the line off —
forty-eight tokens, in the one place a routing rule is free to enforce.
After it: `linesWithNoRoom` and its note say the words are not on the board and
that the remedy is a template with somewhere to put them, so the case that gets
through anyway is reported rather than swallowed. `RANDOM` never needed either —
`resolveLayout` seats by kind — so this was reachable only by *naming* a
template, which is the one thing about a template the model chooses without being
told what is in it.

Replayed verbatim on a second seeded project, the same sentence left the layout
out, `resolveLayout` chose `POLAROID_SCATTER`, and all four blocks were placed:
three photographs and the headline, on the board.

Cross-checked against Cloud Monitoring's `publisher/online_serving/token_count`
over the run's own minutes: 44,797 in / 4,540 out for the conversation and
7,886 / 1,422 for the boardless turn — **both exact against the ledger**. Worth
recording that the first reading was *high* (39,302 on one minute, settling to
36,027 a few minutes later): iterations 10, 15 and 42 all read the early gap as
under-reporting, and it revises in both directions. Query twice, take the
converged reading, and use the run's own window — the metric is project-wide.

### And the floor, re-measured — what widening a gate actually costs

Both tables above are records of the run that produced them, and the 5,386 in the
second one is not today's number: it was measured on a project of four
photographs, a cut and four boards, before the page tools and before either of the
two gates below moved. `npm run floor` is the instrument, so the number is
re-measured rather than carried forward.

Two changes widened the gate. `list_references` moved from `crops > 0` to
`pictures > 0` — it is the door to every picture and its properties, and a project
nobody has cropped was the one project that could not ask. `read_references` moved
from `stalled > 0` to `pictures > 0`, because that count is the pictures with *no*
properties and properties are the whole of what it now answers with: the gate had
come to withhold the tool from exactly the project it is useful on.

Each change was also measured on its own as it landed, but those readings were
taken at different moments on a project that kept changing under them — four photographs, a
board and no cuts for the first, six photographs and no board for the second — and
`floor.mts` renders the *real* project into every shape row, so a brief that grew
moves all four rows on its own. Two such readings are not a series. What is below
is one: the same six-photograph project, both floors taken minutes apart, the only
difference the code.

| | before the three | after |
|---|---|---|
| instruction | 572 | 572 |
| the project, primed | 418 | 437 |
| declarations | 1,082 | 1,192 |
| **FLOOR** | **2,072** | **2,201** |

The 110 on the declarations is the whole of both gates: `list_references` is new
to this project at 103, and `read_references` went 167 → 174 for the longer
wording. The 19 on the primed brief is the unread sentence under the catalog,
which now points at the properties panel instead of naming a call. And the
instruction did not move, which is the one number worth checking every time — it
is the largest single line and nothing here was supposed to touch it.

The shape table prices the same three changes against what a project holds, same
brief, gating alone:

| The project | Before | After | |
|---|---|---|---|
| nothing uploaded | 599 | 618 | +19 |
| photographs only | 1,905 | 2,201 | **+296** |
| and cuts | 2,168 | 2,364 | **+196** |
| and boards | 8,953 | 8,982 | +29 |

The honest reading: a gate is not a discount on a tool, it is the tool's whole
price. *Photographs only* pays both declarations in full and is the shape that
grew — **+296 on every round of every turn**, 16%, because a project nobody had
cropped and nobody had left unread was the one shape both old counts withheld both
tools from. *And cuts* had bought `list_references` with its first crop, so it pays
the 174 and the two wordings. *And boards* was already carrying six unread pictures
and so had both doors open; all it paid for was the wording. And the top row pays
the 19 with no tool to show for it either way: the unread sentence is charged to any
project with an unread picture in it, whether or not it has anything to point at.

Change 2 is absent from every row above, and that is the finding, not an omission.
A title is a *value* on a catalog line the brief was already paying for, so it
costs nothing at the floor — it changes what the primed bytes say, not how many
there are. The two changes that moved the number were both one word in a gate.

Worth it for a reason that is not a token reason — both tools were being withheld
from the projects that needed them most, and a door a project cannot open is worse
than a door it pays for. But the floor is the one line in this file that only ever
grows.

### The levers

The tool layer is where the money is, not the prompts:

- Every lever below is priced in *model calls*, so the turn's row now carries how
  many it was: `rounds` (tool results added to the conversation, what
  `MAX_TOOL_ROUNDS` caps) and `modelCalls` (what is billed — one more than the
  rounds, plus any retry). With no cache discount available on `PRO`, a turn's
  input is close to `modelCalls` copies of the base, so a lever that removes a
  round removes a whole copy of the instruction, the declarations and the brief.
  That is why saving a round beats trimming prose.
- The floor is measurable before anything is spent: `npm run floor` prices the
  instruction, the primed project and every declaration through `countTokens`,
  which is free. Every other instrument here reads the ledger *after* a call and
  prices the whole prompt as one number — the right instrument for what a turn
  came to and the wrong one for deciding what to cut.
- A declaration says only what this project can do, on the same counts the tool
  list is gated on: no board to rebuild, no cut to nudge, no `list_references` it
  was never handed. −48% of a boardless project's declarations and −30% of its
  whole per-call floor, at +0.6% on a project that has everything. The half of it
  that is not a saving is a correctness fix — a tool named in a description is a
  tool the model will try to call.
- The orchestrator is given the tools this project can *use*, not every tool
  there is (`orchestratorTools`), and the instruction is cut to match. It is the
  only lever that moves the floor of a turn rather than what the turn goes on to
  do: −41% of instruction-plus-declarations on a project with no boards, −93%
  before the first upload, nothing at all once the project has everything. The
  set is resolved per round so a board filed mid-turn is readable on the next
  one, and both reads behind it are the ones the brief already makes.
- One database read per turn, shared by every tool call in it *and* by the brief
  the turn is primed with. Two tools asking the same question twice is also how a
  model gets told a reference it was just given does not exist.
- The project is primed rather than fetched, which is the only lever measured to
  move the expensive half of a turn: 4,382 → 3,158 prompt tokens on the same
  message. The board the user has open rides in on the same instruction for a
  few tokens, and every other board is behind `list_boards` and
  `get_board_brief` rather than in it — the same trade read from the other end,
  since a line per board is paid for on every round of every turn including the
  ones that never mention a board, and a cap small enough to be worth paying is
  a cap with no door past it (`orchestrator-tool-reference.md` §II.1). It costs
  one extra small query — four columns, never `elements`.
- The **user's brief** rides in on the same instruction for a second small
  query (two columns off a primary key, asked alongside the other two rather than
  after them). It is the only priming whose cost is bounded by a *cap* rather
  than by the data: `PROJECT_BRIEF_LIMIT` is 1,200 characters against the
  column's 5,000, because 5,000 is ~1,250 tokens on every model call of every
  turn — a third of the measured base — and a brief is re-read on turns that
  never mention it. The cut is reported rather than silent (§I). The saving on the
  other side is not a round but a wrong one: a turn spent asking what the work is
  for, or a board composed against a look the user wrote down a week ago.
- A rebuild (`compose_moodboard` with a `boardId`) is the same single model call
  as a compose, and it is a cost lever in the other direction: without it, "make
  that a 3×3" is a second board *and* a round of the model reading the first
  one's contents back out of the catalog to name them again. `addReferenceIds` /
  `removeReferenceIds` extend that to "put this one on it": the change is applied
  against the stored scene by code, so what would otherwise be a round of naming
  a board's contents back — or, worse, a guess at them — is two lines of a
  declaration. `addCaptions`/`removeCaptions` are the same two lines for the
  board's text, and they buy back the `inspect_board` round a model would
  otherwise have to spend to restate the lines it is not changing.
- `inspect_board` is a query where the alternative was a *write*: the only way to
  answer "what is on this board?" without it was a rebuild, which spends a
  compositor call and replaces the arrangement to find out. It costs ~120 tokens
  of declaration on every round and saves a call plus a destruction on every turn
  that asks about a board — and it is the cheaper answer than priming the
  contents, which would put a mutable set in front of the model on every turn and
  commit it to restating that set on every edit. Its `looseInSlot` extends that
  saving to the other question a board is asked — "does it fit?" — which had the
  same and only answer: a rebuild. The report is arithmetic over the scene and
  the stored template, so it rides on a query that was being made anyway and
  costs nothing on a board that fits.
- `swap_on_board` replaces a *paid* call with a free one, which no other lever
  here does. Putting a cut on a board in place of its frame was a rebuild: a
  compositor call, plus an arrangement the user then has to fix or accept.
  The swap costs one query and one guarded write, and the reason it can is that
  the expensive part of a compose — deciding which picture goes where — is
  already answered by the question. Its `SWAP_LIMIT` (now 10) is legibility
  rather than cost. The **trade** — two pictures the board already holds changing places
  — is the same lever a second time, and it was a refusal until now, so "swap
  those two around" was a compositor call and a reflowed board. The rule
  underneath both: a rebuild is worth paying for when *which picture goes where*
  is still open, and a user who has named both ends of a move has closed it.
- `reword_on_board` is the same lever for the board's **text**, and it was the
  larger half of the two: a picture-for-picture move at least had a *plausible*
  reason to reflow, while changing what a line says has none at all. It was a
  compositor call and a reassignment of every block to correct a letter — and on
  a board the user dragged together, where `layout` is null, a rebuild picks a
  template by block count and writes it over an arrangement that never had one, so
  fixing a typo destroyed the board. One query, one guarded write, no model call.
  `REWORD_LIMIT` (now 10) is legibility, like the swap's. The general shape, now seen
  three times: a *free* edit hidden behind a paid one is found by asking what the
  model does next when the paid tool is the only route to a change the user
  has already fully specified.

  It is also the first lever in this file that **raises** the floor rather than
  lowering it, and the number is worth stating: the declaration is 1,520
  characters and the instruction clause ~330, so a board project's
  instruction-plus-declarations goes from 12,896 to 14,746 (≈3,224 → ≈3,687
  tokens, +14%), paid on every round of every turn whether or not a line is
  touched. Against that, one use saves a compositor call and a reflow. The trade
  is favourable on the *destructiveness* rather than on the arithmetic — a typo
  fix that rewrites a hand-arranged board is not a cost, it is a loss — and it is
  the one gated tool whose payback depends on a turn shape rather than on a
  project shape, so it is the first candidate if the floor has to come down again.
- A **rename** is the same lever inside `compose_moodboard` itself: `boardId` plus
  `title` and nothing else was a compositor call and a reflowed board, and it is
  now a one-column write with no model call and no run row. It is the cheapest
  version of the lever in the file, because it needed no new declaration at all —
  a sentence on the `title` parameter and a branch before the call, on a tool the
  model was already reaching for. Worth stating as a rule: a paid tool with an
  optional-argument shape that changes *nothing the model has to decide* has a
  free path hiding in it.
- **Keeping the seats on a board that is standing** is the same lever a third
  time, and the first one whose saving is a *fraction of a call* rather than a
  whole one: the compositor is asked about the blocks that are joining and the
  slots that are free, so adding one picture to a nine-block board sends one block
  and two or three slot briefs instead of nine and nine. A removal sends nothing at
  all — no call, no run row. What it prevents is worth more than what it saves: a
  reflow moves a cut out of the opening it was cut for, which is a photograph read
  (the most expensive call in the pipeline) thrown away, and then reported back as
  a loose fit so the model can offer to buy it again.
- **Putting a picture or a line on a hand-arranged board** is the same lever
  again, and like the rename it needed no new declaration — `changesContentsOnly`
  plus `standsAsComposed` decide it inside `compose_moodboard`, so the floor of a
  turn does not move at all. What it saves per use is a compositor call; what it
  prevents is the loss the reword entry describes, on the commonest thing anybody
  says about a board they are still building. The pattern is worth stating as a
  checklist rather than as a run of findings: for every mutable set a board holds,
  ask what the **three verbs** are — add, remove, edit in place — and then ask each
  of them against a board with `layout: null`.

  Filling that grid in took two passes and the reason is worth keeping. The first
  wrote "pictures and text each have all three now", which was true of the
  *declarations* and false of the behaviour: text's add and remove existed, and
  both of them still went to the compositor on a board with no template. A verb
  that exists is not a verb that is safe, so the checklist has two columns per
  cell — does the call exist, and which branch does it take on a hand-arranged
  board. Both sets now answer both, for all three verbs.
- `duplicate_board` is the free-edit lever pointed at a *board* rather than at a
  change to one, and its saving is the larger of the two shapes: the alternative
  to a copy was either a compositor call plus a destroyed arrangement (rebuild in
  place) or a compositor call plus an `inspect_board` round plus a set the model
  had to restate (a new board). One query and one write replace both. It raises
  the floor — the declaration is 1,112 characters (~280 tokens) plus a ~90-token
  instruction clause, paid on every round of every turn a project with boards
  takes — which is the reword's trade read again and settled the same way: what it
  prevents is a loss rather than a cost, and the gate (`boards > 0`) keeps it off
  every project that has not composed anything.
- `discard_board` is the one lever here whose saving is not a call at all — it
  is a call that would have been *wrong*. Without it "bin the first one" routes
  to `compose_moodboard` on the board the user wanted gone: a compositor call
  paid, an arrangement replaced, and a board still sitting in the tab row. The
  tool itself is a query. It raises the floor by ~1,050 characters of declaration
  (~260 tokens) plus a ~110-token instruction clause on every round of a project
  with boards, which is the reword's and the duplicate's trade settled the same
  way — the thing it prevents is a loss, not a cost — and it is gated on
  `boards > 0` like the rest of the board doors. The second half is free: the
  tile it draws is `boardShown`'s, the same one three other doors already build,
  and the button under it is the browser's own `moodboard.remove`.
- `discard_reference` settles the same trade one object over, and its wrong call
  is worse than the board's because it *reads as correct afterwards*:
  `compose_moodboard` with `removeReferenceIds` takes the picture off one board,
  leaves it in the project and on every other board, and comes back as a change
  that landed. So this raises the floor too — ~1,200 characters of declaration
  plus a ~140-token instruction paragraph on every round of a project with a
  picture, which is a wider gate than the board doors' — and the justification is
  again a loss rather than an arithmetic saving. Its own cost when called is one
  query, and none at all on a project with no boards: the picture and its cuts
  come off the shared read, and the scenes are only asked for when there is a
  board that could be left with a hole.
- A cut asked for a board (`crop_reference` with `boardId`) removes the *turn*
  that swap still cost. The edit is free but the round that orders it is not:
  the user accepts the cut in the panel, comes back to the chat, says so, and
  the model spends a full routing round — the most expensive part of any turn —
  to make an edit nobody had a decision left to take. Carrying the board on the
  offer moves the swap to the browser that files the cut, for one argument on a
  declaration and one procedure that reuses the tool's own edit. The note that
  comes back says the swap is already made, which is what stops the model buying
  the round anyway.
- **A cut named for cropping is a nudge of it**, and this is the only lever in the
  file that turns a call that was *wasted* into one that lands rather than turning
  a paid call into a free one. The nested crop cost a full photograph read — the
  priciest call the app makes — to produce an offer whose click opened nothing, so
  the user's next move was to say it again and buy a second one. It needed no
  new declaration and no new argument: a sentence on `referenceId` and a branch
  before the call, on a tool the model was already reaching for, which is the
  rename's shape (a paid tool whose *input* already named a free path). Its cost is
  four integers added to the shared reference read.
- **Naming the board an offer leaves standing** is a lever measured in a *write
  that does not happen*. Told nothing, a model holding an offer it cannot place
  calls `swap_on_board` with the picture that already exists: a round bought, a
  board revision spent, and a reply that describes the offer as placed. Measured on
  one sentence, before and after: four tool calls over three rounds at $0.14 with a
  wrong board write, against two calls at $0.08 with none. The read behind it is
  the one column priming refuses, so it is gated three ways — the project must have
  a board, no board may have been passed, and the offer must already exist, which
  is what keeps every refusal and every boardless project paying nothing.
- The stored `layout` is a column bought for three tokens a board line, and what
  it saves is a *turn*: a rebuild that reshapes a board nobody asked to reshape
  costs the round in which the user says "no, put it back", plus a second
  compositor call to do it. It is the cheapest kind of lever in the file — a fact
  written down once at compose time instead of re-derived from a count.
- A taken cut is said in the conversation rather than looked up (§III): the id of
  a cut the user just filed is otherwise reachable only through
  `list_references` with the crops — a round, and one that still leaves the model
  picking the new row out of the other cuts of that frame by reading labels. The
  note costs nothing on the turns nobody crops.
- Holding a board-bound cut to the **slot's own shape** rather than to the
  nearest of six names is a lever with no token cost at either end: the model's
  vocabulary is unchanged, the declaration gains one clause, and the exact ratio
  is read off a scene the tool was already reading. What it buys is the four
  HERO_LEFT strips that no name could close — a slot the loose-fit report could
  only stay silent about, because offering a cut that leaves a third of the
  opening showing is a photograph read for a worse board. It is the same rule as
  every other entry here read backwards: the expensive half of a crop is looking
  at the photograph, and *which shape* was never the expensive half — it was just
  the half the model happened to be holding.
- Taking a **loose shape** — a word with no number in it — is the same lever as
  the ratio below it and it saves the same exchange, on the ask that is commoner:
  most users say "make it square" or "a tall one" long before they say 5:4.
  Without it the model's only move is to pass the nearest format, so the cut is
  opened out to a ratio nobody asked for and the reply names that ratio back —
  and finding out costs a turn and a second photograph read. It costs one clause
  of a description and nothing at all in the pipeline, since a loose shape is
  *less* arithmetic than an exact one: the box the model framed is the cut.
  The one place it spends is the re-prompt it makes possible, bounded by the
  attempt ceiling that was already there.
- **Carrying** that shape through the panel is a lever of the same shape one step
  later, and it is measured in vision calls rather than in tokens. A nudge that
  dropped the band bought a photograph read that came back the wrong shape, so the
  user's next move was a second nudge naming the shape again — two reads to
  get back to where the first offer already was. Recording it on the row extends
  that to every later nudge of a filed cut. The rule generalises past shapes:
  anything the model was *told* and cannot re-derive from what it is handed has to
  ride on the artefact, or the next call is bought to rediscover it.
- Taking **any ratio the user names** costs a string where an enum of six
  stood, and it saves the exchange that used to follow a format the list did not
  carry: the cut came back at the nearest name, the reply named that name, and
  finding out took a user looking at the offer and asking again — a whole
  turn, and the second crop is a second photograph read. Refusing an unreadable
  shape before the row is the same arithmetic in the other direction: a sentence
  now against a read and a correction later.
- The compositor's `looseInSlot` is arithmetic where the alternative is a model
  call: the only other way for the pipeline to notice a photograph sitting in
  the middle of a slot is to render the board and look at it. It costs nothing on
  a board that fits, and `SLOT_FILL_GAIN` is what stops it proposing a crop that
  buys a photograph read and no better board — including the second time, on a
  slot no shape on the list can close.
- The conversation is windowed (`historyWindow`, 16 messages inside 6,000
  characters), and it is the only input multiplied by the *turn's own shape*:
  history rides on every round, so a three-round turn is three copies of it on
  top of an instruction that already carries the project. Unbounded, an
  afternoon's talking would have quietly doubled the routing that is already
  three quarters of the bill — and before that it would have stopped working
  altogether at message twenty-one.
- The block budget is spent **per kind**, which is a lever the other way round
  from most of this list: it does not save a call, it stops the budget buying the
  wrong blocks. `COMPOSE_BLOCK_LIMIT` is twelve and no template carries more than
  two lines, so before the per-kind cap a caption per photograph spent ten twelfths
  of the budget on blocks that could not be seated and reached the compositor as
  two photographs. The saving is real too — a call briefing twelve blocks now
  briefs at most two of them as text — but the point is that a ceiling counted in
  the wrong unit is not a loose ceiling, it is a ceiling that lets the cheap thing
  crowd out the thing being paid for.
- Every ceiling in the layer **truncates and says so** (§I), which is what makes
  truncation the cheap answer rather than the dishonest one. Refusing an over-long
  call costs the honest ask a round to discover a number it could have been told;
  truncating in silence costs nothing and buys a reply that describes work nobody
  did. The three that were silent — `show_references`' strip limit, `SWAP_LIMIT`,
  `REWORD_LIMIT` — now name what they left, and the note tells the model to call
  again with the rest rather than to report them done, which is affordable
  precisely because both edits are free.
- The catalog is capped and the palette is left out of it — six hex codes per
  reference would be a quarter of the catalog's tokens spent on something a
  model cannot see.
- A picture agent 2 has not read yet is **marked** rather than left blank (§I),
  and the mark is priced to be paid only by the project that needs it: three or
  four tokens on a marked line, one sentence under a list that has one, and a
  second query made only when some row has no analysis. A project agent 2 has
  finished with pays nothing. What it buys back is the round the *other* answer
  would cost — a model that has described an unread photograph as plain is a
  model the user has to correct, and the correction is a whole turn.
- The user's **star** is a lever the same size as the unread mark and it was
  free in a way none of the others are: the column was already being read — it is
  the first key of `GALLERY_ORDER` — so carrying it costs one `select` field, one
  word on a starred line and one sentence under a list that has one. A project
  with no stars pays nothing. What it buys is not a saved call but a saved
  *correction*: the largest slot on a board is agent 4 answering "which picture is
  this about", and a board whose hero is not the one the user starred is a
  rebuild — a compositor call and a reflow — plus the round in which they say so.
- `read_references` was a mark's missing door (§I) and priced like the mark above
  it: gated on `stalled`, so a project agent 2 had finished with paid nothing for
  it, and the reading it bought was a vision call each, bounded at `READ_LIMIT`
  (8) across the *turn* rather than per call. Both halves of that pricing are
  gone. It costs no model call at all now — it reads the rows agent 2 already
  wrote — so its ceiling is per call and about what fits in an answer, and it is
  declared for any project with a picture in it, which is 174 tokens on every
  round of every turn of a project that used to get it free. Priced honestly at
  the end of §VI. What it saves is a round: the palette and the rationale are in
  no digest and no primed line, so before this the only answer to "what's the
  colour like in that one" was a reply that had never read it.

- `MAX_TOOL_ROUNDS` is 3. A stuck model calling the same tool forever is a real
  failure mode and a real bill.
- Everything under the orchestrator is deterministic code, so adding a tool is
  usually adding zero model calls.
- Two tools cost a model call, and they cost opposite amounts.
  `compose_moodboard` is the cheapest call in the pipeline — text in, pairs of
  ids out, no image parts — bounded by the block cap (12), because offering the
  whole gallery to a nine-slot template is a catalog read twice.
  `crop_reference` is the most expensive: it reads a *photograph*. So it is
  capped at `CROP_CALL_LIMIT` (2) per turn, counted on the toolset, which is per
  request — a model with three rounds could otherwise ask for the same crop in
  each of them, and "crop them all for the board" would be eight vision calls on
  boxes nobody has looked at yet.
- Every crop the tool asks for writes an `AgentRun` row, exactly as the panel's
  own ask does, so what the pipeline spent is readable off the same table
  whichever door the crop came in by — including `attempts`, since a crop is now
  worth between one and three photograph reads and the row is the only place
  that difference is visible.
- The cropper's retry ceiling (`CROP_MAX_ATTEMPTS`, 3) bounds one *ask*;
  `CROP_CALL_LIMIT` (2) bounds one turn's *offers*. They multiply, so a turn's
  worst case is six reads and its expected case is two — the gap between the two
  is why the loop refuses to re-prompt a repeated box and refuses to re-prompt
  the whole frame at all.
- `MAX_TOOL_ROUNDS` is the one ceiling the user can *see* being hit: a model
  stopped mid-tool-call has written no text on that round, so the reply falls
  back to `STUCK_REPLY` rather than to "…". The attachments the rounds did buy
  are still shown — a turn that ran out of steps is not a turn that found
  nothing. Only the cap earns that sentence; a tool call with no executor behind
  it is a wiring fault, and telling the user to ask again would be a lie.
- A round that comes back **empty** is the only spend with nothing at all to show
  for it, so `finishReason` decides what happens next rather than being dropped:
  a malformed function call buys one retry (it is a parse failure, not a
  decision, and the alternative is a round already paid for that answered
  nothing), and everything else — a limit, a block, a refusal — is said in a
  sentence with a next step in it. Asking a refusal again unchanged would buy the
  same no at the price of another round.
- Two board edits in one round are queued rather than run side by side
  (`keyedQueue`, §I). It is not a token lever — it saves the *round* a model
  spends re-making an edit it was falsely told the user had overwritten, and
  in the `compose_moodboard` case a whole compositor call, which had already been
  paid for by the time the guard refused its write. Keyed by board, so the two
  calls actually worth running together — two crops, two vision calls — still do.
- A reading that was filed is never reported as one that failed (§I). It is the
  cheapest kind of lever and the failure it prevents is the most expensive one in
  the file: a `read_references` that answers with an error while its jobs sit in
  the queue leaves the model with two moves, and one of them is to ask for the
  same pictures again — eight photographs read twice by agent 2, the priciest
  call the app makes, for a wake-up that was only ever an optimisation over the
  scheduled drain.
- `npm run spend` prints the ledger from the command line, whole database or one
  project; `npm run smoke -- "one" "two"` buys a real *conversation* and prints
  what each turn came to, which is the only way to price the tools that are
  reached on a second turn — a rebuild, an add, a swap. `--drain` adds the one
  agent a turn does not wait for: it empties the analyzer queue afterwards, at a
  vision call per picture, which is why it is a flag and not the default.
- Every model call is injected — `compose` and `crop` into `referenceToolset`,
  `generate` into `orchestrate`, `run` into `runOrchestratorTurn` — so the whole
  agent layer was built and the four things only the executor knows are asserted
  without spending anything: what a tool costs (the crop budget is spent once per
  *turn*, not once per round), what it writes (an `AgentRun` row either way, a
  `Moodboard` row at the template's page size), what of the database it lets out
  (no `gs://` in any answer the model reads), and that a turn is billed for its
  routing and not again for the crops it ordered. The real calls above were
  therefore deliberate, and the first one worked end to end.
