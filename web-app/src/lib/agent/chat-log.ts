import { attachmentKey, type ChatAttachment } from "@/lib/agent/agent-tools";
import { discardKey, discardedBoardNote, type DiscardedBoard } from "@/lib/boards/board-discard";
import {
  discardedReferenceNote,
  referenceDiscardKey,
  type DiscardedReference,
} from "@/lib/references/reference-discard";
import {
  messageSchema,
  partSchema,
  type EVENT_KINDS,
  type Message,
  type Part,
} from "@/lib/agent/conversation";
import { discardedPageNote, pageDiscardKey, type DiscardedPage } from "@/lib/pages/page-discard";
import { pagesAfterPick, pagesStillOnBoard, type PageChoice } from "@/lib/pages/page-attach";
import { takenCutAttachment, takenCutNote, type TakenCut } from "@/lib/crop/cut-taken";

/// The conversation, as a value — and, since it is stored, as a cache.
///
/// It used to be `useState` inside the sidebar, which meant the assistant's
/// column *was* the conversation: collapsing it — one button, right above the
/// messages — unmounted the component and destroyed every word of it, along with
/// the board tiles and cuts the turns had produced. The results this
/// pipeline spends real money to put in the chat lasted exactly as long as
/// nobody touched the arrow.
///
/// So the conversation is a value the column renders rather than state the column
/// owns. That also moves the turn itself off the component: a reply that lands
/// while the sidebar is shut is still the answer to a question that was asked,
/// and a cut taken in the properties panel is still news whether or not the chat
/// is the thing on screen.
///
/// The messages themselves are the format's `Message` rows (`conversation.ts`),
/// because they are the same messages the store holds: `chatHydrated` loads the
/// stored conversation underneath whatever this session has said, and every
/// transition here appends the shape a row has, so a reload draws the same
/// column the session built. What is *not* a row stays a value on the log — the
/// draft, the picked pages, the in-flight flag — because a half-written message
/// is work and not yet a message.

export type ChatLog = {
  messages: Message[];
  /// A turn on the wire. Here rather than on the mutation that carries it,
  /// because the mutation dies with the component and the turn does not.
  asking: boolean;
  /// Why the last turn did not arrive, if it did not. Cleared by the next ask
  /// rather than left standing under an answered question.
  error: string | null;
  /// What the user has typed and not yet sent. Here for the same reason as
  /// everything else: a half-written message is work, and the collapse arrow is
  /// two inches above the box it is written in.
  draft: string;
  /// The pages picked for the message being written, in the order they were
  /// picked. Beside the draft because it is the same half-written message, and
  /// per-message rather than sticky (§V.5): it is emptied by the send, so the
  /// next question is about a page only if the user says so again.
  attached: PageChoice[];
};

export const EMPTY_CHAT_LOG: ChatLog = {
  messages: [],
  asking: false,
  error: null,
  draft: "",
  attached: [],
};

/// A message this session penned, in the row's own shape. The ids are the
/// browser's — the store assigns its own when the message is written, and the
/// next load replaces these wholesale — so all they have to be is unique in this
/// column: a retry targets one, and a React key is one.
function penned(
  log: ChatLog,
  {
    role,
    parts,
    status = "sent",
    turnId = crypto.randomUUID(),
  }: { role: Message["role"]; parts: Part[]; status?: Message["status"]; turnId?: string },
): Message {
  return {
    id: crypto.randomUUID(),
    seq: (log.messages.at(-1)?.seq ?? 0) + 1,
    turnId,
    role,
    status,
    parts,
    at: new Date().toISOString(),
  };
}

/// The question the live turn is about: only `sendTurn` ever marks a message
/// `pending`, and it refuses a second send while one is in flight, so there is
/// at most one — but an event landing meanwhile means it is not reliably the
/// bottom of the column.
const pendingIn = (messages: readonly Message[]) =>
  messages.findLast((message) => message.status === "pending");

export function chatTyped(log: ChatLog, draft: string): ChatLog {
  return { ...log, draft };
}

/// A page clicked in the picker, on or off. The rule is `pagesAfterPick`'s; what
/// this adds is that it is the *draft's* selection, so it lives and dies with the
/// message being written.
export function chatPagePicked(log: ChatLog, choice: PageChoice): ChatLog {
  return { ...log, attached: pagesAfterPick(log.attached, choice) };
}

/// The selection held against the board's pages as they now stand. Called when
/// the picker's list lands: a page deleted while the message was being written
/// would otherwise sit under the composer as a chip for something that is not
/// going up.
export function chatPagesListed(
  log: ChatLog,
  board: { boardId: string; revision: number; pages: readonly { pageId: string; name: string }[] },
): ChatLog {
  const attached = pagesStillOnBoard(log.attached, board);
  /// Same selection, same array — this runs on every landing of a query the
  /// picker keeps fresh, and a new array each time is a re-render of the column
  /// per refetch.
  return attached.length === log.attached.length &&
    attached.every((page, index) => page === log.attached[index])
    ? log
    : { ...log, attached };
}

/// The user's message going up. The text is trimmed here rather than at the
/// composer, so what is drawn is what was sent, and the draft is emptied in the
/// same transition — the box is cleared because the message left, so the two are
/// one change rather than two.
///
/// The attached pages become `page` parts ahead of the words, the order the
/// store writes them in, and come off the draft in the same change — an
/// attachment is per-message (§V.5) and a page that stayed picked would ride up
/// on the next question as well. `pending` until the turn settles it: it is the
/// mark the failure path finds the question by, and the one status only the
/// live turn in the browser ever sets.
export function chatAsked(log: ChatLog, message: string, pages: readonly PageChoice[] = []): ChatLog {
  const parts: Part[] = [
    ...pages.map(
      ({ boardId, pageId, revision, name }): Part => ({ type: "page", boardId, pageId, revision, name }),
    ),
    { type: "text", text: message.trim() },
  ];
  return {
    ...log,
    messages: [...log.messages, penned(log, { role: "user", parts, status: "pending" })],
    asking: true,
    error: null,
    draft: "",
    attached: [],
  };
}

export function chatAnswered(
  log: ChatLog,
  answer: { reply: string; attachments: ChatAttachment[] },
): ChatLog {
  const asked = pendingIn(log.messages);
  const settled = log.messages.map((message) =>
    message === asked ? { ...message, status: "sent" as const } : message,
  );
  return {
    ...log,
    messages: [
      ...settled,
      /// The answer shares the question's turnId: the two are one exchange, and
      /// the store keeps them under one id the same way.
      penned(log, {
        role: "assistant",
        turnId: asked?.turnId,
        parts: [
          { type: "text", text: answer.reply },
          ...answer.attachments.map((attachment): Part => ({ type: "attachment", attachment })),
        ],
      }),
    ],
    asking: false,
  };
}

/// A turn that did not arrive. The question stays in the column: it is what the
/// user asked, and dropping it would leave an error under somebody else's
/// message. It is marked as never having been sent, which is two things at once —
/// the tile the user can send again, and a message the next turn must not
/// carry up as history, since the model was never told it. Found by its
/// `pending` mark rather than by position, because a cut taken in the
/// properties panel lands as an event while a turn is in flight — so the
/// question that failed is not reliably the bottom of the column.
export function chatFailed(log: ChatLog, error: string): ChatLog {
  const asked = pendingIn(log.messages);
  return {
    ...log,
    asking: false,
    error,
    messages: asked
      ? log.messages.map((message) =>
          message === asked ? { ...message, status: "failed" as const, error } : message,
        )
      : log.messages,
  };
}

/// Sending a failed message again. The message itself is dropped here rather than
/// left in place and re-marked: what goes up next is a new turn, and two copies of
/// one question in the column is the conversation claiming they asked twice. By
/// id rather than by index, because an event landing while a turn is in flight
/// already moves everything under it.
export function chatRetried(log: ChatLog, id: string): ChatLog {
  const failed = log.messages.find((message) => message.id === id);
  if (failed?.status !== "failed") return log;
  return {
    ...log,
    messages: log.messages.filter((message) => message !== failed),
    error: null,
  };
}

/// The stored conversation, loaded under whatever this session has already
/// said. Rows come oldest-first from `chat.list` and are older than anything
/// penned here — the fetch went out when the column mounted — so they go in
/// front. Parsed by `messageSchema`, whose rule is that a stored row is never
/// rejected on read: a part this build does not know survives as itself, drawn
/// as nothing.
export function chatHydrated(log: ChatLog, rows: readonly unknown[]): ChatLog {
  const stored = rows.flatMap((row) => {
    const parsed = messageSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
  return stored.length ? { ...log, messages: [...stored, ...log.messages] } : log;
}

/// An event, as one message carries it: the note the model reads, the structured
/// half the column needs, and — for a cut — the tile under the note. One shape
/// for the transitions below and for `chat.record`, so what this session drew is
/// what the store is told.
export type ChatEvent = {
  event: (typeof EVENT_KINDS)[number];
  note: string;
  payload?: unknown;
  attachment?: ChatAttachment;
};

function noted(log: ChatLog, { event, note, payload, attachment }: ChatEvent): ChatLog {
  const parts: Part[] = [
    { type: "event", event, note, payload: payload ?? null },
    ...(attachment ? [{ type: "attachment", attachment } as Part] : []),
  ];
  return { ...log, messages: [...log.messages, penned(log, { role: "user", parts })] };
}

/// The event a message carries, read back off it — what the client posts to
/// `chat.record` after the transition that penned it, so the note and payload
/// are derived once and stored as drawn. By schema rather than by tag, because
/// `Message["parts"]` admits parts this build does not know.
export function recordedEvent(message: Message): ChatEvent | null {
  let noted: Pick<ChatEvent, "event" | "note" | "payload"> | null = null;
  let attachment: ChatAttachment | undefined;
  for (const part of message.parts) {
    const parsed = partSchema.safeParse(part);
    if (!parsed.success) continue;
    if (parsed.data.type === "event") {
      const { event, note, payload } = parsed.data;
      noted = { event, note, payload };
    } else if (parsed.data.type === "attachment") {
      attachment = parsed.data.attachment;
    }
  }
  return noted ? { ...noted, ...(attachment ? { attachment } : {}) } : null;
}

/// The other end of the properties panel's crop. `crop_reference` files its own
/// cuts now, but a user framing one by hand does it in another column entirely —
/// so the cut appears in the project without the conversation ever hearing of
/// it. This is where it comes back: the note rides up as history on the next
/// message, which is what lets the assistant put the cut on a board without
/// buying a round to find its id. No payload — the cut is a row the project
/// holds, and the tile under the note is the whole of what the column needs.
export function chatCutTaken(log: ChatLog, cut: TakenCut): ChatLog {
  return noted(log, {
    event: "cut_taken",
    note: takenCutNote(cut),
    attachment: takenCutAttachment(cut),
  });
}

/// The other end of `discard_board`: the tool offers, the user acts, and the
/// conversation is told what they did rather than being left to infer it from a
/// board that has quietly stopped existing.
///
/// It rides up as their turn for the reason a taken cut does — they did it with
/// their hands, and the model has to read it as new information rather than as
/// its own claim. No attachment: the thing this message is about is the one
/// thing in the project that is not there any more. The record itself is the
/// payload, which is what lets `discardedIn` rebuild the settled tiles from the
/// stored conversation instead of from a map only this session held.
export function chatBoardDiscarded(log: ChatLog, board: DiscardedBoard): ChatLog {
  return noted(log, { event: "board_discarded", note: discardedBoardNote(board), payload: board });
}

/// The other end of `discard_page`, on the same terms as a board's: the tool
/// offers, the user presses the button, and the conversation is told rather
/// than left to work out from a board that has quietly lost a rectangle. The
/// note has one thing a board's does not have to say — that the *board* id is
/// still good while the page id is dead — because the model is about to be handed
/// a boards brief that still lists the board, with one fewer page on it.
export function chatPageDiscarded(log: ChatLog, page: DiscardedPage): ChatLog {
  return noted(log, { event: "page_discarded", note: discardedPageNote(page), payload: page });
}

/// The other end of `discard_reference`, on the same terms: the tool offers,
/// the user presses Remove, and the conversation is told rather than left to
/// infer it from a picture that has quietly stopped existing. The note carries
/// more than a board's because the loss does: the cuts made of it went with it,
/// and the boards it was holding up now have a gap.
export function chatReferenceDiscarded(log: ChatLog, reference: DiscardedReference): ChatLog {
  return noted(log, {
    event: "reference_discarded",
    note: discardedReferenceNote(reference),
    payload: reference,
  });
}

/// The subjects the user has thrown away, by the key their tile is drawn under.
/// A discard offer is the one tile whose subject can stop existing while the
/// reply that made it is still on screen — so the tile has to stop offering
/// (the board cannot be discarded twice) *and* stop being a click, since the
/// tab row falls back to the first board for an id it does not hold and would
/// open the wrong one. A removed picture and a discarded page are the same
/// story under keys that cannot collide.
///
/// A fold over the event parts rather than a map the log carries: the events
/// *are* the record, stored with the conversation, so a reload settles the same
/// tiles the session settled by hand. A payload a newer build shaped
/// differently folds to nothing, on the same terms as an unknown part — kept,
/// and no tile settled by it.
export type Discarded = Record<string, DiscardedBoard | DiscardedReference | DiscardedPage>;

export function discardedIn(messages: readonly Message[]): Discarded {
  const gone: Discarded = {};
  for (const message of messages) {
    for (const part of message.parts) {
      const parsed = partSchema.safeParse(part);
      if (!parsed.success || parsed.data.type !== "event") continue;
      const { event, payload } = parsed.data;
      if (typeof payload !== "object" || payload === null) continue;
      const record = payload as Record<string, unknown>;
      if (event === "board_discarded" && typeof record.boardId === "string") {
        gone[discardKey(record.boardId)] = payload as DiscardedBoard;
      } else if (
        event === "page_discarded" &&
        typeof record.boardId === "string" &&
        typeof record.pageId === "string"
      ) {
        gone[pageDiscardKey(record.boardId, record.pageId)] = payload as DiscardedPage;
      } else if (event === "reference_discarded" && typeof record.referenceId === "string") {
        gone[referenceDiscardKey(record.referenceId)] = payload as DiscardedReference;
      }
    }
  }
  return gone;
}

/// The pages a message carried, back in the picker's shape — what a retry sends,
/// because the question going again is the question that was asked, pages and
/// all.
export function pagesOf(message: Message): PageChoice[] {
  return message.parts.flatMap((part) => {
    const parsed = partSchema.safeParse(part);
    if (!parsed.success || parsed.data.type !== "page") return [];
    const { boardId, pageId, revision, name } = parsed.data;
    return [{ boardId, pageId, revision, name }];
  });
}

/// What a tile actually draws, given everything the user has settled since. A
/// board they discarded, or a picture they removed, stops being a way in at all;
/// everything else is itself.
export function shownAs(
  discarded: Discarded,
  attachment: ChatAttachment,
): {
  attachment: ChatAttachment;
  /// Set when this tile's subject has been thrown away — a board discarded, or a
  /// picture removed from the project. The tile stays — it is under a reply that
  /// was about it, and a decision the user took is part of the conversation —
  /// but it is no longer a way in, because there is nothing to go to.
  ///
  /// A photograph needs this as badly as a board does: `inspectReference` on an
  /// id the gallery no longer lists resolves to nothing at all, so the tile is
  /// drawn, clicked, and the panel does not move.
  gone: DiscardedBoard | DiscardedReference | DiscardedPage | undefined;
} {
  /// The board's own key first: a board thrown away takes its pages with it, and
  /// a tile of one of those pages is as dead as a tile of the board.
  const gone =
    discarded[attachmentKey(attachment)] ??
    (attachment.kind === "board" && attachment.discardPage
      ? discarded[pageDiscardKey(attachment.boardId, attachment.discardPage.pageId)]
      : undefined);
  return { attachment, gone };
}
