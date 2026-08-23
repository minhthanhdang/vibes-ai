# Windows

The design record for `tool-window.ts` and `picture-window.ts` — what of a
turn's own work, and what of the pictures its tools returned, is still in front
of the model on the next round.

Mechanical invariants stay in the code, as `///`: what a reader has to know in
order not to break it. What is written here is the other half — the decisions,
the measurements behind a number, and the arguments about wording. A module
cites its section by name (`Windows.md §II`), which is what `npm run cites` and
`citations.test.mts` resolve.

This file is in git. `context/` is not, so where a `context/` doc and this one
disagree about these two modules, this one is what was built.

## I. Why there are two

`tool-window.ts` beside `picture-window.ts` drops whole rounds against a
character budget, and for text that is the whole of the cost. Pictures are not text: a `fileData` part is a uri
on the wire — a few dozen characters, invisible to that budget — and hundreds or
thousands of tokens once Google has fetched and tiled it. A window measured in
characters therefore cannot see the one part that dominates agent 8's bill,
which is why there are two windows and not one.

## II. The tool-round window

`tool-window.ts`.

`chat-history.ts`, one level down, and its doc comment already gives the reason:
"The whole history rides on every round of every turn." So does everything the
turn has done to itself. A round is a tool result added to the conversation, and the round after
it re-sends every result before it — a twelve-round turn does not cost twelve
times a one-round turn, it costs closer to seventy-eight.

At three rounds that arithmetic never had to be looked at. At a hundred it does:
"crop everything on this board to fit" is one sentence, twelve crops and
thirteen rounds, and the thirteenth would otherwise carry twelve crop answers in
full.

So: the recent end of the turn's own work, inside a character budget, with a
line saying what is missing.

The type is imported rather than restated: a type import is erased, so naming a
`server-only` module here costs nothing at runtime. `agent-tools.ts` declares
`ToolDeclaration` for the opposite reason — not to dodge that import, but
because the SDK's own `FunctionDeclaration` spells its schema in an enum the
declarations there do not write.

### 1. The two limits

`TOOL_ROUND_LIMIT` = 12, how many rounds of the turn's own work the model can
still see. `CROP_CALL_LIMIT` and `COMPOSE_BLOCK_LIMIT`, deliberately: a turn
asked to crop everything on a board may spend twelve rounds doing it, and a
window that forgot the first crop while the twelfth was being made is a window
that makes the model crop the earrings twice.

`TOOL_CHAR_BUDGET` = 24,000, the window's whole size, in characters. Roughly
6,000 tokens against an instruction that primes at around 3,800, so the turn's
own work is at its widest a little over half the request and usually far less.
Characters rather than tokens for `HISTORY_CHAR_BUDGET`'s reason — an
approximation that never under-counts, bought without a tokenizer call.

`ID_LENGTH_LIMIT` = 64 is the longest a value may be and still be read as an id
in the summary. Several tool answers carry whole sentences at keys like
`nudgeOf`; a summary that quoted one back would be the thing it exists to avoid.

### 2. The four rules

The tail of the turn's own work that fits, oldest rounds dropped first. Four
rules, in this order, and the order is the point:

1. Whole rounds only. `contents` grows in pairs, and a `functionResponse` whose
   `functionCall` was evicted above it is a request Vertex refuses — so anything
   that is not a clean run of pairs is left exactly as it is rather than guessed
   at.
2. Never the conversation the loop was handed. Rule 1 already stops at the user's
   turn, because a turn of theirs carries no call and no response; this is that
   stated as an intention rather than as a coincidence.
3. Count, then characters — `historyWindow`'s ordering and for its reason: count
   first so the size pass never walks a hundred rounds, size second because
   twelve short rounds and twelve rounds carrying a catalog each are not the same
   amount of money.
4. The newest round always survives. It is the answer to the call the model made
   a moment ago, and a request that dropped it asks the model to reason about a
   tool it can no longer see the result of — which is the one shape that reliably
   produces the same call again.

Where the turn's own work begins — everything before it is the conversation as
the loop was handed it, the history and the user's own message, and none of that
is this window's to drop. Found by walking back rather than by counting forward,
because the history's length is not something this module is told. The user's turn is the one that matters. What they attached lives in it,
so a window that could reach it would make round 40 blind to the picture the
whole turn is about.

### 3. What stands where the dropped rounds were

Without it round 40 cannot see that round 5 already cropped the earrings, and
crops them again — and a crop is a real row in the user's project, a thumbnail
they have to look at and a reference they have to discard. The calls and the ids
they filed are the whole of it: enough to know the work is done and where it
went, and nothing like enough to be a second copy of the answer this window is
dropping.

Named responses only. The executor writes every one of these and names all of
them, but the SDK's type allows a nameless response — and a line reading
"undefined → ref-3" tells the model less than no line at all.

### 4. The ids one answer filed

Top level only and id-shaped keys only: this is a reminder that a row exists,
not a second copy of the answer. `idsIn` is exported because it is also what a
stored `result` degrades to past `RESULT_STORE_LIMIT` (`conversation.ts`) — one
rule for what survives of an answer too big to carry, wherever it is carried.

## III. The picture window

`picture-window.ts`.

The loop this exists for is the reason (compositor-v2.md §III.1): look, make,
look again. Three pictures at the least, taken early, and every one of them
re-sent on every round after it because the transcript *is* the context. A
twelve-round turn that looked four times pays for those four pictures around
forty times between them.

So a picture does not stay. It rides on the round its tool returned it and on
the next one, then the part is dropped and a line stands where it stood.

### 1. Two rounds, then five

`PICTURE_WINDOW` is how many rounds an image part survives (§III.1 and §VII's
table).

Two was the first answer, and its argument was the shortest honest use of a
picture: look, place what was seen, reason about what was placed. Five is the
second, and its argument is the longest one — a design that reads a page, cuts a
picture, puts it down, looks again and then compares the two looks is holding
the first picture across four rounds of its own work, and at two it was doing
the comparison blind.

What made five affordable is the dedupe pass below rather than a change of mind
about the cost. Most of what the old window was paying for was the same picture
arriving twice — a page read, worked on, then read again returns one uri both
times — and a window that counts rounds cannot see that, while a window that
counts *pictures* pays for each one once however many rounds it spans.

### 2. What counts as a picture, and as the same picture

`fileData` is how every picture in this system reaches a model (§III) — a uri,
never bytes. `inlineData` is here anyway: it is the shape that would cost the
most to leave in a transcript, and a window that only knew about the cheap
spelling of a picture would be silently wrong about the expensive one.

What makes two picture parts the same picture is the uri, which in this system
is an object name in the bucket and therefore identity: the same page at the
same revision is the same object, and a page that changed is a different one —
which is exactly the distinction dedupe has to make, since re-sending a stale
render would be worse than re-sending a picture. `inlineData` is keyed by its
own bytes for the same reason it is in `isPicture` at all: it is the spelling
that costs the most to duplicate.

`ARGS_LENGTH_LIMIT` = 200 is the longest an argument object may be and still be
quoted back in a note. `tool-window.ts`'s `ID_LENGTH_LIMIT` for the same reason:
the note is a pointer to a call the model can make again, and a note that
carried a whole answer's worth of arguments would be the cost it exists to
avoid.

### 3. The two notes

`pictureDroppedSaid` stands where the picture was, and this line matters as much
as the drop. A picture that silently stops being there is a model still
answering about it — describing a page it can no longer see, from memory of a
description it never wrote down — and from the outside that reads as ordinary
bad taste rather than as a part this code removed. So the note says three
things: that there was a picture, which call returned it, and that the same call
brings it back.

`pictureRepeatedSaid` stands where a second copy was. A different sentence from
`pictureDroppedSaid` and deliberately so: nothing has been aged out here and
calling the tool again would return the same bytes it is already looking at, so
a note telling it to call again would buy a round and change nothing. What it
needs told is that the picture is in the request, once, somewhere else.

The arguments are named so the line names a call the model can repeat rather
than a tool it has to guess the arguments of again — and `get_page` on the wrong
page is a whole round and a whole picture spent finding that out.

### 4. The three rules, and the two passes

The transcript with every picture older than the window replaced by the line
that says so. Three rules:

1. The note stands exactly where the picture stood — same content, same position,
   one part swapped for another. Nothing is re-roled and no turn is added, so a
   request this has been through has the same shape as one it has not.
2. Rounds are read as pairs, and anything that is not a clean run of pairs is
   returned untouched. `toolWindow`'s rule 1, for a weaker reason — this window
   cannot break a request the way an orphaned `functionResponse` does — but a
   transcript this module cannot read is one whose picture ages it also cannot
   know.
3. The last `PICTURE_WINDOW` rounds keep their pictures. Everything before them
   loses them, including the round the model is answering about right now if it
   looked three rounds ago.

The dedupe pass runs newest first, so the copy that survives is the one nearest
the answer the model is about to give — a picture is read where it is, and the
further up the transcript the kept copy sits, the more of the model's attention
the note has to buy back.

It is seeded with whatever stands above the first round, which is priming and
not this window's to touch. That copy is re-sent on every round whatever happens
here, so when a tool returns the same uri the cheapest request keeps the
untouchable one and notes the other — the one case where the copy that survives
is not the newest.

## IV. Order of application

`pictureWindow` is applied after `toolWindow` rather than before: a round
dropped whole is already accounted for by `roundsDroppedSaid`, and a picture
note left behind for a round that is no longer in the request would name a call
the model cannot see the answer to.
