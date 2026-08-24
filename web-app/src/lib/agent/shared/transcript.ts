import type { TokenUsage } from "@/lib/agent/shared/model-cost";
import type { Content, GeneratePart } from "@/server/google/vertex";

/// One model call, as a transcript keeps it. The pure half of the instrument:
/// what a record is, what it may not carry, and how it reads. The writing of it
/// is `server/agents/transcript.ts` — this side is what a test can reach, and
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
