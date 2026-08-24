import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { env } from "@/env";
import { renderRecord, transcriptStem, type TranscriptRecord } from "@/lib/agent/shared/transcript";

/// The writing half of the instrument: a turn's scope, and the append that
/// lands one model call in it. The pure half — what a record is and how it
/// reads — is `lib/agent/shared/transcript.ts`.
///
/// `AGENT_TRANSCRIPT_DIR` unset is the default everywhere and the only state a
/// deployment is ever in, and it means not one byte written and not one line of
/// behaviour changed. Every entry point below returns before it allocates.

type TurnScope = {
  turnId: string;
  stem: string;
  /// The stack, outermost first. Copied rather than pushed into, because the
  /// orchestrator runs a round's tools through `Promise.all` — two agents can
  /// be inside one turn at once, and a shared stack would label the second
  /// agent's rounds with the first's name.
  agents: string[];
  /// Shared by the whole turn: one sequence, so the rounds read in the order
  /// they ran whichever agent made them.
  next: () => number;
  /// The append chain, shared for the same reason — nested agents writing to
  /// one file must not interleave half a line.
  append: (record: TranscriptRecord) => void;
  settled: () => Promise<unknown>;
};

const scopes = new AsyncLocalStorage<TurnScope>();

/// Three consecutive failures and the instrument stops for the process. A full
/// disk does not get better on the next round, and an error per round for the
/// rest of the session is worse than an instrument that admits it is off.
const FAILURES_TOLERATED = 3;
let failures = 0;
let disabled = false;

function directory() {
  const set = env().AGENT_TRANSCRIPT_DIR;
  return typeof set === "string" && set.trim() ? set.trim() : undefined;
}

/// Whether anything is being recorded. Stage 5 asks the model for its thought
/// summaries only when this is true: summaries are output tokens on a real
/// invoice, and a production turn should not pay for a sentence nobody reads.
export function transcribing() {
  return !disabled && directory() !== undefined;
}

function writeFailed(cause: unknown) {
  failures += 1;
  if (failures < FAILURES_TOLERATED) {
    console.error("agent transcript write failed:", cause);
    return;
  }
  disabled = true;
  console.error(
    `agent transcripts disabled for this process after ${FAILURES_TOLERATED} failed writes:`,
    cause,
  );
}

/// The directory is made on the first record and not before, so an agent that
/// refuses before its first model call leaves no empty pair of files behind.
function turnWriter(into: string, stem: string) {
  let chain: Promise<unknown> = Promise.resolve();
  let made = false;

  const append = (record: TranscriptRecord) => {
    chain = chain
      .then(async () => {
        if (disabled) return;
        if (!made) {
          await mkdir(into, { recursive: true });
          made = true;
        }
        await appendFile(join(into, `${stem}.jsonl`), `${JSON.stringify(record)}\n`);
        await appendFile(join(into, `${stem}.md`), renderRecord(record));
        failures = 0;
      })
      .catch(writeFailed);
  };

  return { append, settled: () => chain };
}

/// Wraps an agent's public entry. A wrapper rather than a `startTranscript()`
/// because that is what makes a nested agent land in its parent's file: agent 8
/// called by agent 6 finds the turn already open and joins it, and one chat
/// message that designs a page is one file with both agents' rounds in the
/// order they happened.
export function withTranscript<T>(agent: string, run: () => Promise<T>): Promise<T> {
  const into = transcribing() ? directory() : undefined;
  if (!into) return run();

  const open = scopes.getStore();
  if (open) return scopes.run({ ...open, agents: [...open.agents, agent] }, run);

  const at = new Date().toISOString();
  const turnId = randomUUID().slice(0, 8);
  let seq = 0;
  const stem = transcriptStem({ at, agent, turnId });
  return scopes.run(
    { turnId, stem, agents: [agent], next: () => (seq += 1), ...turnWriter(into, stem) },
    run,
  );
}

/// Called by the tap in `google/vertex.ts`, which does not await the write: a
/// transcript is not worth a millisecond of a user's turn. Synchronous, and its
/// whole body is guarded — the instrument never throws into a turn.
export function recordModelCall(
  record: Omit<TranscriptRecord, "seq" | "at" | "agent" | "under">,
): void {
  try {
    const scope = scopes.getStore();
    if (!scope || disabled) return;
    const { agents } = scope;
    scope.append({
      ...record,
      seq: scope.next(),
      at: new Date().toISOString(),
      agent: agents[agents.length - 1] ?? "",
      under: agents.slice(0, -1),
    });
  } catch (cause) {
    console.error("agent transcript record failed:", cause);
  }
}

/// For the tests alone. The appends are deliberately unawaited, so nothing else
/// can tell when a turn's file has actually landed — and swallowing the chain's
/// rejections means this resolves either way.
export function transcriptSettled(): Promise<unknown> {
  return scopes.getStore()?.settled() ?? Promise.resolve();
}
