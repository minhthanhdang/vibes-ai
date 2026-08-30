import { z } from "zod";
import { historyWindow, type ChatTurn } from "@/lib/agent/orchestrator/history";
import { idsIn, toolWindow } from "@/lib/agent/shared/tool-window";
import type { ChatAttachment } from "@/lib/agent/shared/attachments";
import type { Content, GeneratePart } from "@/server/google/vertex";

export const chatAttachmentSchema = z.custom<ChatAttachment>((value) => {
  if (typeof value !== "object" || value === null) return false;
  const { kind } = value as { kind?: unknown };
  if (kind === "reference") return typeof (value as { referenceId?: unknown }).referenceId === "string";
  return kind === "board" && typeof (value as { boardId?: unknown }).boardId === "string";
});

const textPart = z.object({ type: z.literal("text"), text: z.string() });

export const EVENT_KINDS = ["cut_taken", "board_discarded", "page_discarded", "reference_discarded"] as const;

const eventPart = z.object({
  type: z.literal("event"),
  event: z.enum(EVENT_KINDS),
  note: z.string(),
  payload: z.unknown(),
});

const pagePart = z.object({
  type: z.literal("page"),
  boardId: z.string(),
  pageId: z.string(),
  revision: z.number(),
  name: z.string(),
  renderUri: z.string().optional(),
});

const callPart = z.object({
  type: z.literal("call"),
  callId: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
});

const resultPart = z.object({
  type: z.literal("result"),
  callId: z.string(),
  name: z.string(),
  ok: z.boolean(),
  response: z.record(z.string(), z.unknown()).optional(),
  summary: z.array(z.string()).optional(),
  truncated: z.boolean().optional(),
});

const attachmentPart = z.object({ type: z.literal("attachment"), attachment: chatAttachmentSchema });

export const partSchema = z.discriminatedUnion("type", [
  textPart,
  eventPart,
  pagePart,
  callPart,
  resultPart,
  attachmentPart,
]);

export type Part = z.infer<typeof partSchema>;

const unknownPartSchema = z.looseObject({ type: z.string() });

export type UnknownPart = z.infer<typeof unknownPartSchema>;

export const storedPartSchema = z.union([partSchema, unknownPartSchema]);

export const messageSchema = z.object({
  id: z.string(),
  seq: z.number().int(),
  turnId: z.string(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(storedPartSchema),
  status: z.enum(["sent", "pending", "failed"]),
  error: z.string().optional(),
  at: z.string(),
});

export type Message = z.infer<typeof messageSchema>;

export type DrawnPart =
  | { kind: "bubble"; text: string }
  | { kind: "note"; text: string }
  | { kind: "chip"; boardId: string; pageId: string; name: string }
  | { kind: "tile"; attachment: ChatAttachment };

type SendContext = { attached: readonly GeneratePart[]; attachedSpent: boolean };

type PartRule<P extends Part = Part> = {
  draw: (part: P) => DrawnPart | null;
  send: (part: P, context: SendContext) => GeneratePart[];
};

export const PART_RULES = {
  text: {
    draw: ({ text }) => ({ kind: "bubble", text }),
    send: ({ text }) => [{ text }],
  },
  event: {
    draw: ({ note }) => ({ kind: "note", text: note }),
    send: ({ note }) => [{ text: note }],
  },
  page: {
    draw: ({ boardId, pageId, name }) => ({ kind: "chip", boardId, pageId, name }),
    send: (_, context) => {
      if (context.attachedSpent) return [];
      context.attachedSpent = true;
      return [...context.attached];
    },
  },
  call: {
    draw: () => null,
    send: ({ name, args }) => [{ functionCall: { name, args } }],
  },
  result: {
    draw: () => null,
    send: ({ name, response, summary }) => [
      { functionResponse: { name, response: response ?? { filed: summary ?? [], truncated: true } } },
    ],
  },
  attachment: {
    draw: ({ attachment }) => ({ kind: "tile", attachment }),
    send: () => [],
  },
} satisfies { [T in Part["type"]]: PartRule<Extract<Part, { type: T }>> };

export const isKnownPart = (part: unknown): part is Part => partSchema.safeParse(part).success;

export function partsOfType<T extends Part["type"]>(
  parts: readonly unknown[],
  type: T,
): Extract<Part, { type: T }>[] {
  return parts.filter((part): part is Extract<Part, { type: T }> => isKnownPart(part) && part.type === type);
}

const ruleFor = (part: Part) => PART_RULES[part.type] as PartRule;

export type Emitted = Part & { wire?: GeneratePart; thought?: boolean };

const sentOf = (part: Part, context: SendContext): GeneratePart[] => {
  const { wire } = part as Emitted;
  return wire ? [wire] : ruleFor(part).send(part, context);
};

export function spoken(parts: readonly (Part | UnknownPart)[]): string {
  return parts
    .flatMap((part) => {
      if (!isKnownPart(part)) return [];
      if (part.type === "text") return [part.text];
      if (part.type === "event") return [part.note];
      return [];
    })
    .join("\n\n");
}

export function asHistory(messages: readonly Message[]): ChatTurn[] {
  return historyWindow(
    messages
      .filter((message) => message.status === "sent")
      .map((message) => ({
        role: message.role === "assistant" ? ("model" as const) : ("user" as const),
        text: spoken(message.parts),
      })),
  );
}

export function forDisplay(parts: readonly (Part | UnknownPart)[]): DrawnPart[] {
  return parts.flatMap((part) => {
    if (!isKnownPart(part)) return [];
    const drawn = ruleFor(part).draw(part);
    return drawn ? [drawn] : [];
  });
}

export type TurnStep = { callId: string; name: string; ok?: boolean; agent?: string };

export function stepsOf(parts: readonly (Part | UnknownPart)[]): TurnStep[] {
  const steps: TurnStep[] = [];
  const at = new Map<string, number>();
  for (const part of parts) {
    if (!isKnownPart(part)) continue;
    if (part.type === "call") {
      if (at.has(part.callId)) continue;
      at.set(part.callId, steps.length);
      steps.push({ callId: part.callId, name: part.name });
    } else if (part.type === "result") {
      const index = at.get(part.callId);
      if (index === undefined) continue;
      steps[index] = { ...steps[index]!, ok: part.ok };
    }
  }
  return steps;
}

export function stepsSaid(steps: readonly TurnStep[]): string {
  const failed = steps.filter((step) => step.ok === false).length;
  return `${steps.length} step${steps.length === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""}`;
}

function groupedContents(parts: readonly (Part | UnknownPart)[], context: SendContext): Content[] {
  const grouped: Content[] = [];
  let group: Content | null = null;
  for (const part of parts) {
    if (!isKnownPart(part)) continue;
    const sent = sentOf(part, context);
    if (!sent.length) continue;
    const role = part.type === "result" ? "user" : "model";
    if (!group || group.role !== role) {
      group = { role, parts: [] };
      grouped.push(group);
    }
    group.parts.push(...sent);
  }
  return grouped;
}

export function forRequest(
  messages: readonly Message[],
  { turnId, attached = [] }: { turnId: string; attached?: readonly GeneratePart[] },
): { contents: Content[]; dropped: number } {
  const context: SendContext = { attached, attachedSpent: false };
  const past: ChatTurn[] = [];
  const turn: Content[] = [];

  for (const message of messages) {
    if (message.status === "failed") continue;

    if (message.turnId !== turnId) {
      past.push({ role: message.role === "assistant" ? "model" : "user", text: spoken(message.parts) });
      continue;
    }

    if (message.role === "user") {
      const parts = message.parts.flatMap((part) => (isKnownPart(part) ? sentOf(part, context) : []));
      if (parts.length) turn.push({ role: "user", parts });
      continue;
    }

    turn.push(...groupedContents(message.parts, context));
  }

  return toolWindow([
    ...historyWindow(past).map(({ role, text }) => ({ role, parts: [{ text }] })),
    ...turn,
  ]);
}

export const RESULT_STORE_LIMIT = 2_000;

const stripped = (part: Emitted): Part => {
  if (!("wire" in part)) return part;
  const kept = { ...part };
  delete kept.wire;
  return kept;
};

export function forStorage(parts: readonly Emitted[]): Part[] {
  const kept: Part[] = [];
  for (const part of parts) {
    if (part.thought) continue;
    const bare = stripped(part);
    if (bare.type === "text") {
      if (!bare.text) continue;
      const last = kept[kept.length - 1];
      if (last?.type === "text") {
        kept[kept.length - 1] = { ...last, text: last.text + bare.text };
        continue;
      }
      kept.push(bare);
      continue;
    }
    if (bare.type === "result" && bare.response !== undefined) {
      if (JSON.stringify(bare.response).length > RESULT_STORE_LIMIT) {
        const { response, ...rest } = bare;
        kept.push({ ...rest, summary: idsIn(response), truncated: true });
        continue;
      }
    }
    kept.push(bare);
  }
  return kept;
}
