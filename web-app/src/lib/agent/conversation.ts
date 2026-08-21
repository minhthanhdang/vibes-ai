import { z } from "zod";
import { historyWindow, type ChatTurn } from "@/lib/agent/chat-history";
import { idsIn, toolWindow } from "@/lib/agent/tool-window";
import type { ChatAttachment } from "@/lib/agent/agent-tools";
import type { Content, GeneratePart } from "@/server/google/vertex";

/// One shape for every message in the chat, drawn by the browser and serialized
/// into the request by the turn, so that what the user is looking at and what
/// the model was told are the same object rather than two that agree by hand.
///
/// The conversation exists three times without this — `ChatLog.messages` for
/// the column, `ChatTurn[]` posted upward as history, and the `Content[]` the
/// loop assembles — and the tool calls, the most expensive thing a turn
/// produces, exist only in the third and die with it. Here there is one
/// `Message` with tagged parts, and the column and the Vertex request are two
/// projections of it: `forDisplay` and `forRequest`.
///
/// Loaded in the browser and on the server both — the seam `agent-tools.ts`
/// already occupies — so nothing `server-only` may be imported here. The
/// `Content` import is type-only and erased, for `tool-window.ts`'s reason.

/// The attachment is written by the turn that built it in memory and drawn
/// verbatim on read, so the schema checks only the discriminant the column keys
/// tiles by and trusts the rest: a stored row is never rejected on read, and a
/// tile missing a field degrades per field rather than taking the row with it.
export const chatAttachmentSchema = z.custom<ChatAttachment>((value) => {
  if (typeof value !== "object" || value === null) return false;
  const { kind } = value as { kind?: unknown };
  if (kind === "reference") return typeof (value as { referenceId?: unknown }).referenceId === "string";
  return kind === "board" && typeof (value as { boardId?: unknown }).boardId === "string";
});

const textPart = z.object({ type: z.literal("text"), text: z.string() });

/// Something the user did with their hands that the conversation has to hear
/// about: a cut taken in the properties panel, a board or page or picture
/// thrown away from an offer. It stays the user's — the model has to read it as
/// new information rather than as its own claim. `note` is what rides up as
/// history; `payload` is the structured half the column needs and the sentence
/// cannot carry.
export const EVENT_KINDS = ["cut_taken", "board_discarded", "page_discarded", "reference_discarded"] as const;

const eventPart = z.object({
  type: z.literal("event"),
  event: z.enum(EVENT_KINDS),
  note: z.string(),
  payload: z.unknown(),
});

/// A page the user attached (tech-spec §V.5). A pointer, as it is today: what
/// the model is shown is rebuilt from the stored scene by `tools.attachedPages`,
/// never from this part, so a user cannot describe their own page to it.
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

/// `summary` is `toolWindow`'s `idsIn` — the ids this answer filed — kept when
/// the response itself was too big to store whole.
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

/// A part written by a build this one has not met. Kept verbatim, drawn as
/// nothing and left out of the request — the alternative is a schema bump that
/// makes yesterday's conversation unopenable, and this is a chat log, not a
/// migration.
const unknownPartSchema = z.looseObject({ type: z.string() });

export type UnknownPart = z.infer<typeof unknownPartSchema>;

/// Known shapes first, so a well-formed part parses as itself; anything else —
/// a type from a newer build, or a known type missing a field — survives as
/// unknown rather than taking the row down. A stored row is never rejected on
/// read.
const storedPartSchema = z.union([partSchema, unknownPartSchema]);

export const messageSchema = z.object({
  id: z.string(),
  /// Ordering within the project. Monotonic and assigned by the store, because
  /// two messages can land in one millisecond and an event is written by a
  /// different door than a reply.
  seq: z.number().int(),
  /// Which ask this message belongs to — the user's message, the assistant's
  /// answer and every call between them share one. The turn's own work is
  /// `turnId === current`, and everything else is history; this is the column
  /// `firstRoundAt` walks the assembled contents to rediscover.
  turnId: z.string(),
  /// `assistant`, not `model`. `model` is Gemini's word for it and this format
  /// is not Gemini's.
  role: z.enum(["user", "assistant"]),
  parts: z.array(storedPartSchema),
  /// `pending` is a turn on the wire, `failed` a turn that never arrived —
  /// moved onto the message they are about so that two questions in flight are
  /// not one boolean. Only the live turn in the browser ever sets `pending`.
  status: z.enum(["sent", "pending", "failed"]),
  /// Why it did not arrive. On the message rather than on the log for the same
  /// reason.
  error: z.string().optional(),
  at: z.string(),
});

export type Message = z.infer<typeof messageSchema>;

/// What the column draws for one part. A shape rather than a component so the
/// table below stays pure and loadable on both ends; the column decides what a
/// bubble or a tile looks like, this decides only which one a part is.
export type DrawnPart =
  | { kind: "bubble"; text: string }
  | { kind: "note"; text: string }
  | { kind: "chip"; boardId: string; pageId: string; name: string }
  | { kind: "tile"; attachment: ChatAttachment };

/// Carried through one `forRequest` walk. `attached` is the rebuilt scene parts
/// for the pages this turn's message points at — built by the caller from the
/// stored scene, because a page part is a pointer and the rebuild is a server
/// read this module must not make. They ride as one block in pick order, which
/// is the one thing the rebuild does not say per page, so the first page part
/// spends the whole block and the rest add nothing.
type SendContext = { attached: readonly GeneratePart[]; attachedSpent: boolean };

type PartRule<P extends Part = Part> = {
  draw: (part: P) => DrawnPart | null;
  send: (part: P, context: SendContext) => GeneratePart[];
};

/// The whole specification of both projections, as code: a part type added for
/// the column that the adapter does not map fails to compile instead of
/// vanishing silently from the model's view of the conversation. A silent drop
/// here is the failure mode that takes longest to notice — the reply stays
/// plausible, it just answers less than it was shown.
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
    /// Stored always, drawn never: the record is the point, the rendering is a
    /// preference, and a per-tool phrasing table is the thing that rots first.
    draw: () => null,
    send: ({ name, args }) => [{ functionCall: { name, args } }],
  },
  result: {
    draw: () => null,
    /// A result degraded past `RESULT_STORE_LIMIT` has no response to send —
    /// and is never actually sent, because only its own turn carries results
    /// and the live turn holds them whole in memory. The mapping still has to
    /// say something, and what it says is what the summary is: the ids the
    /// answer filed, marked as the remainder of a bigger thing.
    send: ({ name, response, summary }) => [
      { functionResponse: { name, response: response ?? { filed: summary ?? [], truncated: true } } },
    ],
  },
  attachment: {
    draw: ({ attachment }) => ({ kind: "tile", attachment }),
    /// Never. The model's own tool calls put the attachment there, and sending
    /// it back would have it reading its own attachments as new evidence.
    send: () => [],
  },
} satisfies { [T in Part["type"]]: PartRule<Extract<Part, { type: T }>> };

/// By shape, not by tag: a part wearing a known `type` but missing its fields is
/// as unknown as a type from a newer build, and both degrade the same way —
/// kept, drawn as nothing, left out of the request.
const isKnown = (part: Part | UnknownPart): part is Part => partSchema.safeParse(part).success;

const ruleFor = (part: Part) => PART_RULES[part.type] as PartRule;

/// A part the live turn made out of the model's own emission, with the emission
/// riding beside it. Gemini's parts carry fields this format does not model —
/// the thought signature above all, which the API rejects a later round of the
/// same turn for omitting — so within its turn the request carries the part
/// exactly as it arrived, and the typed half is the record of it. In memory
/// only: the schema does not know the field, so a stored row loads without it —
/// rightly, because only a part's own live turn ever sends one back.
export type Emitted = Part & { wire?: GeneratePart };

const sentOf = (part: Part, context: SendContext): GeneratePart[] => {
  const { wire } = part as Emitted;
  return wire ? [wire] : ruleFor(part).send(part, context);
};

/// What a message *said*, as one wire turn carries it: the words and the notes
/// beside them, nothing else. This is the projection a past turn is reduced to —
/// the browser windows its history through it and `forRequest` serializes
/// through it, so what the user can see the model was told matches what it was
/// told.
export function spoken(parts: readonly (Part | UnknownPart)[]): string {
  return parts
    .flatMap((part) => {
      if (!isKnown(part)) return [];
      if (part.type === "text") return [part.text];
      if (part.type === "event") return [part.note];
      return [];
    })
    .join("\n\n");
}

/// Everything renders — except what the table says is drawn as nothing, and
/// parts this build does not know.
export function forDisplay(parts: readonly (Part | UnknownPart)[]): DrawnPart[] {
  return parts.flatMap((part) => {
    if (!isKnown(part)) return [];
    const drawn = ruleFor(part).draw(part);
    return drawn ? [drawn] : [];
  });
}

/// The `Content[]` a round of the turn is sent. Two rules, and they are today's
/// rules, only now expressed once:
///
/// 1. **Parts of past turns**: `text` and `event` only. Attachments stay behind
///    because the model's own tool calls put them there (`chat-history.ts`);
///    `call` and `result` stay behind because a turn that re-sent every
///    previous turn's rounds would grow without bound — the twelve-round turn
///    `tool-window.ts` was written for would be paid for again on every message
///    after it. Bounded by `historyWindow`'s three limits, unchanged.
/// 2. **Parts of this turn**: everything but `attachment`, bounded by
///    `toolWindow`'s two, unchanged — same drop order, same said-out-loud mark,
///    and the window still begins with something the user said.
///
/// A `failed` message is nobody's: it never reached the model, and carrying one
/// would have the assistant answering a question it was never asked.
///
/// The `functionResponse` re-roling to `user` lives here and nowhere else.
/// Vertex rejects a response with no call above it, which is the only reason
/// the role flips; the stored message says what is true — a call and its result
/// are both the assistant's work — and one assistant message serializes to
/// alternating `model` and `user` contents, one pair per adjacent
/// `(call…, result…)` group. A round is a group of parts, not a message.
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
      /// One wire turn per message, as the client posts one today: what was
      /// said and who said it, the notes beside the words, and nothing else.
      past.push({ role: message.role === "assistant" ? "model" : "user", text: spoken(message.parts) });
      continue;
    }

    if (message.role === "user") {
      const parts = message.parts.flatMap((part) => (isKnown(part) ? sentOf(part, context) : []));
      if (parts.length) turn.push({ role: "user", parts });
      continue;
    }

    /// The adapter. A new content starts where the wire role changes, so
    /// parallel calls of one round share one `model` content, their answers
    /// share one `user` content, and a message whose parts interleave two
    /// rounds serializes to four contents rather than two.
    let group: Content | null = null;
    for (const part of message.parts) {
      if (!isKnown(part)) continue;
      const sent = sentOf(part, context);
      if (!sent.length) continue;
      const role = part.type === "result" ? "user" : "model";
      if (!group || group.role !== role) {
        group = { role, parts: [] };
        turn.push(group);
      }
      group.parts.push(...sent);
    }
  }

  return toolWindow([
    ...historyWindow(past).map(({ role, text }) => ({ role, parts: [{ text }] })),
    ...turn,
  ]);
}

/// The most a `result` part may store of the response itself, in characters of
/// its JSON. A stored result is for the record, not for a later request — the
/// live turn holds its own answers in memory and no later turn is ever shown
/// them — so past this it degrades to `summary` plus `truncated`, the same
/// degradation `toolWindow` applies to an old round. Twelve rounds of crops
/// store twelve calls and twelve summaries, not twelve full answers. The number
/// is a round's share of `TOOL_CHAR_BUDGET`: what the window thinks a round is
/// worth carrying is what the record thinks an answer is worth keeping.
export const RESULT_STORE_LIMIT = 2_000;

const stripped = (part: Emitted): Part => {
  if (!("wire" in part)) return part;
  const kept = { ...part };
  delete kept.wire;
  return kept;
};

/// The live turn's parts as a row keeps them. Three departures from the parts
/// as the loop held them, each because the store outlives the turn: the raw
/// emission stays behind — a `wire` exists to be returned within its own turn
/// and the schema strips it on load anyway, so storing it would be paying to
/// keep thought signatures nothing may ever send; a text part that was only the
/// carrier of one is nothing said, and storing it would draw an empty bubble;
/// and a response past `RESULT_STORE_LIMIT` degrades to the ids it filed.
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
