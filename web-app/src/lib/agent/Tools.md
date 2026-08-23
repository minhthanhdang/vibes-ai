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
absent on a version whose box was never recorded rather than zeroed, because
four zeroes is a region and it names the whole frame.

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
for two reasons. The first is the one the other three were.

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
