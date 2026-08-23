import { z } from "zod";
import { historyWindow, type ChatTurn } from "@/lib/agent/orchestrator/history";
import { idsIn, toolWindow } from "@/lib/agent/shared/tool-window";
import type { ChatAttachment } from "@/lib/agent/shared/attachments";
import type { Content, GeneratePart } from "@/server/google/vertex";

/// One shape for every message in the chat, with the column and the Vertex
/// request as two projections of it.
///
/// Loaded in the browser and on the server both — the seam `agent-tools.ts`
/// already occupies — so nothing `server-only` may be imported here. The
/// `Content` import is type-only and erased, for `tool-window.ts`'s reason.

/// Only the discriminant the column keys tiles by is checked; the rest is
/// trusted, so a tile missing a field degrades per field rather than taking the
/// row with it.
export const chatAttachmentSchema = z.custom<ChatAttachment>((value) => {
  if (typeof value !== "object" || value === null) return false;
  const { kind } = value as { kind?: unknown };
  if (kind === "reference") return typeof (value as { referenceId?: unknown }).referenceId === "string";
  return kind === "board" && typeof (value as { boardId?: unknown }).boardId === "string";
});

const textPart = z.object({ type: z.literal("text"), text: z.string() });

/// Something the user did with their hands that the conversation has to hear
/// about.
export const EVENT_KINDS = ["cut_taken", "board_discarded", "page_discarded", "reference_discarded"] as const;

const eventPart = z.object({
  type: z.literal("event"),
  event: z.enum(EVENT_KINDS),
  note: z.string(),
  payload: z.unknown(),
});

/// A page the user attached — a pointer, never the picture, so a user cannot
/// describe their own page to the model.
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

/// `summary` is `toolWindow`'s `idsIn`, kept when the response itself was too
/// big to store whole.
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

/// A part written by a build this one has not met.
const unknownPartSchema = z.looseObject({ type: z.string() });

export type UnknownPart = z.infer<typeof unknownPartSchema>;

/// Known shapes first, so a well-formed part parses as itself and anything else
/// survives as unknown rather than taking the row down.
export const storedPartSchema = z.union([partSchema, unknownPartSchema]);

export const messageSchema = z.object({
  id: z.string(),
  /// Monotonic and assigned by the store.
  seq: z.number().int(),
  /// Which ask this message belongs to; the turn's own work is `turnId ===
  /// current` and everything else is history.
  turnId: z.string(),
  /// `assistant`, not `model`.
  role: z.enum(["user", "assistant"]),
  parts: z.array(storedPartSchema),
  /// On the message rather than on the log, so two questions in flight are not
  /// one boolean.
  status: z.enum(["sent", "pending", "failed"]),
  /// Why it did not arrive.
  error: z.string().optional(),
  at: z.string(),
});

export type Message = z.infer<typeof messageSchema>;

/// What the column draws for one part — a shape rather than a component.
export type DrawnPart =
  | { kind: "bubble"; text: string }
  | { kind: "note"; text: string }
  | { kind: "chip"; boardId: string; pageId: string; name: string }
  | { kind: "tile"; attachment: ChatAttachment };

/// Carried through one `forRequest` walk. `attached` rides as one block in pick
/// order, so the first page part spends the whole block and the rest add
/// nothing.
type SendContext = { attached: readonly GeneratePart[]; attachedSpent: boolean };

type PartRule<P extends Part = Part> = {
  draw: (part: P) => DrawnPart | null;
  send: (part: P, context: SendContext) => GeneratePart[];
};

/// The whole specification of both projections, as code: the `satisfies` below
/// is what makes a part type the adapter does not map fail to compile instead
/// of vanishing silently from the model's view.
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
    /// Stored always, drawn never.
    draw: () => null,
    send: ({ name, args }) => [{ functionCall: { name, args } }],
  },
  result: {
    draw: () => null,
    /// A result degraded past `RESULT_STORE_LIMIT` has no response to send, and
    /// is never actually sent; what it says instead is the ids the answer
    /// filed, marked as the remainder of a bigger thing.
    send: ({ name, response, summary }) => [
      { functionResponse: { name, response: response ?? { filed: summary ?? [], truncated: true } } },
    ],
  },
  attachment: {
    draw: ({ attachment }) => ({ kind: "tile", attachment }),
    /// Never — the model's own tool calls put it there.
    send: () => [],
  },
} satisfies { [T in Part["type"]]: PartRule<Extract<Part, { type: T }>> };

/// By shape, not by tag: a part wearing a known `type` but missing its fields is
/// as unknown as a type from a newer build, and both degrade the same way —
/// kept, drawn as nothing, left out of the request.
///
/// Exported because it is the rule, not a detail of the projections: `chat-log`
/// reads stored parts through the same door, and a second hand-rolled
/// `safeParse` there is the rule restated rather than enforced. `unknown` rather
/// than `Part | UnknownPart` because one caller holds rows on their way to the
/// wire and has not parsed them at all.
export const isKnownPart = (part: unknown): part is Part => partSchema.safeParse(part).success;

/// The parts of one message that are of a type this build knows, narrowed.
export function partsOfType<T extends Part["type"]>(
  parts: readonly unknown[],
  type: T,
): Extract<Part, { type: T }>[] {
  return parts.filter((part): part is Extract<Part, { type: T }> => isKnownPart(part) && part.type === type);
}

const ruleFor = (part: Part) => PART_RULES[part.type] as PartRule;

/// A part the live turn made out of the model's own emission, with the emission
/// riding beside it. The thought signature is why: the API rejects a later
/// round of the same turn for omitting it, so within its turn the request
/// carries the part exactly as it arrived. In memory only — the schema does not
/// know the field.
export type Emitted = Part & { wire?: GeneratePart };

const sentOf = (part: Part, context: SendContext): GeneratePart[] => {
  const { wire } = part as Emitted;
  return wire ? [wire] : ruleFor(part).send(part, context);
};

/// What a message *said*, as one wire turn carries it: the words and the notes
/// beside them, nothing else.
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

/// What of a settled conversation goes back up with the next message. What is
/// decided here is *what is eligible*: only a `sent` message is history.
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

/// Everything renders — except what the table says is drawn as nothing, and
/// parts this build does not know.
export function forDisplay(parts: readonly (Part | UnknownPart)[]): DrawnPart[] {
  return parts.flatMap((part) => {
    if (!isKnownPart(part)) return [];
    const drawn = ruleFor(part).draw(part);
    return drawn ? [drawn] : [];
  });
}

/// One assistant message as the contents it serializes to. A new content starts
/// where the wire role changes, so parallel calls of one round share one
/// `model` content, their answers share one `user` content, and a message whose
/// parts interleave two rounds serializes to four contents rather than two.
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

/// The `Content[]` a round of the turn is sent: `text` and `event` of past
/// turns bounded by `historyWindow`, everything but `attachment` of this turn
/// bounded by `toolWindow`, and no `failed` message at all.
///
/// The `functionResponse` re-roling to `user` lives here and nowhere else,
/// because Vertex rejects a response with no call above it. A round is a group
/// of parts, not a message.
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
      /// One wire turn per message, as the client posts one today.
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

/// The most a `result` part may store of the response itself, in characters of
/// its JSON; past it the part degrades to `summary` plus `truncated`. A round's
/// share of `TOOL_CHAR_BUDGET`.
export const RESULT_STORE_LIMIT = 2_000;

const stripped = (part: Emitted): Part => {
  if (!("wire" in part)) return part;
  const kept = { ...part };
  delete kept.wire;
  return kept;
};

/// The live turn's parts as a row keeps them: no raw emission, no text part
/// that was only the carrier of one, and no response past `RESULT_STORE_LIMIT`.
export function forStorage(parts: readonly Emitted[]): Part[] {
  return parts.flatMap((part): Part[] => {
    const kept = stripped(part);
    if (kept.type === "text" && !kept.text) return [];
    if (kept.type === "result" && kept.response !== undefined) {
      if (JSON.stringify(kept.response).length > RESULT_STORE_LIMIT) {
        const { response, ...rest } = kept;
        return [{ ...rest, summary: idsIn(response), truncated: true }];
      }
    }
    return [kept];
  });
}
