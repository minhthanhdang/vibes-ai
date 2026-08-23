# Metering

The design record for `model-cost.ts`, `model-finish.ts` and `design-runs.ts` —
what a turn cost, why a turn came back with nothing, and what the designs
already run came to.

Mechanical invariants stay in the code, as `///`: what a reader has to know in
order not to break it. What is written here is the other half — the decisions,
the measurements behind a number, and the arguments about wording. A module
cites its section by name (`Metering.md §V`), which is what `npm run cites` and
`citations.test.mts` resolve.

This file is in git. `context/` is not, so where a `context/` doc and this one
disagree about these three modules, this one is what was built.

## I. Tokens stored, money derived

`model-cost.ts` — what a turn of the pipeline actually cost, in the only units
the API reports exactly: tokens.

Every ceiling in this codebase — `MAX_TOOL_ROUNDS`, `CROP_CALL_LIMIT`,
`CROP_MAX_ATTEMPTS`, `COMPOSE_BLOCK_LIMIT` — bounds the *number* of calls, which
is a guess at the bill rather than a reading of it. A capped catalog still
spends whatever a hundred tags come to. This module is the reading: the counts
Vertex returns on every response, summed the way the agents spend them, and
priced in one place.

Tokens are stored, money is derived. A price table goes stale — the model ids
are preview ids and the rates change — and a cost written into a row goes stale
with it. Counts do not.

### 1. What is counted

`outputTokens` is everything the model wrote, thinking included. Thinking tokens
bill at the output rate and are reported apart from the answer, so a Pro call
that reasoned for a page and replied in a sentence reads as cheap unless the two
are added up here.

`totalTokens` is reported when it is reported — it counts parts the other three
fields do not, so re-deriving it would quietly lose them. Derived only when it
is absent.

A response with no `usageMetadata` reads as zero rather than as unknown: the
alternative is every caller carrying a null through its own sum, to distinguish
a call that cost nothing from one that did not say — a difference no reader of
these rows can act on. Every field of `usageMetadata` is optional for the same
kind of reason: a blocked or truncated response still carries the block and not
the count.

### 2. The cached tokens that are not counted

`cachedContentTokenCount` is reported beside the others and is deliberately not
one of them: it is a *part of* `promptTokenCount`, not a fifth number to add,
and the only thing a reader could do with it is charge those tokens a cheaper
rate — which needs a column on `AgentRun` to survive the write, and there is
none. It is real on `FLASH` (10,919 of 13,234 on a probed orchestrator round,
tech-spec §II), so what these rows say is the ceiling on a turn rather than the
invoice for it.

## II. The rate table

Micro-dollars per million tokens, so the arithmetic is integer and a rate like
$0.30/M does not arrive as a float.

Keyed by the model id rather than by the `MODELS` alias, because that is what a
run row records and what a rename would break: a row written under the old
preview id must still price, and an id nobody has entered a rate for must read
as unpriced rather than as free. `costMicrosOf` answers null for a model with no
rate — the tokens are still real and still worth showing, and a zero there would
read as a call that was free.

**These rates are the one thing on this page that is not measured.** Check them
against cloud.google.com/vertex-ai/generative-ai/pricing before quoting a number
at anyone; the token counts either side of them are exact.

The image model bills its output at two rates — $12/M for the text and the
thinking, $120/M for the picture itself — and a run row keeps one output number,
so the picture rate is the one entered here. A generation is roughly 1,120 image
tokens against 370 thought tokens, so that reads a call about a quarter dearer
than the invoice does. Deliberate: the alternative is a second column recording
modality, and an image tool that reads cheaper than it is invites exactly the
call this table exists to bound.

Micro-dollars are formatted as money with the fraction kept rather than rounded
to "$0.00": small spends are the normal case here — a chat turn is a fraction of
a cent — and "$0.00" is the number that makes a bill look like it isn't there.

## III. Reading a thrown agent

Structurally rather than with `instanceof`. The error crosses a module boundary
— the cropper throws it, the executor and the router record it — and a class
that has been loaded twice makes a nominal check quietly false at exactly the
moment it matters. Two loaders is not hypothetical here: under the test runner
an `.mts` file and a `.ts` file importing the same module by the same specifier
get two copies of it, so a check that passes in the app cannot be asserted from
a test at all.

`spentThrown` answers null when the throw carried no price at all, which is what
reaching the model failed rather than the model refusing looks like. The model
rides out on the error rather than being named again there, because a caller
that names it is a caller that can name a different one than the agent called:
§II moved five agents at once and left three failure branches pricing flash work
at pro rates.

`spentColumns` is written through one function because there are four doors onto
the `AgentRun` table — the analyzer's worker, the panel's crop, the
orchestrator's crop and its own turn — and four hand-written copies of the same
four keys is three chances to record output tokens in the prompt column.

## IV. The spend summary

What the project spent, per agent and in total. Grouped by agent because that is
the question worth asking of these rows: the cropper reads photographs and the
compositor reads a sentence, so one number over both of them hides which one to
go and cap.

Rows that recorded no counts — everything written before this column existed,
and every run that failed before the call — are counted as runs and add nothing,
rather than being dropped. A run that spent nothing still happened. A run with
no tokens on it was never priced, so an unknown model there costs nothing and
unpricing the whole group over it would make every pre-column row poison the
total.

A group's `costMicros` is null when any run in it was on a model with no rate. A
partial total is worse than no total: it is a number the reader will take for
the whole bill.

`SpentRun` is deliberately the columns and nothing else: what a run *is* belongs
to Prisma, and pricing it should not need the client.

## V. Why a turn came back empty

`model-finish.ts`.

Measured (iteration 15): a real turn asking for two things at once came back
with a candidate holding no text, no function call and 851 output tokens of
thinking. The loop's fallback turned that into a chat bubble reading "…" — the
user is told nothing, asked nothing, and billed for it. Vertex does say why on
every one of these; it says it in `finishReason`, which was being dropped one
field away from where the answer was read.

Pure and outside `server/` for the usual reason: the sentences are read by the
chat, and the parsing is the half a test can reach.

### 1. The reply table

What the user is told when a round came back empty, by the reason Vertex gave
for it. Each one says what happened and what to do about it — a sentence with no
next step in it is the "…" bubble with more characters.

`MALFORMED_FUNCTION_CALL` — the one seen live. The model wrote a tool call the
API could not parse, which it does most readily when a message asks for two
different tools at once. It is also the one worth retrying, so this sentence is
what the user gets when the retry failed too.

`NOTHING_CAME_BACK` — the generic one: a candidate with nothing in it and no
reason given. Said rather than swallowed, because the alternative is an
assistant that appears to have ignored the message.

### 2. Why only MALFORMED retries

A malformed function call is the model's own emission failing to parse — it is
not a refusal, a limit or a block, and the same request asked again usually
lands. Everything else in the table above is a decision: asking again unchanged
would buy the same answer, which is a round spent to be told no twice.

## VI. The design census

`design-runs.ts` — what the designs already run came to, read off the
`AgentKind.DESIGNER` rows (compositor-v2.md §VIII).

`design.ts` writes four things onto every run row that nothing has ever read
back: the rounds, the pictures, the draws and what stopped the loop. §VIII names
two of them as the numbers to check before moving a ceiling — "measure the cache
hit rate before the render time", and "watch the `AgentRun` rows before raising
it" of `DESIGNER_PICTURE_LIMIT` — and both of those are a question about the
*set* of runs rather than about one of them. A ceiling read off a single design
is a ceiling set by the last thing somebody tried.

The ceilings themselves are not imported here: they live beside the loop, which
is `server-only`, and this module is arithmetic over rows that a test can hand
it. The caller passes them in, which also means a row written under an older
limit can be read against the limit that was in force for it.

Nothing here prices anything — `model-cost.ts` next door does that off the same
rows, and the two questions are separate: that one asks what a design cost, this
one asks what a design *did*.

**The readings themselves belong to `compositor-v2.md` §VIII and are not
repeated here.** This module's own header carried a census at 32 designs while
the spec had already read again at 47 and at 67, and disagreed with it on the
round ceiling. One record of a measurement, in the file that is maintained.

### 1. Reading a row defensively

Every field of a run's `output` is optional because the shape is JSON on a
column rather than a type: rows predate keys, a `FAILED` row carries the draws
and none of the rest, and a design that never looked has no `renders` at all. A
row this cannot make sense of reads as a design that said nothing rather than
throwing — these rows are a ledger of every design ever run on this database,
including the ones written before the key existed, and a census that dies on the
oldest row is a census nobody can take.

A render tally is all three numbers or none: a partial tally would read as a hit
rate over a denominator that is missing its misses. `failed` is neither a hit
nor a miss — the renderer answering "I could not" says nothing about whether the
bytes were already there.

`stopped` is `"rounds"` when the loop stopped the model mid-work, the only value
that says a §VII ceiling was reached rather than approached. The count of those
is reported rather than a count that merely equals the limit, because a design
that finishes on its last round finished.

`skills` is what the design read, as `skills.ts` counted them — so a name there
is one whose text really went into the transcript, not one the model typed.
Empty for every row written before the key existed, which is why the census
reports the designs that answered rather than all of them.

### 2. What the aggregates mean

A `CeilingRead`'s `runs` is the rows that reported the count at all, so a mean
is over the designs that answered and not over the ledger; `atLimit` is the ones
that reached it, which is the number that decides whether the ceiling is binding
or decorative.

`picturesRefused` and `picturesDropped` are two different things (§III.1). The
first is the model asking to look and being answered in words; the second is the
ordinary case and the whole cost lever.

The render `hitRate` is `cached / (made + cached)`, or null when nothing was ever
drawn. This is the number §VIII says to read before the render time: a design
whose draws are mostly `made` is paying the eight-second budget on every look.
The rows that never drew are filtered out rather than summed in as three zeroes.

`calls` is every tool name these designs called, most-called first — what twelve
rounds are actually spent on.

`skills.read` is which of §V's skills the designs actually read, most-read
first, over the rows that recorded any at all. §VIII leaves the skill as one of
three guards against an ugly page, and a foundation no design ever asks for is a
guard that is not standing — but it is also the whole catalogue in `get_skill`'s
description, paid on every round whether or not anything is read. `runs` is the
denominator for the same reason the render tally filters: a row from before the
key is a design that said nothing about skills, not a design that read none.
