import { NO_USAGE, sumUsage, type TokenUsage } from "@/lib/agent/shared/model-cost";
import type { Content, GeneratePart } from "@/server/google/vertex";

/// One model call, as a transcript keeps it. The pure half of the instrument:
/// what a record is, what it may not carry, and how it reads. The writing of it
/// is `server/agents/shared/transcript.ts` — this side is what a test can reach, and
/// the `Content`/`GeneratePart` imports above are types alone, erased exactly as
/// `tool-window.ts` erases the same one.

export type TranscriptRecord = {
  /// Within the turn, from 1 — a turn's rounds are numbered even when three
  /// agents produced them, because the order they ran in is the reading.
  seq: number;
  at: string;
  /// The innermost scope, and the ones enclosing it outermost first.
  agent: string;
  under: string[];
  model: string;
  ms: number;
  systemInstruction?: string;
  /// Names only. The schemas are in the source and putting them here would
  /// multiply the largest constant in the app by the number of rounds.
  declarations: string[];
  contents: unknown[];
  thinking: string[];
  text: string;
  calls: { name: string; args: Record<string, unknown> }[];
  finishReason?: string;
  usage?: TokenUsage;
  /// Written instead of the answer fields when the call threw.
  error?: string;
};

/// The most of a tool answer a record keeps, in characters of its JSON.
///
/// Deliberately far larger than `RESULT_STORE_LIMIT` (`conversation.ts`): that
/// constant bounds a row in a database this instrument is not writing to, and
/// the tool answers are half of what makes a transcript worth reading.
export const TRANSCRIPT_RESPONSE_LIMIT = 10_000;

/// How long the decoded bytes are, without decoding them. A picture is elided
/// for its size and the size is the only thing left worth saying about it, so
/// materialising megabytes to measure them would be paying the cost the elision
/// exists to avoid.
function base64Bytes(data: string) {
  const packed = data.replace(/[^A-Za-z0-9+/]/g, "").length;
  return Math.floor((packed * 3) / 4);
}

function redactedPart(part: GeneratePart): unknown {
  const kept: Record<string, unknown> = { ...part };

  /// Requirement 6, and the only rule here that is not a convenience: base64 in
  /// a file this large makes it unopenable and says nothing a media type and a
  /// byte count do not.
  if (part.inlineData) {
    kept.inlineData = {
      mimeType: part.inlineData.mimeType,
      bytes: base64Bytes(part.inlineData.data ?? ""),
      elided: true,
    };
  }

  /// Opaque, long, and addressed to the model rather than to a reader. The
  /// length stays because a signature that arrived and one that did not are
  /// different rounds.
  if (typeof part.thoughtSignature === "string") {
    kept.thoughtSignature = `<signature, ${part.thoughtSignature.length} chars>`;
  }

  if (part.functionResponse?.response) {
    const { response, ...rest } = part.functionResponse;
    const json = JSON.stringify(response);
    kept.functionResponse =
      json.length > TRANSCRIPT_RESPONSE_LIMIT
        ? { ...rest, response: json.slice(0, TRANSCRIPT_RESPONSE_LIMIT), truncated: true }
        : part.functionResponse;
  }

  return kept;
}

/// The body as it went up, minus the two things a file cannot hold. A `fileData`
/// uri is kept whole: `gs://` is a pointer, not payload.
export function redactedContents(contents: readonly Content[]): unknown[] {
  return contents.map(({ role, parts }) => ({ role, parts: (parts ?? []).map(redactedPart) }));
}

/// Colons are not legal in a filename on every platform, so the ISO time has
/// them replaced; the milliseconds go with them because two rounds of one turn
/// share a stem anyway.
export function transcriptStem({
  at,
  agent,
  turnId,
}: {
  at: string;
  agent: string;
  turnId: string;
}) {
  const safely = (word: string) => word.replace(/[^A-Za-z0-9._-]+/g, "-");
  return `${at.slice(0, 19).replace(/:/g, "-")}_${safely(agent)}_${safely(turnId)}`;
}

/// What a request carried, read off the parts rather than off the loop —
/// `design-check.mts`'s reading, which is the one that has proved worth having
/// at the top of a round.
export function sentSaid(contents: readonly unknown[]) {
  const parts = contents.flatMap((content) => {
    const held = (content as { parts?: unknown }).parts;
    return Array.isArray(held) ? (held as Record<string, unknown>[]) : [];
  });
  const pictures = parts.filter((part) => part.inlineData || part.fileData).length;
  return `${contents.length} content${contents.length === 1 ? "" : "s"}${
    pictures ? `, ${pictures} picture${pictures === 1 ? "" : "s"}` : ""
  }`;
}

/// Wide enough for the boxes: an argument is geometry, and a `put_on_canvas`
/// truncated before its box is the one thing a reader opened the file for.
/// `design-check.mts` set this number against two real runs.
const ARGUMENT_LIMIT = 900;

const shortly = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > ARGUMENT_LIMIT ? `${text.slice(0, ARGUMENT_LIMIT - 3)}…` : text;
};

const named = ({ name, args }: { name: string; args?: Record<string, unknown> }) =>
  `${name}(${Object.entries(args ?? {})
    .map(([key, value]) => `${key}=${shortly(value)}`)
    .join(", ")})`;

const usageSaid = (usage?: TokenUsage) =>
  usage ? ` · ${usage.promptTokens}→${usage.outputTokens} tokens` : "";

/// Four backticks, because a content is prose the model wrote and prose the
/// model wrote contains fenced code.
const fenced = (language: string, body: string) => `\`\`\`\`${language}\n${body}\n\`\`\`\``;

/// The instruction and the contents go inside `<details>` because they are
/// enormous and identical on most rounds; the thinking, the calls and the reply
/// are what a reader is scanning for.
function sentDetails(record: TranscriptRecord) {
  const offered = record.declarations.length
    ? ` · ${record.declarations.length} tool${record.declarations.length === 1 ? "" : "s"} offered`
    : "";
  const body = [
    ...(record.systemInstruction
      ? ["**instruction**", fenced("", record.systemInstruction)]
      : []),
    ...(record.declarations.length ? [`**offered** — ${record.declarations.join(", ")}`] : []),
    "**contents**",
    fenced("json", JSON.stringify(record.contents, null, 2)),
  ].join("\n\n");

  return `<details><summary>sent — ${sentSaid(record.contents)}${offered}</summary>\n\n${body}\n\n</details>`;
}

/// One record as markdown, appended to `<stem>.md` as it happens.
export function renderRecord(record: TranscriptRecord): string {
  const under = record.under.length ? ` (under ${record.under.join(" › ")})` : "";
  const head = `## round ${record.seq} · ${record.agent}${under} · ${record.model} · ${(
    record.ms / 1000
  ).toFixed(1)}s${usageSaid(record.usage)}`;

  const said = record.error
    ? [`**failed** — ${record.error}`]
    : [
        ...record.thinking.filter(Boolean).map((thought) => `**thinking** — ${thought.trim()}`),
        ...(record.calls.length
          ? [`**asked** — ${record.calls.map((call) => `\`${named(call)}\``).join("  ")}`]
          : []),
        ...(record.text ? [`**said** — ${record.text.trim()}`] : []),
        ...(record.calls.length || record.text || record.thinking.length
          ? []
          : [`**said nothing**${record.finishReason ? ` (${record.finishReason})` : ""}`]),
      ];

  return `${[head, ...said, sentDetails(record)].join("\n\n")}\n\n`;
}

/// The other half of stage 6, and the reason the `.jsonl` is written beside the
/// `.md`: the markdown is what you open, this is what finds the turn worth
/// opening. `scripts/transcript.mts` is the console for it.

/// One turn, as a list of turns reads it.
export type TranscriptSummary = {
  stem: string;
  at: string;
  agents: string[];
  rounds: number;
  usage: TokenUsage;
  failed: number;
  opening: string;
};

/// Lines this cannot make sense of are skipped rather than thrown on. The
/// appends are deliberately unawaited, so a file whose process was killed
/// mid-write ends in half a line — and half a line is not a reason to refuse to
/// read the ninety complete ones above it.
export function transcriptRecords(jsonl: string): TranscriptRecord[] {
  return jsonl
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        const record = JSON.parse(line) as TranscriptRecord;
        return typeof record?.seq === "number" ? [record] : [];
      } catch {
        return [];
      }
    });
}

const OPENING_LIMIT = 60;

const textIn = (content: unknown) => {
  const parts = (content as { parts?: unknown }).parts;
  return (Array.isArray(parts) ? (parts as { text?: unknown }[]) : [])
    .map(({ text }) => (typeof text === "string" ? text : ""))
    .join(" ")
    .trim();
};

/// What the user said to start the turn: the *last* user content of the first
/// round, not the first. Round 1 of a chat message carries the whole
/// conversation and the newest message is at the end of it — the first user
/// content is what they said an hour ago.
export function turnOpening(records: readonly TranscriptRecord[]): string {
  const [first] = records;
  const said = (first?.contents ?? [])
    .filter((content) => (content as { role?: unknown }).role === "user")
    .map(textIn)
    .filter(Boolean);
  const sentence = (said[said.length - 1] ?? "").split(/(?<=[.!?])\s|\n/)[0]?.trim() ?? "";
  return sentence.length > OPENING_LIMIT ? `${sentence.slice(0, OPENING_LIMIT - 1)}…` : sentence;
}

/// The agents in the order they first spoke, enclosing scopes included: a turn
/// whose designer never got past its first round should still say a designer
/// was in it.
export function turnAgents(records: readonly TranscriptRecord[]): string[] {
  const seen: string[] = [];
  for (const record of records) {
    for (const agent of [...record.under, record.agent]) {
      if (agent && !seen.includes(agent)) seen.push(agent);
    }
  }
  return seen;
}

export function transcriptSummary(
  stem: string,
  records: readonly TranscriptRecord[],
): TranscriptSummary {
  return {
    stem,
    at: records[0]?.at ?? "",
    agents: turnAgents(records),
    rounds: records.length,
    usage: sumUsage(records.map((record) => record.usage ?? NO_USAGE)),
    failed: records.filter((record) => record.error).length,
    opening: turnOpening(records),
  };
}

/// One turn as one line, for the listing. The stem leads because it is the
/// argument you copy out of the line, and it opens with the time — so the
/// column that identifies a turn and the column that dates it are one column.
/// The opening is last because it is the field a human recognises a turn by and
/// the only one worth a ragged right edge.
export function summaryLine(summary: TranscriptSummary): string {
  const tokens = `${summary.usage.promptTokens.toLocaleString()}→${summary.usage.outputTokens.toLocaleString()}`;
  return [
    summary.stem.padEnd(42),
    `${String(summary.rounds).padStart(3)} round${summary.rounds === 1 ? " " : "s"}`,
    tokens.padStart(17),
    summary.agents.join(" › ").padEnd(26),
    summary.failed ? `${summary.failed} failed  ` : "",
    summary.opening && `"${summary.opening}"`,
  ]
    .filter(Boolean)
    .join("  ");
}
