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
