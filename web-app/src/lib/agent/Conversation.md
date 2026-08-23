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
