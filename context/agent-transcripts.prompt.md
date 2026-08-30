# Task: agent transcripts — every model call, per turn, to a local file

Nine agents talk to Vertex and not one of them leaves a record of what it
actually sent. `AgentRun` keeps the arithmetic — tokens, rounds, which tools were
called — and that is the bill, not the conversation. When a turn goes wrong the
question is never "how many rounds", it is *which sections were in the
instruction on the round it went wrong, what had already fallen out of the
window, and what was the model thinking when it chose that tool*. Nothing in the
app can answer any of those today.

`scripts/design-check.mts` answers them for agent 8 alone, to stdout, only when
run from the command line. Its own comment says what the mechanism is: "the two
injected seams, wrapped rather than replaced — everything below runs for real and
the wrapper only watches." This task generalises that wrapper: one tap, every
agent, written to a file, working while the user chats in the browser.

**This is a development instrument.** It is off unless an environment variable
says where to write, it never runs on Vercel, and a turn must behave identically
whether it is on or off.

Read first — they are the contract:

- `scripts/design-check.mts` §`watchedGenerate` (~line 189) — the pattern being
  generalised, and the reference for what is worth printing about a round.
- `src/server/google/vertex.ts` — `generateContent`, `textOf`, `GenerateConfig`,
  `GeneratePart`. The tap goes here; three of the edits in stage 5 are here.
- `src/server/agents/orchestrator/orchestrator.ts` §`orchestrate` (the `for(;;)` at 467) —
  the loop being recorded, and the `answering.push(...parts.map(...))` at 572
  that stage 5 has to fix.
- `src/lib/agent/shared/conversation.ts` — `Emitted`, `forStorage`, `PART_RULES`.
  Stage 5 adds a second in-memory-only field beside `wire`; do it the way `wire`
  is done.
- `src/env.ts` — `ANALYZER_WORKER_SECRET` is the shape this feature's variable
  copies: unset disables, and the reason is written down.
- `src/server/agents/analyzer/analysis-queue.ts` — `kickAnalyzerWorker`, for how this
  codebase handles a side effect that must never take the request down with it.
- `src/lib/agent/docs/Conversation.md` §I.3 — why `call` parts are stored and
  never drawn. Nothing here changes that.

Work in `web-app/`. Every path below is `web-app/`-relative.

Six stages, ordered, each green before the next. Stages 1–4 are the instrument.
Stage 5 is what puts the *thinking* in it and is the only stage that can break
the running app — it ships last and alone.

## What must be true when you are done

1. `AGENT_TRANSCRIPT_DIR` unset — the default everywhere, and the only state
   Vercel ever sees — means **not one byte written and not one line of behaviour
   changed**. There is a test that asserts this.
2. Set to a directory, chatting in the browser writes one pair of files per turn:
   `<stem>.jsonl` (the record) and `<stem>.md` (the same thing, readable).
3. Every model call in the app lands in one of those files: orchestrator,
   designer, analyzer, cropper, image generator, layout reader, compositor. A
   new agent added later is recorded without touching it.
4. Nested agents write into their **parent turn's** file, labelled and in the
   order they happened. One chat message that designs a page is one file
   containing agent 6's rounds and agent 8's rounds interleaved as they ran.
5. Each record carries: the system instruction as assembled *for that round*, the
   contents as sent, the declaration names offered, the model's thought summary,
   its text, its tool calls, the finish reason, the usage and the wall-clock ms.
6. **No base64 in any file.** An image part is recorded as its media type and a
   byte count.
7. The instrument never throws into a turn. A full disk, a bad path, a
   permission error — the turn completes and the failure is one `console.error`.
8. Thought summaries never reach the user: not in a reply, not as a chat bubble,
   not in a stored `ChatMessage` row.

---

## Stage 1 — the pure half

`src/lib/agent/shared/transcript.ts`, plus `transcript.test.mts` beside it.

In `shared/` and not in `server/` for the reason the rest of that directory is:
the logic is what a test can reach, and nothing here may import `server-only`.
The `GeneratePart`/`Content` imports are type-only and erased, exactly as
`tool-window.ts` and `conversation.ts` already do it.

Four pure functions and the types they carry.

**`TranscriptRecord`** — one model call:

```ts
type TranscriptRecord = {
  seq: number;              // within the turn, from 1
  at: string;               // ISO
  agent: string;            // innermost scope: "designer"
  under: string[];          // enclosing scopes, outermost first: ["orchestrator"]
  model: string;
  ms: number;
  systemInstruction?: string;
  declarations: string[];   // names only — the schemas are in the source
  contents: unknown[];      // redacted, see below
  thinking: string[];       // thought summaries, in order
  text: string;
  calls: { name: string; args: Record<string, unknown> }[];
  finishReason?: string;
  usage?: TokenUsage;
  error?: string;           // set instead of the answer fields when the call threw
};
```

**`redactedContents(contents)`** — the rule that keeps requirement 6:

- `inlineData` → `{ mimeType, bytes: <decoded length>, elided: true }`. Never
  the data.
- `fileData` → kept whole; a `gs://` uri is a pointer, not payload.
- `thoughtSignature` → `"<signature, N chars>"`. It is opaque and long and says
  nothing to a reader.
- `functionResponse.response` → kept, JSON-stringified, truncated past
  `TRANSCRIPT_RESPONSE_LIMIT` (10,000 chars) with a `truncated: true` beside it.
  Deliberately far larger than `RESULT_STORE_LIMIT`: that constant bounds a row
  in a database this instrument is not writing to, and the tool answers are
  half of what makes a transcript worth reading.
- Everything else verbatim.

**`transcriptStem({ at, agent, turnId })`** → `2026-08-24T10-22-31_orchestrator_a1b2c3d4`.
Colons are not legal in a filename on every platform, so the ISO time has them
replaced. The stem is the base for both files.

**`renderRecord(record)`** → the markdown for one record, appended to `<stem>.md`
as it happens. Aim at `design-check`'s stdout, which is the format that has
already proved readable:

```md
## round 3 · designer (under orchestrator) · gemini-3.7-flash · 4.2s

**thinking** — The page has a headline but nothing anchoring the lower third…

**asked** — `put_on_canvas(referenceId=abc123, box=[120,600,880,940])`

**said** — I've placed the wide shot along the bottom edge…

<details><summary>sent — 7 contents, 2 pictures · 11 tools offered</summary>

  … instruction, then each content …

</details>
```

The instruction and the contents go inside `<details>` because they are enormous
and identical on most rounds; the thinking, the calls and the reply are what a
reader is scanning for. A record with `error` renders the error in their place.

Tests: redaction drops base64 and keeps the byte count; a `fileData` uri
survives; a response past the limit is marked truncated; a stem is filename-safe;
`renderRecord` puts a thought summary in the output and never a `data:` blob.

## Stage 2 — the writer and the turn scope

`src/server/agents/shared/transcript.ts` (`server-only`), plus its test.

**The gate.** Add to the schema in `src/env.ts`:

```ts
// Where per-turn agent transcripts are written. Unset disables them entirely,
// which is the state every deployment is in: Vercel's filesystem is read-only
// outside /tmp, so this is a local instrument by construction. Blank counts as
// unset, for ANALYZER_WORKER_SECRET's reason — a copied-but-unfilled line in
// .env.example must disable the feature, not fail the app at boot.
AGENT_TRANSCRIPT_DIR: z.preprocess(
  (raw) => (typeof raw === "string" && raw.trim() === "" ? undefined : raw),
  z.string().optional(),
),
```

Add the key, commented, to `.env.example`. Add the directory to `.gitignore` —
transcripts contain the user's own board content and every word of their brief.
Suggested default in the example: `.transcripts`.

**The scope.** `AsyncLocalStorage` from `node:async_hooks`, holding:

```ts
type TurnScope = {
  turnId: string;      // randomUUID().slice(0, 8)
  stem: string;
  agents: string[];    // the stack; last is innermost
  next: () => number;  // seq counter, shared by the whole turn
  writes: Promise<unknown>;  // the append chain
};
```

```ts
export function withTranscript<T>(agent: string, run: () => Promise<T>): Promise<T>
```

- Var unset → calls `run()` and nothing else. **No context, no allocation, no
  branch anywhere else in the app.**
- No scope open → mints one, and the file is not created until the first record
  lands (an agent that refuses before its first model call should not leave an
  empty pair of files).
- A scope already open → pushes `agent` onto the stack and reuses the file. This
  is requirement 4, and it is the whole reason the API is a wrapper rather than a
  `startTranscript()`.

```ts
export function recordModelCall(record: Omit<TranscriptRecord, "seq" | "at" | "agent" | "under">): void
```

Synchronous, returns nothing, called by the tap in stage 3. Reads the scope,
fills in `seq`/`at`/`agent`/`under`, and appends the JSONL line and the rendered
markdown.

**Never throwing** is not a nice-to-have here, it is requirement 7. Concretely:

- The whole body of `recordModelCall` sits in a `try/catch`.
- Appends are chained on `scope.writes` so nested agents cannot interleave a
  half-written line, and the chain's rejections are swallowed — `mkdir` once,
  then `appendFile`.
- The tap does **not** await the write. A transcript is not worth a millisecond
  of a user's turn.
- After three consecutive write failures the module disables itself for the
  process and says so once. A dev instrument that logs an error per round for
  the rest of the session is worse than one that stops.

Tests, against a temp dir from `node:os`.`tmpdir()`: unset writes nothing;
a scope produces one file pair; a nested `withTranscript` writes into the
parent's file with `under` populated; two concurrent scopes write to two files
and never cross; a writer whose directory cannot be created does not throw and
the wrapped function still returns its value.

## Stage 3 — the tap

`src/server/google/vertex.ts`, inside `generateContent`.

Here and not at the injected `generate` seams. Every agent already defaults to
this function — `orchestrator.ts:373`, `designer/loop.ts:273`, `analyzer.ts:94`,
`cropper.ts:127`, `image-generator.ts:125` — so one tap catches all of them, and
catches the next one for free. Wrapping at each seam would mean threading a
wrapper through five call chains and forgetting the sixth.

```ts
export async function generateContent(model, contents, config = {}) {
  const started = Date.now();
  try {
    const answer = await throttleRetried(() => client().models.generateContent({...}));
    recordModelCall({ model, contents, config, answer, ms: Date.now() - started });
    return answer;
  } catch (cause) {
    recordModelCall({ model, contents, config, error: String(cause), ms: Date.now() - started });
    throw cause;
  }
}
```

Two consequences worth stating so they are not discovered later:

- A test that injects a fake `generate` records nothing, because the fake never
  reaches this function. That is correct — the suite asserts loops, not calls —
  and it is why `npm run smoke` and `npm run design:check` are still the way to
  capture a real transcript from the command line.
- `throttleRetried` wraps the SDK, and the tap wraps `throttleRetried`, so a
  call that was retried four times is one record. Right: the transcript is about
  the conversation, not the transport.

## Stage 4 — scoping the agents

Wrap each agent's public entry in `withTranscript`, innermost body unchanged:

| Agent | File | Function | Label |
|---|---|---|---|
| 6 orchestrator | `src/server/agents/orchestrator/turn.ts:16` | `runOrchestratorTurn` | `orchestrator` |
| 8 designer | `src/server/agents/designer/design.ts:252` | `designPage` | `designer` |
| 2 analyzer | `src/server/agents/analyzer/analyzer.ts:84` | `analyzeReference` | `analyzer` |
| 3 cropper | `src/server/agents/cropper/cropper.ts:116` | `cropReference` | `cropper` |
| — image | `src/server/agents/image-generator/image-generator.ts:120` | `generateImage` | `image-generator` |

`LAYOUT_READER` and `COMPOSITOR` make their calls inline inside
`src/server/agents/orchestrator/tools.ts` (around 2159 and 2408). They need no wrapper: they
run inside the orchestrator's scope and are recorded under it. Their records
carry `agent: "orchestrator"`, which is honest — they are calls that turn made.
Give them their own `withTranscript` only if a reader ever finds that confusing.

A design run started from `vibes.designPage` has no orchestrator above it and
opens its own turn. An analysis kicked by `after()` likewise. Both are correct:
a turn is the outermost agent, not always a chat message.

After this stage: chat in the browser with the variable set, and you get a
complete file with everything except the thinking. **Stop here and use it for a
day before starting stage 5.**

## Stage 5 — the thinking, and the three things it breaks

Gemini returns a thought summary only when asked, and asking has three
consequences that will each look like a different bug if they are met one at a
time. Do all four edits together.

**5.1 — the config.** `GenerateConfig` in `vertex.ts` has no `thinkingConfig`
field, so it cannot be passed. Add it:

```ts
thinkingConfig?: { includeThoughts?: boolean; thinkingBudget?: number; thinkingLevel?: string };
```

**5.2 — asking for it.** Only when the transcript is on. The summaries are
output tokens on a real invoice (`docs/Metering.md` §II: "`outputTokens` is
everything the model wrote, thinking included"), and a production turn should not
pay for a sentence nobody reads. So the tap's own module exports
`transcribing(): boolean`, and each agent's call site spreads
`...(transcribing() && { thinkingConfig: { includeThoughts: true } })`.

Start with the orchestrator and the designer. They are the two agents anyone
tunes; the analyzer's one-shot vision read gains nothing from a summary.

**5.3 — `textOf` leaks thoughts into the reply.** `vertex.ts:304` is
`parts.map((part) => part.text ?? "").join("")`. A thought part *is* a text part
with `thought: true`, so the moment 5.2 lands, the model's reasoning is
concatenated onto the front of the user's reply — in the chat, and in agent 8's
closing line via `designer/loop.ts`. One fix serves both:

```ts
export function textOf(parts: GeneratePart[]) {
  return parts.filter((part) => !part.thought).map((part) => part.text ?? "").join("").trim();
}
```

Add `thoughtsOf(parts)` beside it for the transcript's `thinking` field. Test
both against a parts array holding one thought part and one real one.

**5.4 — thought parts become stored chat bubbles.** `orchestrator.ts:572` maps
every non-`functionCall` part to `{ type: "text", text: part.text ?? "", wire: part }`
and pushes it onto `answering`. That array is what `forStorage` writes to
`ChatMessage.parts`, and `forDisplay` draws a `text` part as a bubble. So without
this fix the model's private reasoning is persisted to the database and rendered
in the user's chat column.

The fix follows `wire`'s own precedent exactly. `Emitted` in
`shared/conversation.ts` is `Part & { wire?: GeneratePart }` — in memory only,
the schema does not know the field. Add a second one:

```ts
export type Emitted = Part & { wire?: GeneratePart; thought?: boolean };
```

- The orchestrator's map sets `thought: true` when `part.thought`.
- `forStorage` drops any part carrying it — one line in the existing `flatMap`,
  beside the empty-text rule that is already there.
- `forRequest` is left alone. It sends `wire` verbatim, which keeps the
  `thoughtSignature` the API requires echoed on the next round of the same turn.
  This is precisely why `wire` exists; do not "clean up" the thought part out of
  the request.

Tests in `conversation.test.mts`: a thought-marked emitted part is absent from
`forStorage`'s output, and present in `forRequest`'s contents.

## Stage 6 — reading them

`scripts/transcript.mts`, `npm run transcript`.

The `.md` written in stage 1 is what you open. This is for the other half —
finding the turn worth opening:

```
npm run transcript                  # list the last 20, one line each
npm run transcript -- --last        # print the most recent
npm run transcript -- <stem>        # print one
```

One line per turn: time, agents involved, rounds, tokens, the user's first
sentence. Model it on `scripts/design-runs.mts`, which is already the shape of a
"what did the last N runs do" reader.

## Why JSONL and not only markdown

The `.md` is for you. The `.jsonl` is for the suite.

Every test of every agent in this repo hands `generate` a scripted answer —
`design-check.mts` puts the number on it: "every round of every test hands
`designPage` a `generate` that answers from a script… twenty-seven iterations of
it cost nothing." A captured transcript **is** that script. A turn that goes
wrong in the browser can become a fixture that replays for free, forever, and the
instruction can then be iterated against a real failure instead of a
reconstruction of one.

Nothing in this task builds that replay. Do not let the record's shape make it
impossible: keep the JSONL one complete record per line, and keep `contents`
faithful apart from the elisions in stage 1.

## What this task is not

- Not the streaming work. Nothing here changes what the browser sees; the chat
  still shows "Thinking…" when this lands. The two share `includeThoughts` and
  nothing else.
- Not observability. There is no dashboard, no aggregation, no retention policy.
  Files accumulate in a gitignored directory and the user deletes them.
- Not a `ChatMessage` change. `call` parts stay stored and undrawn
  (`docs/Conversation.md` §I.3); the transcript is a separate artefact with a
  separate life, which is what lets it be verbose.
