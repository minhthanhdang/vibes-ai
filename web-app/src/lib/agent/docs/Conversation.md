# Conversation

The design record for `shared/conversation.ts`, `shared/conversation-list.ts`,
`shared/chat-log.ts` and `orchestrator/history.ts` — the shape a message is
stored in, the two projections taken off it, what of a conversation goes back up
to the model, and how a project's threads are named and chosen between.

Mechanical invariants stay in the code, as `///`: what a reader has to know in
order not to break it. What is written here is the other half — the decisions,
the measurements behind a number, and the arguments about wording.

This file is in git. `context/` is not, so where a `context/` doc and this one
disagree about these four modules, this one is what was built.

## I. The message format

`shared/conversation.ts`.

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

Loaded in the browser and on the server both — the seam `shared/` already
occupies — so nothing `server-only` may be imported here. The `Content` import
is type-only and erased, for `shared/tool-window.ts`'s reason.

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

`isKnownPart` is the door, and it is exported because it is the rule rather than
a detail of the projections. `shared/chat-log.ts` hand-rolled the same `safeParse` five
times, which is the rule restated in five places rather than enforced in one;
they read through `partsOfType` now. It takes `unknown` because `subjectsIn`
holds rows on their way to the wire and has not parsed them at all.

### 3. `PART_RULES`

The whole specification of both projections, as code: a part type added for the
column that the adapter does not map fails to compile instead of vanishing
silently from the model's view of the conversation. A silent drop here is the
failure mode that takes longest to notice — the reply stays plausible, it just
answers less than it was shown.

`call` is stored always and, for a long time, drawn never: the record was the
point, the rendering a preference, and a per-tool phrasing table the thing that
rots first.

The drawing half of that is now reversed, and the reason is the clock. A turn
takes two and three minutes, and for all of it the column said `Thinking…` — one
static line over the most expensive thing the product does. The parts to say more
with were already in every row; only the projection was missing. So there is a
second read of them, `stepsOf` (§II.4), and one line under the reply that
survives the reload because it is a read of the record and not a new thing stored
beside it.

What has *not* been reversed is the half that was load-bearing. There is still no
per-tool phrasing table. A step is drawn under the tool's own name with its
underscores opened out, so a tool added tomorrow draws itself and nothing here
has to be told about it; what rots is a table of sentences, not a list of names.

And the drawing still does not happen *here*. `call.draw` and `result.draw`
return null exactly as before, because the summary is one row per *message* and
this table maps one part at a time — see §II.4 for why that is a fold beside
`forDisplay` rather than a kind inside it.

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

`shared/conversation.ts` — `forDisplay`, `forRequest`, and the two reductions they
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
   because the model's own tool calls put them there (`orchestrator/history.ts`); `call`
   and `result` stay behind because a turn that re-sent every previous turn's
   rounds would grow without bound — the twelve-round turn `shared/tool-window.ts` was
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

### 4. The tool work of a settled turn

`stepsOf` is the one projection `PART_RULES` cannot express. A rule maps one part
to what it draws, with no memory of the part before it; a step is a `call` and
the `result` that shares its `callId`, which is a message's parts read against
each other. Making the table do it means giving `draw` an accumulator, and a rule
table with shared state is no longer the complete, `satisfies`-checked
specification that is the whole reason it exists.

That is also the argument against folding the rows inside `forDisplay` after the
fact: the output order becomes ambiguous — does the summary go where the first
call was, or at the end? — and every consumer's `part.kind` filter grows a case
for a row it never asked for.

So it is a fold beside the two projections, which is what this module already
does four times over (`spoken`, `asHistory`, `subjectsIn`, `pagesOf`). The price,
stated plainly: a part type added later that ought to count as a step will not
fail to compile — it will quietly not be counted. That is a smaller loss than a
rule table that is no longer a specification.

Results are matched by `callId` and never by `name`: a round that crops two
references in parallel has two calls with one name in it. A call whose result
never landed is a step that never settled, drawn as such — a turn that broke
mid-round still stored what it had reached. A call announced twice is one step,
because the live stream and the stored row can both name it and the column draws
one chip either way.

What the record cannot say, and the line does not claim: a nested agent's rounds
are not in it. The designer's nine calls live inside the orchestrator's one
`design_page` call, so a settled turn counts four steps where the live block
showed thirteen. The live block counts top-level steps for exactly this reason —
a number that halves when the answer lands reads as the column losing something.

And no duration. `orchestrator.send` writes both rows in one `createMany` after
the turn, so a stored user row and its assistant row share a `createdAt` to the
millisecond: `assistant.at − user.at` is ≈ 0 on every reloaded turn and non-zero
only in the session that ran it. A summary that said "12s" before reload and "0s"
after would be worse than one that says neither. The *live* block keeps its
ticking seconds, which is where a duration is actually useful — during the wait,
as evidence the thing is alive.

## III. What a row keeps

`shared/conversation.ts` — `forStorage`, `RESULT_STORE_LIMIT` and the `wire` that never
reaches it.

### 1. The emission that rides beside a part

`Emitted` is a part the live turn made out of the model's own emission, with the
emission riding beside it. Gemini's parts carry fields this format does not
model — the thought signature above all, which the API rejects a later round of
the same turn for omitting — so within its turn the request carries the part
exactly as it arrived, and the typed half is the record of it. In memory only:
the schema does not know the field, so a stored row loads without it — rightly,
because only a part's own live turn ever sends one back.

`thought` rides beside it with the same life and for the same reason. A thought
summary arrives as a text part with the flag on it, so nothing about its typed
half says what it is; the flag is what the two projections below read.

### 2. Four departures on the way to a row, and one joining

The live turn's parts as a row keeps them, each departure because the store
outlives the turn: a thought summary stays behind, because the model's private
reasoning is not something the user is shown and a stored `text` part is a
bubble in their chat column; the raw emission stays behind — a `wire` exists to
be returned within its own turn and the schema strips it on load anyway, so
storing it would be paying to keep thought signatures nothing may ever send; a
text part that was only the carrier of one is nothing said, and storing it would
draw an empty bubble; and a response past `RESULT_STORE_LIMIT` degrades to the
ids it filed.

The summary still goes back out: `forRequest` sends `wire` verbatim, which is
what keeps the signature the API requires echoed on the next round of the same
turn. Sent and never stored is the whole of the rule.

The joining is streaming's. The two round loops call Vertex through
`generateContentStream`, whose chunks are concatenated **verbatim and merged
never** — a merge would have to decide which of two fragments keeps a
`thoughtSignature`, and the API's own rule is to return the parts as they
arrived, so the safe assembly is the one that does nothing. That is safer than a
merge rather than riskier, and it leaves one problem exactly one layer down: a
round's sentence now arrives as several text parts, and a row that kept them as
several would draw one bubble per chunk. So `forStorage` merges a *run* of
adjacent text parts into one — on the stored side alone, where no signature has
to survive.

It is a no-op on a whole emission, which never produces two adjacent text parts.
A `call` between two runs keeps them apart; a dropped thought between two
fragments does not, which is right — `textOf` would have joined those too.

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

`orchestrator/history.ts`.

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

## V. The log as a value

`shared/chat-log.ts` — the conversation, as a value, and, since it is stored, as a
cache.

It used to be `useState` inside the sidebar, which meant the assistant's column
*was* the conversation: collapsing it — one button, right above the messages —
unmounted the component and destroyed every word of it, along with the board
tiles and cuts the turns had produced. The results this pipeline spends real
money to put in the chat lasted exactly as long as nobody touched the arrow.

So the conversation is a value the column renders rather than state the column
owns. That also moves the turn itself off the component: a reply that lands
while the sidebar is shut is still the answer to a question that was asked, and
a cut taken in the properties panel is still news whether or not the chat is the
thing on screen.

The messages themselves are the format's `Message` rows (`shared/conversation.ts`),
because they are the same messages the store holds: `chatHydrated` loads the
stored conversation underneath whatever this session has said, and every
transition appends the shape a row has, so a reload draws the same column the
session built. What is *not* a row stays a value on the log — the draft, the
picked pages, the in-flight flag — because a half-written message is work and
not yet a message.

### 1. What the log carries that a row does not

`asking` is a turn on the wire, here rather than on the mutation that carries
it, because the mutation dies with the component and the turn does not. `error`
is why the last turn did not arrive, cleared by the next ask rather than left
standing under an answered question. `draft` is what the user has typed and not
yet sent — here for the same reason as everything else: a half-written message
is work, and the collapse arrow is two inches above the box it is written in.
`attached` is the pages picked for the message being written, in the order they
were picked; beside the draft because it is the same half-written message, and
per-message rather than sticky (tech-spec §V.5), so the next question is about a
page only if the user says so again.

`progress` is the turn on the wire as it is going: the steps it has started,
whether each has come back, the model's last thought summary, the sentence it is
writing now, and when the question went out. Null between turns, so `asking` and it are never asked to
disagree. Every field it holds is either recoverable from the stored parts
afterwards (the steps, through `stepsOf`) or deliberately never kept at all (the
thought, the agent labels, the clock) — which is why this is a value on the log
and not a column in the row. Its `startedAt` is the pending message's own `at`
rather than a second clock reading, which keeps `chatAsked` at exactly one.

The ids `penned` mints are the browser's — the store assigns its own when the
message is written, and the next load replaces these wholesale — so all they
have to be is unique in this column: a retry targets one, and a React key is
one.

### 2. The transitions

A page clicked in the picker is `pagesAfterPick`'s rule; what `chatPagePicked`
adds is that it is the *draft's* selection, so it lives and dies with the
message being written. `chatPagesListed` holds that selection against the
board's pages as they now stand — called when the picker's list lands, because a
page deleted while the message was being written would otherwise sit under the
composer as a chip for something that is not going up.

`chatAsked` trims the text here rather than at the composer, so what is drawn is
what was sent, and the draft is emptied in the same transition — the box is
cleared because the message left, so the two are one change rather than two. The
attached pages become `page` parts ahead of the words, the order the store
writes them in, and come off the draft in the same change — an attachment is
per-message (tech-spec §V.5) and a page that stayed picked would ride up on the
next question as well. `pending` until the turn settles it: it is the mark the
failure path finds the question by, and the one status only the live turn in the
browser ever sets.

The answer shares the question's `turnId`: the two are one exchange, and the
store keeps them under one id the same way. `chatAnswered` takes the turn's own
stored parts when the answer carried them, and falls back to the reply and its
tiles when it did not — the parts are the assistant row exactly as it was
written, so the session that ran the turn holds the same message a reload would
fetch. Without them the collapsed summary would be empty until the page reloaded,
which is the wrong way round; with the fallback, an older server or a stream that
ended early leaves a message that says what was said and nothing about how, which
is the column exactly as it was.

`chatProgressed` is the only writer of `progress` and is total: an event that
arrives with no turn in flight, an event for a call already known, a thought that
repeats itself, and an event of a kind this build has not met all return the
*same log object*. The same-object rule is `chatPagesListed`'s and for the same
reason — this one runs tens of times per turn, and a new object each time is a
re-render of the column per round. The read-never-rejects rule of §I.2 applies
one level up here: a wire between two halves that deploy separately gets the same
treatment a stored row gets.

`said` is emptied by the next round's `calling` and never otherwise: text on a
round that turns out to call tools was narration about work that is now
happening, it stays in the row as a bubble, and repeating it above the step it
introduced would be the column saying it twice. Text on the round that ends the
loop is the reply, and `chatAnswered` replaces the whole block with it. So
nothing shown there is ever retracted — it is either superseded by the step it
was introducing, or by the answer it was.

Steps are keyed by `callId`, appended, never re-ordered, and a `called` for a
`callId` nobody announced is dropped rather than turned into a step — a step with
a result and no call is a row the column cannot label. The key carries the agent
in front of the id for a nested agent, because agent 6 and agent 8 number their
calls independently and both start at `1.1`; the orchestrator's own steps keep
their bare id, so a step drawn live and the same step read back through `stepsOf`
are one chip.

Both `chatAnswered` and `chatFailed` clear `progress` beside `asking`. A step
list under an answered question is the progress of a turn that is over, and a
turn that broke has its steps in no row — so there is nothing to expand to, and
leaving the block up would offer a record that will not survive the reload.

`chatFailed` leaves the question in the column: it is what the user asked, and
dropping it would leave an error under somebody else's message. It is marked as
never having been sent, which is two things at once — the tile the user can send
again, and a message the next turn must not carry up as history, since the model
was never told it.

`chatRetried` drops the failed message rather than leaving it in place and
re-marking it: what goes up next is a new turn, and two copies of one question
in the column is the conversation claiming they asked twice. By id rather than
by index, because an event landing while a turn is in flight already moves
everything under it.

`chatHydrated` puts the stored rows in front: they come oldest-first from
`chat.list` and are older than anything penned here, because the fetch went out
when the column mounted. Parsed by `messageSchema`, whose rule is that a stored
row is never rejected on read.

### 3. Why the pending message is found by its mark

Only `sendTurn` ever marks a message `pending`, and it refuses a second send
while one is in flight, so there is at most one — but an event landing meanwhile
means it is not reliably the bottom of the column. A cut taken in the properties
panel lands as an event while a turn is in flight, so the question that failed is
not reliably the bottom of the column, and `chatFailed` and `chatAnswered` find
it by its `pending` mark rather than by position.

## VI. Events and gone-ness

`shared/chat-log.ts` — what the user did with their hands, and what has stopped
existing since.

### 1. An event as one message carries it

The note the model reads, the structured half the column needs, and — for a cut
— the tile under the note. One shape for the transitions and for `chat.record`,
so what this session drew is what the store is told. `recordedEvent` reads it
back off a message, so the note and payload are derived once and stored as
drawn; by schema rather than by tag, because `Message["parts"]` admits parts
this build does not know.

`chatCutTaken` is the other end of the properties panel's crop. `crop_reference`
files its own cuts now, but a user framing one by hand does it in another column
entirely — so the cut appears in the project without the conversation ever
hearing of it. This is where it comes back: the note rides up as history on the
next message, which is what lets the assistant put the cut on a board without
buying a round to find its id. No payload — the cut is a row the project holds,
and the tile under the note is the whole of what the column needs.

`chatBoardDiscarded` is the other end of `discard_board`: the tool offers, the
user acts, and the conversation is told what they did rather than being left to
infer it from a board that has quietly stopped existing. It rides up as their
turn for the reason a taken cut does — they did it with their hands, and the
model has to read it as new information rather than as its own claim. No
attachment: the thing this message is about is the one thing in the project that
is not there any more. The record itself is the payload, which is what lets
`discardedIn` rebuild the settled tiles from the stored conversation instead of
from a map only this session held.

`chatPageDiscarded` is the other end of `discard_page`, on the same terms as a
board's: the tool offers, the user presses the button, and the conversation is
told rather than left to work out from a board that has quietly lost a
rectangle. The note has one thing a board's does not have to say — that the *board* id is still good while the page
id is dead — because the model is about to be handed a boards brief that still
lists the board, with one fewer page on it.

`chatReferenceDiscarded` is the other end of `discard_reference`, on the same
terms: the tool offers, the user presses Remove, and the conversation is told
rather than left to infer it from a picture that has quietly stopped existing.
The note carries more than a board's because the loss does: the cuts made of it
went with it, and the boards it was holding up now have a gap.

### 2. The tiles a discard settles

`discardedIn` answers with the subjects the user has thrown away, by the key
their tile is drawn under. A discard offer is the one tile whose subject can
stop existing while the reply that made it is still on screen — so the tile has
to stop offering (the board cannot be discarded twice) *and* stop being a click,
since the tab row falls back to the first board for an id it does not hold and
would open the wrong one. A removed picture and a discarded page are the same
story under keys that cannot collide.

A fold over the event parts rather than a map the log carries: the events *are*
the record, stored with the conversation, so a reload settles the same tiles the
session settled by hand. A payload a newer build shaped differently folds to
nothing, on the same terms as an unknown part — kept, and no tile settled by it.

`shownAs` reads a board's own key first: a board thrown away takes its pages
with it, and a tile of one of those pages is as dead as a tile of the board. The
tile stays — it is under a reply that was about it, and a decision the user took
is part of the conversation — but it is no longer a way in, because there is
nothing to go to. A photograph needs this as badly as a board does:
`inspectReference` on an id the gallery no longer lists resolves to nothing at
all, so the tile is drawn, clicked, and the panel does not move.

### 3. The gone-ness the fold cannot see

`discardedIn` replays events, and an event exists only for something done
through the conversation's own offers — a picture or board deleted by another
door put nothing in the log, so it is discovered by existence instead:
`chat.list` checks the ids the stored attachments name and answers with the dead
ones, and `goneAtLoad` settles their tiles. The records are synthesized off the
attachments, because after the delete the snapshot in the chat is the only place
the title survives.

`subjectsIn` is what that load-time existence read checks — the subjects a
conversation's tiles name. Over rows rather than parsed messages, because the
caller holding them (`chat.list`) has rows on their way to the wire; a part this
build does not know names nothing.

`pagesOf` is what a retry sends, because the question going again is the
question that was asked, pages and all.

## VII. The conversation list

`shared/conversation-list.ts` — the rules for a project's list of conversations, with
no React and no tRPC in them: what a thread is called, what a rename is allowed
to become, which one the column opens, and where the user is left when one goes
away (orchestrator-tool-reference §VII).

Deliberately the same shape as `moodboard-boards.ts` — naming, selection and
removal for a project's list of things — and named `conversation-list` rather
than `conversations` so nobody reads it as a rewrite of `shared/conversation.ts`, which
is the message format.

### 1. The two ceilings

`CONVERSATION_TITLE_LIMIT` = 60 is the cut. A switcher row is one line in a
column that is 280px at its narrowest, so a title past this is a title nobody
reads the end of.

`CONVERSATIONS_PER_PROJECT` = 50: the switcher lists the 50 most recently
updated threads. A ceiling on a *read* and not on the project, exactly as
`CHAT_LIST_LIMIT` is on messages (§VII.7): the fifty-first is still a row, still
readable by id, and simply not in the list the header opens with.

What actually binds is the account tier: `conversationsPerProject` in
`src/lib/limits/account-tier.ts` is 8, 2 or 1, so this `take` is permanently
non-binding and stays only to keep the list query bounded.

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

`normalizedConversationTitle` and `withConversationTitle` are one line each over
`@/lib/util/named-list`: the board's versions were byte-identical, or identical
but for the limit. The wrappers stay because the prose about what `null` means
here is not the prose about what it means there, and because the rest of the
pair — which row is open, and where a removal leaves the user — is genuinely
different and must not be merged.

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
