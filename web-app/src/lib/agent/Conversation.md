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
