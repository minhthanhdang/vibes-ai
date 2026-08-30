import { NO_USAGE, sumUsage, type TokenUsage } from "@/lib/agent/shared/model-cost";
import type { Content, GeneratePart } from "@/server/google/vertex";

export type TranscriptRecord = {
  seq: number;
  at: string;
  agent: string;
  under: string[];
  model: string;
  ms: number;
  systemInstruction?: string;
  declarations: string[];
  contents: unknown[];
  thinking: string[];
  text: string;
  calls: { name: string; args: Record<string, unknown> }[];
  finishReason?: string;
  usage?: TokenUsage;
  error?: string;
};

export const TRANSCRIPT_RESPONSE_LIMIT = 10_000;

function base64Bytes(data: string) {
  const packed = data.replace(/[^A-Za-z0-9+/]/g, "").length;
  return Math.floor((packed * 3) / 4);
}

function redactedPart(part: GeneratePart): unknown {
  const kept: Record<string, unknown> = { ...part };

  if (part.inlineData) {
    kept.inlineData = {
      mimeType: part.inlineData.mimeType,
      bytes: base64Bytes(part.inlineData.data ?? ""),
      elided: true,
    };
  }

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

export function redactedContents(contents: readonly Content[]): unknown[] {
  return contents.map(({ role, parts }) => ({ role, parts: (parts ?? []).map(redactedPart) }));
}

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

const fenced = (language: string, body: string) => `\`\`\`\`${language}\n${body}\n\`\`\`\``;

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

export type TranscriptSummary = {
  stem: string;
  at: string;
  agents: string[];
  rounds: number;
  usage: TokenUsage;
  failed: number;
  opening: string;
};

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

export function turnOpening(records: readonly TranscriptRecord[]): string {
  const [first] = records;
  const said = (first?.contents ?? [])
    .filter((content) => (content as { role?: unknown }).role === "user")
    .map(textIn)
    .filter(Boolean);
  const sentence = (said[said.length - 1] ?? "").split(/(?<=[.!?])\s|\n/)[0]?.trim() ?? "";
  return sentence.length > OPENING_LIMIT ? `${sentence.slice(0, OPENING_LIMIT - 1)}…` : sentence;
}

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
