import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { env } from "@/env";
import { renderRecord, transcriptStem, type TranscriptRecord } from "@/lib/agent/shared/transcript";

type TurnScope = {
  turnId: string;
  stem: string;
  agents: string[];
  next: () => number;
  append: (record: TranscriptRecord) => void;
  settled: () => Promise<unknown>;
};

const scopes = new AsyncLocalStorage<TurnScope>();

const FAILURES_TOLERATED = 3;
let failures = 0;
let disabled = false;

function directory() {
  try {
    const set = env().AGENT_TRANSCRIPT_DIR;
    return typeof set === "string" && set.trim() ? set.trim() : undefined;
  } catch {
    return undefined;
  }
}

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

export function transcriptSettled(): Promise<unknown> {
  return scopes.getStore()?.settled() ?? Promise.resolve();
}
