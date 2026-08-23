# Tools

The design record for `agent-tools.ts` and `designer-tools.ts` — the contract
between the agents and the project: what is primed before any tool, which tools
a project's state opens, what an answer is allowed to cost, and the dialect
agent 8 reads all of it in.

Mechanical invariants stay in the code, as `///`: what a reader has to know in
order not to break it. What is written here is the other half — the decisions,
the measurements behind a number, and the arguments about wording. A module
cites its section by name (`Tools.md §VII`), which is what `npm run cites` and
`citations.test.mts` resolve.

One thing in those two files is neither: **a tool's `description` is the model's
input, not commentary.** It is read on every round of every turn and it is what
the routing decision is made from, so it stays exactly where it is however long
it runs. Only the prose *about* a description moves here.

This file is in git. `context/` is not, so where a `context/` doc and this one
disagree about these two modules, this one is what was built.

## I. The contract and the seam

`agent-tools.ts` — the contract between the agents and everything they are
allowed to touch.

tech-spec §III gives every agent below the orchestrator a narrow, declared input
and no way to wander outside it, so the tools here are deliberately not "the
database, exposed". They are the two questions an agent tier can ask about a
project's pictures — what is in it, and put these in front of the user — plus
the shape an answer comes back in.

Kept pure and out of `server/` because both sides need it: the executor builds
these values, the chat renders them, and a tool whose answer the UI cannot draw
is a tool the user never sees the result of.

### 1. Why `ToolDeclaration` and not the SDK's

The function-calling shape Vertex takes, declared once and here. This module is
also loaded in the browser to render what a tool answered, so it cannot reach
`server-only` code — and `server/google/vertex` imports this name back for its
own `GenerateConfig.tools` rather than restating it, which a type import in that
direction can do because it erases.

Not the Gen AI SDK's `FunctionDeclaration`, which would erase the same way and
so would dodge that problem: its `parameters` is the SDK's `Schema`, whose
`type` is the `Type` enum, and every declaration in the module writes
`type: "OBJECT"` as a string literal. The wire takes both spellings; the
compiler takes one, so the cast is made once, at the seam. tech-spec §VII.

## II. Priming

What is written into the turn instead of fetched by a tool call.

### 1. The project brief

The one thing in the priming that nobody and nothing derived: the title they
typed and the brief they wrote. Everything else in a turn is read off pixels
(agent 2's tags), off the file (shape, size) or off a row the pipeline itself
wrote (cuts, boards). This is the standing intent all of that is *for*, and it
sat in a column nothing read while the header rendered it above the chat. First
in the priming rather than last: the catalog and the boards are read against it,
not the other way round.

`PROJECT_BRIEF_LIMIT` = 1200 is not a readability cap. The column holds 5,000
characters, which is roughly 1,250 tokens on *every model call of every turn*,
against a base measured at ~3,800 (§VI) — so a brief written to the column's
limit would be a third of the bill of every turn, including the ones that never
mention it. Cut on a word boundary and said out loud, because a user's own words
silently halved is the model answering from half a brief while believing it has
read the whole one.

`PROJECT_BRIEF_NOTE` says three things the model cannot work out from the text
itself: that the brief outranks anything read off a picture when deciding what
matters, that this message wins where the two disagree — a user asking for
something the brief does not mention is changing their mind, not making a
mistake — and that the assistant has no way to write it, so a brief that has
gone stale is something to mention rather than to work around. Said once, and
only to a project that has one.

### 2. The catalog

**Measured (iteration 10): the routing is ~75% of a turn's bill**, because the
system instruction demanded `list_references` before any claim about the project
— so *every* turn was at least two rounds and every round re-sent the
instruction and all four tool declarations. A round costs more than this list
does: twenty-four of these lines is a few hundred tokens against a round's
couple of thousand. So the catalog is primed, and the tool stays as the door to
every picture — including what priming cannot carry, the crops.

Lines rather than JSON for the same reason the palette was dropped: braces,
quotes and repeated keys are a third of the tokens of a catalog and none of its
content. One reference on one line, in the order a user reads it: what to call
it by, what it is called, whether they marked it, what shape it is, and what it
is of.

`CATALOG_LIMIT` = 24 is how many references one catalog answer carries. Every
row in it is tokens on every subsequent turn of the conversation, so this is a
cost ceiling first and a readability one second: a user with two hundred uploads
gets the most recent slice and a count of the rest, not the whole gallery
inlined into the context window. The count of what did not fit is the half a
truncated list cannot say for itself — a model that reads twenty-four rows and
answers "you have twenty-four references" is lying on our behalf.

### 3. The three marks

`STARRED_MARK` is the user's own mark, in one word, ahead of the shape rather
than after the tags: the tags are a comma list, and a word appended to the end
of one reads as another tag. The gallery's star is the one thing in this
pipeline the user says about a picture in their own voice — agent 2's tags are
read off the pixels and the title is usually a filename. It costs one word a
line and it is the only signal that answers "which of these matters", which is
the question every slot assignment and every truncated list is deciding by
proxy. `agent-tools.md:148` has the semantics.

`MADE_MARK` is a picture this assistant drew, in one word, beside the star and
for the same reason: it is a fact about the picture that no tag carries and that
changes which one to reach for. Without it the model reads a backdrop it drew an
hour ago as a photograph the user shot, and "prefer a picture they already have"
quietly becomes "prefer the last thing I made". A cut of a drawn picture carries
the mark too — the column is inherited — so the sentence says where the pixels
came from rather than claiming every marked line was drawn in one call.

The second half of that sentence is a claim about the rest of the list, so it is
read off the list: on a project whose every line is marked there is no
photograph they brought, and "prefer one they brought" is advice about pictures
that are not there. What is left to say there is the reason that survives —
reaching for the drawing again is cheaper and steadier than asking for it twice.

The unread marks answer why a picture's line carries no tags. A photograph agent
2 has not read yet and one it read and found nothing in are the same blank space
at the end of a line, and the difference is the whole difference between "this
picture is plain" and "nobody has looked at it". The analyzer runs out of band —
a user who uploads eight frames and asks for a moodboard in the same breath is
asking about pictures whose tags have not landed — so the blank is the common
case on the turn that matters most, not an edge one.

Three reasons rather than one, because they need three different next steps: a
queued run arrives on its own, a failed one has to be asked for again from that
picture's properties panel, and a reference with no run at all was never offered
to agent 2. An unmarked line with no tags therefore means what it should — read,
and nothing came of it. `unreadReason` answers null for a picture that was read:
a run that succeeded wrote an `Analysis` row, so a succeeded run beside no
properties is a picture the model found nothing in rather than one nobody looked
at.

`UNREAD_MARK` is three or four tokens on a line, against a sentence of
explanation carried once under the list. A project whose pictures are all read
pays neither. It is exported because a page's blocks are said in this same
format (§V.4): a picture on a page and a row in the catalog have to describe the
same reference with the same words, and a second wording for "nobody has looked
at this yet" is the model being handed two dialects in one prompt.
`UNREAD_CATALOG_NOTE` is the same thing said to a *tool answer* rather than to
the instruction, and is only attached when something in that answer is marked.

Every one of the three notes is said once and only when something is marked. The
note is the expensive half, and a project agent 2 has finished with should not
carry a paragraph about a state none of its pictures are in.

### 4. The board line

A `BoardDigest` is a board as the model reads it: the id it is rebuilt by, what
it is called and what size page it was laid out on. Not what is *on* it — the
elements of a board are up to two megabytes of JSON each, and reading every
board's scene on every message to count photographs would be the most expensive
thing in a turn that never mentions a board.

`boardLine` is exported because a board looked up and a board primed have to
read identically, or the instruction would have to say which of the two the
model is holding. The full argument for priming one board and putting the rest
behind `list_boards` and `get_board_brief` is
`orchestrator-tool-reference.md` §I. A null board is a turn sent from somewhere
that is showing no board — a project page, a tab whose board was deleted in
another one — and the count is still said: what the model must not do is read
"no board open" as "no boards".

`PAGE_NAMES_PER_LINE` = 6 is how many page names one board's line carries. A
spread is two or three pages and this is here for the board that has been built
up all week — past it the line stops being a line, and the ones dropped are
counted rather than left to read as the whole board. The names are said only
when they agree with the count: a row written before the column existed has
none, and a board saying "3 pages" beside two names would be the model choosing
between pages that are not the board's. Nothing said is the state this line was
in before names were stored, which the model already handles by reading the
board.

A page the user never named is said by its ordinal, unquoted: quoting "Page 3"
would put a name on the page that the canvas does not draw above it, and the
user asking for "the third page" is the only way it can be named.

## III. The gate

`ProjectState` is what the project has, in the three counts that decide which
tools are worth declaring. Read off the same query that primes the turn, so it
costs nothing.

### 1. Which tools are declared

Declarations are the one input paid on *every round of every turn*: the set is a
couple of thousand tokens of schema and prose re-sent each time the model is
asked anything, and a tool that cannot be called on this project is that spend
for nothing. So the set is a function of what the project holds:

- **Nothing uploaded** — nothing that takes an id has anything to act on, so only
  `generate_image` is declared. A user talking about the look before they have
  uploaded is a real turn, and it should not carry the schema of six tools that
  can only answer "no reference called that" — but it is also a turn that can ask
  for a picture, and generating one is how that project stops being empty.
  `list_references` is in the gated set rather than gated on the cuts: it is the
  door to every picture and its properties, and a project of photographs alone is
  one it can still answer for. The priming makes its answer a repetition for the
  first `CATALOG_LIMIT` photographs, which is a reason not to *call* it — a
  reason the model can only weigh if it has it. `read_references` is in the same
  set for the same reason, and its count used to be the stalled pictures — which
  is now exactly backwards: stalled is the pictures with *no* properties, and
  properties are the whole of what it answers with. On a project agent 2 has
  finished with it went from being the one tool declared to being the one tool
  withheld.
- **No boards** — `inspect_board`, `duplicate_board`, `swap_on_board` and
  `reword_on_board` all take a board id, and the only ids there are come from the
  boards brief. `compose_moodboard` stays: it is what makes the first one.

Order is fixed rather than derived, so two turns of one conversation hand the
model the same tools in the same order.

### 2. What the surviving declarations say

The same counts then decide what a declaration *says*: the ones built per state
drop the parameters and clauses that name something this project has not got — a
board to rebuild, a cut to nudge, a round on `list_references` that could only
repeat the priming. A field with no id that could fill it is the same spend for
nothing one level in, and a description naming a tool the model does not have is
worse than spend: it is a call it will try to make. Both are gated on the same
counts, re-read per round, so the turn that files the first board gets them back
on the round after it.

`idsFrom` says where the ids a tool takes come from, as this project can answer
it. The photographs are primed into the instruction on every turn; the *cuts*
are only reachable through `list_references`. That tool is now declared wherever
these descriptions are, so this is no longer about naming a call the project was
never handed — it is about not spending a round to be told what the turn already
carries. On a project nobody has cropped, `list_references` answers with the same
photographs the instruction list holds, and pointing the model at it is pointing
it at a repetition.

`compose_moodboard` is the largest declaration in the layer, and eight of its
thirteen parameters are about rebuilding a board — a call a project with no
boards cannot make. Those are the ones gated. `design_page`'s `imageIds` is
gated on the project having pictures for the same reason, and the designer can
draw its own either way, which is what makes the empty case coherent rather than
crippled. `generate_image` is the one tool declared on a project with nothing in
it (§IV): every other one answers a question about pictures this project already
has, and this is the one that makes the first of them. Ungated, then — but not
stateless, because the whole reason it is worth a round is that the id it answers
with can be placed, and which tool places it is a function of what the project
holds.

`design_page`'s routing rule is in the description rather than in a comment
because it is the decision the whole design rests on. A model that cannot tell
it from `compose_moodboard` reaches for the expensive one every time — and the
two are not near-neighbours in cost: a compose is one vision call over a
catalog, and a design is a loop with a picture in every round of it.

`set_page_background` is the one page tool of §IV.2's set that is not forked for
agent 8, and the reason is `read_canvas`. The other four send the model to
`inspect_board` for a page id, warn it off `compose_moodboard`, or close on
offering a compose — tools agent 8 does not hold — so each needed a second
description. This call points at the read *both* agents have, and that read is
also the one that reports a page's `background`, so the sentence that is true
for agent 6 is the same sentence that is true for agent 8. One declaration, one
executor, and no clause to keep in step across two files.

`set_canvas_background` is the board's own ground (§XI.3), and the one canvas
tool of this set agent 8 does not get. The split is what the two agents are for
rather than a judgement about trust: agent 6 acts on the board a user is looking
at, agent 8 acts inside one page it was handed. A design assistant asked for a
poster repainting the desk the user's other five pages sit on is a change to
work it was never shown, and the thing it actually wants — the page's own colour
— it already holds in `set_page_background`.

## IV. Ceilings

Every `*_LIMIT` in the module, and what a refusal says. The set as a whole is
`orchestrator-tool-reference.md` §III.

### 1. The ones that bound a bill

`CROP_CALL_LIMIT` is how many cuts one turn of the conversation may ask for.
Every other tool here is a database read; this one is a vision call on a
photograph, which is the most expensive thing this app does. So there is a
ceiling at all: a loop that has decided to crop does not stop on its own. It
sits at `COMPOSE_BLOCK_LIMIT` because that is the size of the thing being
cropped. "Crop everything on this board to fit" is one sentence about a board
that may hold twelve pictures, and a ceiling of two turned it into six turns of
the user saying "and the next one" — which spends the same vision calls and six
times the routing to get there.

`GENERATE_CALL_LIMIT` = 2 is how many pictures one turn may buy — the same
ceiling and for the same reason twice over: a generation is a model call on the
most expensive model here, and a user who asked for a background is looking at
one picture, not at four tries. Two rather than one so a first answer the user
rejects can be re-asked in the same turn.

`READ_LIMIT` = 8 is how many pictures one call answers with the whole of. A full
analysis is a palette, a paragraph of reasoning and five lists of tags — several
times a catalog line each — so this ceiling is about what fits in an answer
rather than about a bill: nothing there costs a model call. Per call rather than
across the turn, for that same reason. The turn-wide count it used to be was
protecting a vision call that no longer happens, and a second ask now re-reads
rows that are already written.

### 2. The ones that bound what a person can read

`SHOWN_LIMIT` = 8 is how many references one `show_references` call may put in
the chat. A reply carrying more pictures than a user can look at is a reply they
scroll past.

`SWAP_LIMIT`, `REWORD_LIMIT`, `MOVE_LIMIT`, `CANVAS_PUT_LIMIT`,
`CANVAS_REMOVE_LIMIT`, `CANVAS_TRANSFORM_LIMIT`, `CANVAS_REORDER_LIMIT` and
`CANVAS_RESTYLE_LIMIT` are all 10 and all the same ceiling: these calls are
free, so the bound is legibility rather than cost. Past a handful the user is
being handed a board, a page or a set of words they no longer recognise, and
`compose_moodboard` is the tool for arranging a set. `CANVAS_REMOVE_LIMIT` caps
the *asks* rather than the elements, because one selector can sweep several — a
referenceId takes every copy — and the asks are the number the model chose.
`CANVAS_RESTYLE_LIMIT`'s version of the sentence is a board that changed colour
while the user was reading it.

`BOARD_LINES_SHOWN` = 3 and `BOARD_LINE_CHARS` = 60 bound how many of a board's
lines a tile shows and how much of one. A board is at most two lines when a
template composed it; a hand-arranged one has no bound at all, and neither does
the length of what the user typed into it.

### 3. What a refusal says

`cropCeilingSaid` is `generationCeilingSaid`'s rule, one tool over and for the
same reason: the ceiling counts calls, and a read the cropper refused — a box
that is the whole frame, a shot it could not find — costs the same photograph as
one that came back with a cut. So a turn whose reads were all refused used to be
told "ask the user which of them is the one" about cuts it does not hold, which
is the same instruction to describe something that does not exist that the
generation ceiling was corrected for.

And a stop rather than a question, in all three branches. The cuts are *filed* —
they are in the project and shown beside the reply — so there is nothing for the
user to choose between and nothing waiting on their answer. Asking which of them
is the one made a ceiling the loop hit into a turn that ended by handing the work
back.

`generationCeilingSaid` says it in terms of what is actually in the project
rather than of what was paid for. The ceiling counts calls, not pictures — a
refusal by the image model costs the same money as a drawing and spends its
place — so the two numbers come apart exactly when the turn went badly. A turn
whose attempts were all refused has nothing to show, and "show the user what you
drew" is then an instruction to describe a picture that does not exist, which is
the one thing the whole file's `status` wording exists to prevent.

### 4. The two board doors

`list_boards` exists because the priming stopped naming every board (§II.1): one
board is primed, and a project's other boards are a round when a message is
about one rather than lines on every round of every turn in case it is. That
trade is only the right way round while there *is* a round to spend — a board
the model cannot name is a board it will confidently rebuild as one of the ones
it was told about. It is cheap enough to be that round: it answers off the same
few digest columns the priming is built from and never reads a scene, which is
what separates it from `inspect_board` — this is *which board was that*, that is
*what is on it*, and the second is megabytes of elements.

`get_board_brief` is the pair to it and the cheaper half: a model that already
has an id — out of a tool answer earlier in the turn, out of a board it just
made — needs what that board *is* before it acts on it, and the alternative was
listing every board to read one line back, or `inspect_board` reading a whole
scene to answer a question about the board's size.

## V. Digests and answers

### 1. What a digest carries

A `ToolReference` is a reference as the database holds it, in the columns a tool
needs. Written as the loosest shape that answers those questions so the executor
can hand over a `forDisplay` row untouched.

A `ReferenceDigest` is one reference as the model reads it. Every field earns
its tokens: the id is how the model points back at it, the shape is what decides
whether a crop is even possible at a format, and the tags are the vocabulary the
whole pipeline talks in. The bytes are never in there — an agent that needs to
*look* at a picture is given its `gs://` uri as a file part, not a JSON field.

`aspectLabel` gives the shape of a picture by the name a user would use for it,
falling back to the ratio itself. A row uploaded before the dimension columns
existed has no shape at all, and saying so is better than inventing a square.

`digestTags` flattens the tags across the dimensions into the one list the model
reasons over. The palette is deliberately left out: six hex codes per reference
is a quarter of the catalog's tokens spent on something a model cannot see
anyway.

`drawnFrom` reads blank as absent for the reason a blank analysis does: a
`drawnFrom: ""` beside a picture with no tags is an empty answer to "what is
this of", which is worse than no answer. Read off the column and not off
`origin` — a cut inherits its frame's provenance but not the sentence behind it,
so a crop of a drawn backdrop is marked as drawn and has nothing to quote.

### 2. The one place the palette can be reached

`ReferenceProperties` is one reference with the whole of its analysis, which is
what `read_references` answers with. The digest is a summary by design:
`digestTags` flattens five dimensions into one list and drops the palette,
because six hex codes on twenty-four primed lines is a quarter of the catalog
spent on something a model cannot see. That argument is about a list of every
picture; it does not hold for one picture the user is asking about, and until
this nothing could answer that question at all.

The flattened `tags` is left off rather than carried beside the dimensions — it
is the same words a second time, and a field called `tags` meaning one thing on
a catalog line and another here is two dialects in one prompt. So is `unread`: a
reference this can be built at all has been read.

`referenceProperties` is null for a reference with no analysis, which is the
caller's filter: the answer excludes it rather than describing it, since every
field would come back empty and an empty palette beside an empty rationale reads
as a picture with no colour in it.

### 3. Naming ids back

`pickReferences` answers with the references a `show_references` call named, in
the order it named them, and the ids that answered to nothing. Unknown ids are
reported rather than dropped: a model pointing at a reference that is not in
this project has misread the catalog, and it can only correct itself on the next
turn if it is told which id failed.

And so are the ones the limit cut off, for exactly the same reason. An id that
named a real reference and did not survive the slice used to appear in neither
list — so a call naming twelve pictures came back with eight and nothing to say
the other four had been asked for, which is the failure `missing` was invented
to prevent arriving through the other door. `agent-tools.md` has `overLimit`'s
own account.

## VI. Attachments

A `ToolOutcome` is what a tool answers with: the JSON the model reads back, and
the pictures the user sees. They are separate because they are for different
readers — the model gets ids and tags, the chat gets thumbnails, and neither is
served by being handed the other's half.

### 1. Something to look at, and the id it takes to get there

A `ReferenceAttachment` is a picture rendered in the chat beside the reply, and
clickable. tech-spec §IV: a result the user cannot open is a result they have to
go find again by hand. So an attachment carries what it takes to draw it *and*
what it takes to walk to it — for a crop that is the frame it came out of,
because the crop's properties live under that frame and nowhere else.

A `BoardAttachment` has the same two halves, because a board the user has to go
and find in the tab row is a board they compose again by hand. Its caption is
what the board *is* — how many photographs, how many lines and in what shape —
rather than what it is called, which is already on the tile. The page a tile is
of is said as the user knows it, and said only when it tells them something: the
only page of a board is the board, its name is already on the tile above that
line, and "page 1 of 1" under it is a caption disambiguating nothing at the cost
of the shape it pushes off the end.

`PageDiscardOffer` is which page a board tile's Discard button would take, when
it takes a page rather than the board. Set only by `discard_page`. A payload
beside `discard` rather than a second flag, for the reason the reference's is
one: the browser has to name the page in the conversation *after* the write, and
by then the frame it was reading the name off is gone.

`attachmentTarget` says where a click lands. The workspace holds which half of
the page is showing and the properties panel is opened by id, so a target is
those two facts and nothing else — the chat does not need to know how either is
done. `agent-tools.md` has the `versionId` case.

### 2. Each picture once, and a board as it now stands

`attachmentKey` is what makes two attachments the same attachment. A model that
lists a board and then talks about it has answered once. A cut is a reference
like any other here: it has a row of its own, so two cuts of one photograph are
two ids and key apart without help.

`mergedAttachments` keeps one conversation's attachments in arrival order, each
picture once. A model that shows the same reference on two turns of one exchange
means it twice; the chat only has room to draw it once.

A picture is the same attachment however often it arrives — the bytes of a
photograph do not change. A *board* is the exception, and the instruction is
what makes it one: the model is told to read a board before it changes one, so
the commonest two-tool turn there is `inspect_board` and then an edit of the
same board. First-wins drew the tile from the read — the board as it was
*before* the change the user asked for. So a later view of a board replaces the
earlier one and keeps its place in the strip: the position is where the
conversation first mentioned it, the content is how it now stands.

## VII. Agent 8's dialect

`designer-tools.ts`.

### 1. The gallery, in agent 8's nouns

Agent 8's gallery toolset (compositor-v2.md §IV.3) is the read side of the
project's pictures, in the vocabulary §II.4 hands the designer.

The rows and the arithmetic are agent 6's: a digest here is `referenceDigest`'s,
a shape is `aspectLabel`'s, a region is the same `cropBox` the panel draws its
outline from. What is agent 8's is the *wording* and what an answer is allowed
to cost. Two vocabularies over one set of rows would be two dialects in one
product; two implementations of the digest would be two answers to "what shape
is this", so only the first is taken.

Three renames, and each is a word §II.4 already uses. A *cut* is a
`modification`, because agent 8 places one exactly like an original and the word
is what tells it there is nothing special to do. `favorite` is `starred`, which
is the word on the tile the user clicked. And a reference is an `image`, because
agent 8's other surface is a canvas of objects and "reference" there would name
the thing an object points at rather than the picture in the gallery.

The module is the declarations and the shapes of the answers. What reads the
database, fetches bytes and counts the pictures against §VII's ceiling sits
beside agent 8, on the same split `agent-tools.ts` and `tools.ts` already have:
the part worth a test is the part that has no bucket in it.

`modificationOf` is named that rather than `croppedFrom` because a version's id
is placed like any other and the line is telling the model where it came from,
not that it needs different handling. `starred` is true or absent and never
false, on `ReferenceDigest`'s own terms: the star is the rare line and the
user's own judgement of the set.

The unread reason reaches agent 8 as the word rather than as the enum. Agent 6's
digest carries `unread: "pending"` and leans on `UNREAD_CATALOG_NOTE` to say
what the three values mean. Agent 8 is handed the mark itself — "not read yet" —
because the same three words already stand on a page's blocks (§V.4) and on
`get_image`'s answer, and a value that needs a legend in one of those places and
not the others is the legend being paid for twice.

`GALLERY_OVER_CAP_NOTE` says what to do about a catalog that did not fit. The
two numbers say it already; this says what to do about it, because the
alternative is a model that reads twenty-four lines and tells agent 6 the
project holds twenty-four pictures.

`list_gallery` carries **no pictures**: twenty-four uris on every round is the
whole picture budget (§VII) spent on a list the model reads once, and `get_image`
is the door to looking at one of them. Versions are in unless they are asked
out, on `list_references`' own argument: this is the door to every picture, and
a modification left out of an answer that says it lists the gallery reads as one
that does not exist.

### 2. What a picture's answer carries

A `ModificationLine` is enough to choose which cut is worth a round of
`get_modification`, and no more. A frame with nine cuts under it would otherwise
be nine paragraphs and nine pictures for a question about one photograph, which
is the whole picture budget spent by a tool the model called to look at the
original. The words the cut was asked in are blank on a crop the user drew by
hand, and said as that rather than left empty — an unlabelled line beside three
labelled ones reads as a cut whose reason was lost rather than as one nobody
wrote a reason for.

`ImageAnswer` is `get_image`'s answer for a picture agent 2 has read: every
dimension under its own name, and the two fields no digest anywhere carries.
`digestTags` flattens the five dimensions into one list and drops the palette
and the rationale outright, for a reason that is about a *catalog* — six hex
codes on twenty-four lines is a quarter of it spent on something a model cannot
see. That argument does not hold for the one picture the model has stopped to
look at, and this is the only door to those two fields agent 8 has.

The flattened list comes off the digest rather than being carried beside the
dimensions: it is the same words a second time, and a field called `tags`
meaning one thing on a `list_gallery` line and another here is two dialects in
one prompt. It is also the test for "has this been read" — an `Analysis` row
whose every dimension came back empty is a picture agent 2 found nothing in, and
answering that with five empty arrays is the same blank said five times.

`IMAGE_UNREAD_NOTE` stands in place of six empty dimensions. An empty palette
beside an empty rationale reads as a photograph with no colour in it, which is
the blank the unread marks exist to stop being read as a fact.

A `ModificationAnswer` adds the region, and the region is why the call is worth
its round: it is the difference between "a crop of the stairwell" and "the
top-left third of the stairwell", and the second is what says whether cutting
again would buy anything. Said in the model's own 0-1000 convention rather than
in pixels of the source, which is how the column stores it — a box in pixels
would name the same part of the frame only until somebody re-encoded it. It is
absent on a version whose box was never recorded — a hand-drawn crop from before
the column, or a version that is not a crop at all — and absent rather than
zeroed, because four zeroes is a region and it names the whole frame.

A cut's own pixel size is carried rather than the frame's: a cut small enough to
be soft at the size it would be placed at is the one thing about it that decides
whether it can be used big, and no other field says it. `askedAt` is the shape
it was *asked* at, which is not recoverable from the region — the box is a share
of each edge of a frame that is not square, so a cut that measures 1.78 and one
asked for at 16:9 are indistinguishable in the numbers. It matters when the cut
is moved.

`ModificationReference` carries the two columns only `get_modification` reads.
Agent 6's `ToolReference` stops at `editIntent` because no tool of its own
answers with the reasoning or the box; both are on the row the whole time.

### 3. Why each page tool is re-described

Agent 8's page toolset (compositor-v2.md §IV.2) has one new tool in it. The rest
is agent 6's page tools unchanged, and `add_page` is deliberately not in either:
`put_on_canvas` with `kind: "page"` already makes one and takes a box, and two
doors to one act is two prose descriptions to keep in step.

`get_page` answers with `PageAIRepresentation` (tech-spec §V.4) — the same text
a user-attached page carries, asked for by the model instead of chosen by the
user — plus the picture, drawn on the call at the revision the blocks were read
at (§III.3). The description says so: a model that does not know the picture is
of the page *including its own last two rounds of edits* will call this once and
then reason from memory.

The four inherited page tools are forked one description at a time, and the
reason is the same each time: **agent 6's descriptions name tools agent 8 does
not hold**, and a model told to reach for five tools it was never given spends a
round each time it believes it.

`duplicate_page`: agent 6's is three quarters advice about what to call next,
and every tool it names is one agent 8 does not hold — the copy is changed there
with `swap_on_board`, `reword_on_board` or `compose_moodboard`, and the two calls
it warns against are `duplicate_board` and a `newPage` compose. What agent 8
does with a copy is arrange it by hand, so its version ends at the canvas tools
it actually has.

`move_to_page`: agent 6's ends at `compose_moodboard`, `swap_on_board` and
`inspect_board`, and this agent holds none of the three. The *argument* for the
call is also different. Agent 6 is told to prefer this over a rebuild, because a
rebuild is what it would otherwise reach for. Agent 8 would reach for
`transform_on_canvas`, and there the objection is not price but arithmetic: a
box on a page is in thousandths of *that* page, so carrying a picture to another
page by hand means reading the target page's rectangle in scene pixels, working
the picture's share of the old page into a share of the new one, and writing a
`to` outside 0-1000 that lands where the geometry says. It is the one class of
number this agent gets wrong, and this call does it exactly.

`discard_page` is forked for a reason the others are not: agent 6's says the
user presses a button, and there is no button here. Agent 8 is never shown to a
user (§III), so the offer it makes travels out as the words of its closing line,
which agent 6 says again in fewer (§VI). The description therefore tells it that
the answer *is* the whole offer, the same sentence `discard_image` carries for
the same reason. Agent 6's also sends the model to `discard_board` for a whole
board and to `inspect_board` for the page ids, and agent 8 holds neither: it
reads pages with `read_canvas` and `get_page`, and a board is not something it
can offer to lose at all.

### 4. `resize_page` and the two shapes every page came out at

The last of §IV.2's four inherited page tools to be forked, and it was forked
for two reasons, of which the second is the larger. The first is the one the
other three were: agent 6's names tools this agent does not hold. It sends the
model to `inspect_board` for the page ids, warns it off `compose_moodboard` in a
clause about templates, and closes on offering to lay the page out again — which
is a compose, and agent 8 has no compositor.

The second is `compositor-v2.md` §VIII's taste risk. Every page agent 8 had ever
made came out at one of two shapes, and **iteration 36 found half the reason in
the instruction's own page paragraph**: it printed the presets in pixels two
lines above "the proportion is yours". Taking the numbers out moved the banner
ask onto a 1920x600 page of its own writing. The other half was in this
declaration — it gave the same three sizes in pixels, called them "the shapes
the layout templates are cut for", and was read on every round of every design.
Agent 8 has no templates and `put_on_canvas` takes a box of any proportion, so
both clauses were false for this reader as well as expensive. The names stay,
because naming one is how the call is made and three is a real constraint on it;
the pixels and the templates go, and what replaces them says where a rectangle
that is not one of the three comes from.

Agent 6's declaration is untouched, which is the whole reason this is a fork
rather than an edit: the numbers are true of a page a template composed, and
agent 4 still fills those templates.

### 5. The two tools that make bytes

Agent 8's image toolset (compositor-v2.md §IV.4) — the two tools that make bytes
rather than reading, cutting or arranging what is already there. Both are agent
6's, and both are re-described rather than re-implemented.

`generate_image` keeps its name and its arguments: what changed for agent 8 is
nothing at all in the executor — `makePicture` already ends where §IV.4 asks it
to, with the bytes in the bucket and the row filed before the call answers, so
the id in the answer is one `put_on_canvas` takes on the very next round. It is
ungated, unlike `generateImageFor`: agent 8 is only ever opened on a project
with a board (§VI), so the three counts that decide agent 6's wording are
answered before the door is opened, and a gate here would measure a condition
the call already met. The constant is spelled apart from agent 6's so that a
file importing both does not have to alias one of them.

What both descriptions carry that agent 6's do not is where the id goes next.
Agent 6 hands an id to `compose_moodboard` and a template puts it somewhere;
agent 8 places it itself, in a box it wrote, so both descriptions end at
`put_on_canvas` and neither mentions a slot.

`crop_image` is `crop_reference` in §II.4's nouns, with `toObjectId` in place of
agent 6's `boardId` and `pageId`. The old pair assumed the opening came from a
template: agent 6 names a board and the executor looks up which *slot* the
picture is sitting in. Agent 8 has no templates. Its openings are boxes it wrote
itself with `put_on_canvas`, so the only account of the shape is the object
standing in one, and `objectShape` reads it off the same box `read_canvas`
answered with.

It reads that box and changes nothing on it, which is where this parts company
with agent 6's `boardId`. There the crop cut *and* swapped in one call, because
a swap was a tool agent 6 had; agent 8's canvas set is the five of canvas.md §XI
and none of them exchanges the picture an object points at. A crop that quietly
did would be a sixth canvas write arriving through the image toolset's back
door, which is the wiring Stage 6 says to distrust. So the cut is filed and
placed on the next round like any other picture, and the description says so
rather than leaving the model to report a board change that never came.

## VIII. Skills

`designer-tools.ts` — agent 8's skill door (compositor-v2.md §IV.5).

The one tool that reads nothing belonging to this project. A skill is text — no
model call, no retrieval, no row — so what is left to decide is only how much of
it a round may buy and how the model chooses, and both are settled in the
declaration rather than in the executor.

The catalogue rides in the description and the names ride in the enum, which is
why the declaration is built rather than written out: the registry
(`@/server/skills`) is the authority on both, and it imports forty-seven files
of writing that have no business in a bundle a browser loads. So the shape is in
the module and the list is handed in, and there is exactly one caller passing
it.

### 1. Two numbers, not one

`SKILLS_PER_CALL` and `SKILLS_PER_DESIGN` bound two different things. The
per-call cap is what one *answer* may carry: skills are the one thing the
transcript never windows out (§III.1), so an answer is text that then rides
every subsequent request of the design, and an answer of a dozen pages of
writing is a round the model spends reading rather than working.
`SKILLS_PER_DESIGN` is the total, spent over as many calls as it takes — which
is what makes reading a skill a decision that can be made twice: once in round 1
off the brief, and again in round 4 when the page turns out to be a colour
problem after all.

`SKILL_CHAR_BUDGET` is the third side of this and the one that makes the
arithmetic real: the design's whole allowance is at most `SKILLS_PER_DESIGN *
SKILL_CHAR_BUDGET` characters of writing carried to the end of the work.

### 2. The three things a refusal says

`skillsOverCallSaid` reports the surplus rather than dropping it (§VII) — and,
unlike every other surplus note in the file, it has somewhere to send the model:
the names over the per-call cap can be asked for again while the design has
allowance left.

`SKILLS_ALREADY_READ_NOTE` answers a name asked for a second time with the fact
rather than a second copy. Re-sending a skill would spend the design's allowance
on text that is already in the transcript.

`skillCeilingSaid` names what was read, because the refusal's real content is
that those skills are still there: they are the one thing the transcript never
windows out (§III.1), so a model asking again is a model that has forgotten it
can see them rather than one that needs them re-sent.

### 3. Why `notFound` should never happen

The enum shows the model every name it may ask for, so it cannot write one that
is not on the list. Reported anyway, because a declaration and an executor are
two files and only one of them was built from the registry on the round that
matters.
