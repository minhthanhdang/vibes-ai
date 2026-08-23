# Conversation

The design record for `conversation.ts`, `conversation-list.ts`, `chat-log.ts`
and `chat-history.ts` — the shape a message is stored in, the two projections
taken off it, what of a conversation goes back up to the model, and how a
project's threads are named and chosen between.

Mechanical invariants stay in the code, as `///`: what a reader has to know in
order not to break it. What is written here is the other half — the decisions,
the measurements behind a number, and the arguments about wording. A module
cites its section by name (`Conversation.md §IV`), which is what `npm run cites`
and `citations.test.mts` resolve.

This file is in git. `context/` is not, so where a `context/` doc and this one
disagree about these four modules, this one is what was built.

## I. The message format

`conversation.ts`.

This section took over a delegation. `orchestrator-tool-reference.md` said of
the conversation format that "the `Message` and `Part` schemas, the `PART_RULES`
mapping table and the two projections carry the design's arguments as their own
doc comments", and pointed the reader at the code for them. It now points here
instead, which is the right way round: the git-tracked doc is the record, and
the untracked spec points at it.

One shape for every message in the chat, drawn by the browser and serialized
into the request by the turn, so that what the user is looking at and what the
model was told are the same object rather than two that agree by hand.

The conversation exists three times without this — `ChatLog.messages` for the
column, `ChatTurn[]` posted upward as history, and the `Content[]` the loop
assembles — and the tool calls, the most expensive thing a turn produces, exist
only in the third and die with it. Here there is one `Message` with tagged
parts, and the column and the Vertex request are two projections of it:
`forDisplay` and `forRequest`.

Loaded in the browser and on the server both — the seam `agent-tools.ts` already
occupies — so nothing `server-only` may be imported here. The `Content` import
is type-only and erased, for `tool-window.ts`'s reason.

### 1. The parts

The attachment is written by the turn that built it in memory and drawn verbatim
on read, so the schema checks only the discriminant the column keys tiles by and
trusts the rest: a stored row is never rejected on read, and a tile missing a
field degrades per field rather than taking the row with it.

An `event` is something the user did with their hands that the conversation has
to hear about: a cut taken in the properties panel, a board or page or picture
thrown away from an offer. It stays the user's — the model has to read it as new
information rather than as its own claim. `note` is what rides up as history;
`payload` is the structured half the column needs and the sentence cannot carry.

A `page` is a page the user attached (tech-spec §V.5). A pointer, as it is
today: what the model is shown is rebuilt from the stored scene by
`tools.attachedPages`, never from this part, so a user cannot describe their own
page to it.

A `result`'s `summary` is `toolWindow`'s `idsIn` — the ids this answer filed —
kept when the response itself was too big to store whole.

On the message itself: `seq` is ordering within the project, monotonic and
assigned by the store, because two messages can land in one millisecond and an
event is written by a different door than a reply. `turnId` says which ask a
message belongs to — the user's message, the assistant's answer and every call
between them share one — and the turn's own work is `turnId === current`; this
is the column `firstRoundAt` walks the assembled contents to rediscover. The
role is `assistant`, not `model`: `model` is Gemini's word for it and this
format is not Gemini's. `pending` is a turn on the wire and `failed` a turn that
never arrived, moved onto the message they are about so that two questions in
flight are not one boolean, and only the live turn in the browser ever sets
`pending`. `error` sits on the message rather than on the log for the same
reason.

### 2. A part from a newer build

A part written by a build this one has not met is kept verbatim, drawn as
nothing and left out of the request — the alternative is a schema bump that
makes yesterday's conversation unopenable, and this is a chat log, not a
migration.

Known shapes parse first, so a well-formed part parses as itself; anything else
— a type from a newer build, or a known type missing a field — survives as
unknown rather than taking the row down. A stored row is never rejected on read.

### 3. `PART_RULES`

The whole specification of both projections, as code: a part type added for the
column that the adapter does not map fails to compile instead of vanishing
silently from the model's view of the conversation. A silent drop here is the
failure mode that takes longest to notice — the reply stays plausible, it just
answers less than it was shown.

`call` is stored always and drawn never: the record is the point, the rendering
is a preference, and a per-tool phrasing table is the thing that rots first.

A `result` degraded past `RESULT_STORE_LIMIT` has no response to send — and is
never actually sent, because only its own turn carries results and the live turn
holds them whole in memory. The mapping still has to say something, and what it
says is what the summary is: the ids the answer filed, marked as the remainder
of a bigger thing.

An `attachment` is never sent. The model's own tool calls put the attachment
there, and sending it back would have it reading its own attachments as new
evidence.

`DrawnPart` is a shape rather than a component so the table stays pure and
loadable on both ends; the column decides what a bubble or a tile looks like,
this decides only which one a part is.

## II. The two projections

`conversation.ts` — `forDisplay`, `forRequest`, and the two reductions they
share, `spoken` and `asHistory`.

### 1. What a message said

`spoken` is what a message *said*, as one wire turn carries it: the words and
the notes beside them, nothing else. This is the projection a past turn is
reduced to — the browser windows its history through it and `forRequest`
serializes through it, so what the user can see the model was told matches what
it was told.

`asHistory` is what of a settled conversation goes back up with the next
message. The window is `historyWindow`'s and the projection is `spoken` — the
same pair `forRequest` reduces a past turn to. What is decided there is *what is
eligible*: only a `sent` message is history. A `failed` one never reached the
model, and carrying it would have the assistant answering a question it was
never asked; a `pending` one is the live turn's own ask, which rides separately.

`forDisplay` renders everything — except what the table says is drawn as
nothing, and parts this build does not know.

### 2. The `Content[]` a round is sent

Two rules, and they are today's rules, only now expressed once:

1. **Parts of past turns**: `text` and `event` only. Attachments stay behind
   because the model's own tool calls put them there (`chat-history.ts`); `call`
   and `result` stay behind because a turn that re-sent every previous turn's
   rounds would grow without bound — the twelve-round turn `tool-window.ts` was
   written for would be paid for again on every message after it. Bounded by
   `historyWindow`'s three limits, unchanged.
2. **Parts of this turn**: everything but `attachment`, bounded by `toolWindow`'s
   two, unchanged — same drop order, same said-out-loud mark, and the window
   still begins with something the user said.

A `failed` message is nobody's: it never reached the model, and carrying one
would have the assistant answering a question it was never asked.

One wire turn per past message, as the client posts one today: what was said and
who said it, the notes beside the words, and nothing else.

`SendContext.attached` is the rebuilt scene parts for the pages this turn's
message points at — built by the caller from the stored scene, because a page
part is a pointer and the rebuild is a server read this module must not make.
They ride as one block in pick order, which is the one thing the rebuild does
not say per page, so the first page part spends the whole block and the rest add
nothing.

### 3. The `functionResponse` re-roling

It lives in `forRequest` and nowhere else. Vertex rejects a response with no
call above it, which is the only reason the role flips; the stored message says
what is true — a call and its result are both the assistant's work — and one
assistant message serializes to alternating `model` and `user` contents, one
pair per adjacent `(call…, result…)` group. A round is a group of parts, not a
message.

## III. What a row keeps

`conversation.ts` — `forStorage`, `RESULT_STORE_LIMIT` and the `wire` that never
reaches it.

### 1. The emission that rides beside a part

`Emitted` is a part the live turn made out of the model's own emission, with the
emission riding beside it. Gemini's parts carry fields this format does not
model — the thought signature above all, which the API rejects a later round of
the same turn for omitting — so within its turn the request carries the part
exactly as it arrived, and the typed half is the record of it. In memory only:
the schema does not know the field, so a stored row loads without it — rightly,
because only a part's own live turn ever sends one back.

### 2. Three departures on the way to a row

The live turn's parts as a row keeps them, each departure because the store
outlives the turn: the raw emission stays behind — a `wire` exists to be
returned within its own turn and the schema strips it on load anyway, so storing
it would be paying to keep thought signatures nothing may ever send; a text part
that was only the carrier of one is nothing said, and storing it would draw an
empty bubble; and a response past `RESULT_STORE_LIMIT` degrades to the ids it
filed.

### 3. `RESULT_STORE_LIMIT`

The most a `result` part may store of the response itself, in characters of its
JSON. A stored result is for the record, not for a later request — the live turn
holds its own answers in memory and no later turn is ever shown them — so past
this it degrades to `summary` plus `truncated`, the same degradation `toolWindow`
applies to an old round. Twelve rounds of crops store twelve calls and twelve
summaries, not twelve full answers. The number is a round's share of
`TOOL_CHAR_BUDGET`: what the window thinks a round is worth carrying is what the
record thinks an answer is worth keeping.

## IV. The history window

`chat-history.ts`.

The chat keeps every message it has ever drawn and was sending all of them,
which is wrong twice over. The hard half is that the router bounded the array
and *rejected* anything longer, so the twenty-first message in a project failed
validation and every message after it failed the same way — the conversation was
over, permanently, with a zod error under the composer. A bound the client can
cross is a bound the server has to clamp rather than refuse: an open tab running
yesterday's script is the case that matters, and it cannot be told to send less.

The soft half is what it cost. The whole history rides on *every round of every
turn* — three rounds is three copies — on top of a system instruction that
already carries the project's photographs and boards. Routing was measured at
three quarters of a turn's bill with no history at all; an afternoon's
conversation would have quietly doubled it and gone on doubling.

So: the recent end of the conversation, inside a character budget, beginning
with something the user said.

### 1. What crosses the wire

A message as it crosses the wire — what was said and who said it. The pictures
stay behind: the model's own tool calls put them there, and sending them back as
conversation would have it reading its own attachments as new evidence.

### 2. The three limits

`HISTORY_TURN_LIMIT` = 16, how many messages back the model can see. Eight
exchanges — enough to hold a whole compose → crop → take → put-it-on-the-board
sequence, which is the longest workflow the tools have, and short enough that a
project the user has been talking to all day costs the same as a fresh one.

`HISTORY_CHAR_BUDGET` = 6000, the window's whole size, in characters. Roughly
1,500 tokens against a turn that primes at around 3,000, so the conversation is
a third of the routing at its very widest and usually far less. Characters
rather than tokens because the budget has to be spent in the browser, where
there is no tokenizer, and an approximation that never under-counts is worth
more here than a precise number that costs a call.

`HISTORY_TEXT_LIMIT` = 1000, the most one message may contribute. A reply that
ran long is still worth carrying — it is what the user is answering — but not at
the price of the six messages before it. Cut rather than dropped, because the
top of an answer is the answer and the tail is usually the qualifications.

The mark left where a message was cut is an ellipsis, so the model reads a
truncation as a truncation rather than as a sentence that stopped.

### 3. The three ordered rules

The tail of the conversation that fits, oldest dropped first. Three rules, in
this order, and the order is the point:

1. Empty messages are not messages. A blank turn is a part with no text in it,
   which reads as a speaker who was handed the floor and said nothing.
2. The recent end, by count and then by size. Count first so the size pass never
   has to walk a thousand messages; size second because sixteen short exchanges
   and sixteen long ones are not the same amount of money.
3. It begins with the user. A window whose first line is the assistant is a reply
   to a question that was dropped — the model reads its own answer as something
   it volunteered, and the turn it is actually answering is gone.

## VII. The conversation list

`conversation-list.ts` — the rules for a project's list of conversations, with
no React and no tRPC in them: what a thread is called, what a rename is allowed
to become, which one the column opens, and where the user is left when one goes
away (orchestrator-tool-reference §VII).

Deliberately the same shape as `moodboard-boards.ts` — naming, selection and
removal for a project's list of things — and named `conversation-list` rather
than `conversations` so nobody reads it as a rewrite of `conversation.ts`, which
is the message format.

### 1. The two ceilings

`CONVERSATION_TITLE_LIMIT` = 60 is the cut. A switcher row is one line in a
column that is 280px at its narrowest, so a title past this is a title nobody
reads the end of.

`CONVERSATIONS_PER_PROJECT` = 50: the switcher lists the 50 most recently
updated threads. A ceiling on a *read* and not on the project, exactly as
`CHAT_LIST_LIMIT` is on messages (§VII.7): the fifty-first is still a row, still
readable by id, and simply not in the list the header opens with.

### 2. What a thread is called

`NEW_CHAT_TITLE` is what a thread nobody has spoken in reads as. It is not
stored — an unspoken chat is not a row at all (§VII.3) — and an emptied thread
does not fall back to it either, because `clear` writes the name it had into the
column first.

A thread's name is derived out of its own first user message (§VII.4). The first
line alone: a brief pasted in as six paragraphs is one line in the switcher, and
the line that opens it is the one that says what the thread is about. Cut at a
word boundary with the ellipsis inside the limit, so the row is never longer
than the column and never ends mid-word. Empty in, empty out — the caller
decides what an unnamed thread reads as.

The `parts` → `spoken` parse lives in `conversationLabel` rather than in the
router so the router stays glue, and so a thread whose first message was written
by a build this one has not met is left *named* rather than unnamed — `spoken`
skips a part it does not know, and a row is never rejected on read.

A rename is truncated rather than rejected, and `null` means "nothing to save" —
an empty or whitespace-only edit is a cancelled rename. On this door `null` has
a second meaning `normalizedBoardTitle`'s does not have, and the rename mutation
owns it: clearing the field puts the thread back to deriving its own name.

### 3. Which one is open

`list` is newest-spoken-in first, so its head is the most recently updated.
`session` is the ids this browser minted and may not have spoken in yet
(§VII.3): an unspoken thread is in no list, and without this the column would
jump off it the moment the list landed.

`fresh` is what a project with nothing to open gets — minted by the caller,
because a pure function cannot mint and the id has to be stable across renders.

### 4. Where removal leaves the user

Deleting a thread the user is not looking at must not move them — including when
they are sitting in an unspoken thread that is in no list — and deleting the
open one lands on the most recently updated of the rest, which is the head of
the list because the switcher's order *is* recency. `null` when there is no
rest: the caller opens a fresh chat.

That an id the list has never heard of is *kept* is the one place this differs
from `boardAfterRemoval`, which drops it. It is not an accident: an unspoken
thread is in no list (§VII.3), so a list that does not name the open id is the
ordinary case here and the broken one there.

The optimistic rename mirrors `withBoardTitle`: the row the user just typed into
is the one thing on screen that must not flicker back to the old name for a
round trip.
