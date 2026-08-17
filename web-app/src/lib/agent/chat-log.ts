import { attachmentKey, type ChatAttachment } from "@/lib/agent/agent-tools";
import { discardKey, discardedBoardNote, type DiscardedBoard } from "@/lib/boards/board-discard";
import {
  discardedReferenceNote,
  referenceDiscardKey,
  type DiscardedReference,
} from "@/lib/references/reference-discard";
import { historyWindow, type ChatTurn } from "@/lib/agent/chat-history";
import { pagesAfterPick, pagesStillOnBoard, type PageChoice } from "@/lib/pages/page-attach";
import { takenCutAttachment, takenCutNote, takenOfferKey, type TakenCut } from "@/lib/crop/cut-taken";

/// The conversation, as a value.
///
/// It used to be `useState` inside the sidebar, which meant the assistant's
/// column *was* the conversation: collapsing it — one button, right above the
/// messages — unmounted the component and destroyed every word of it, along with
/// the board tiles and crop offers the turns had produced. The results this
/// pipeline spends real money to put in the chat lasted exactly as long as
/// nobody touched the arrow.
///
/// So the conversation is a value the column renders rather than state the column
/// owns. That also moves the turn itself off the component: a reply that lands
/// while the sidebar is shut is still the answer to a question that was asked,
/// and a cut taken in the properties panel is still news whether or not the chat
/// is the thing on screen.
///
/// Not persisted. Every picture in it is a signed URL with an expiry on it, so a
/// conversation restored from storage tomorrow would be a column of broken tiles
/// under sentences about them. What is worth keeping is what is still true.

/// A reply is words and, when the orchestrator showed something, pictures. They
/// are one message rather than two: what it said and what it pointed at are the
/// same answer, and separating them puts a caption above an unrelated bubble the
/// moment a second turn arrives.
///
/// A message can also be something that *happened* rather than something either
/// side said — the director taking a cut the assistant offered. It is the
/// director's turn on the wire, because it is their doing and the model has to
/// read it as new information rather than as its own claim, and it is drawn as a
/// note rather than a bubble, because they did it with their hands and not by
/// typing it here.
///
/// And a message can be one the model never saw. A turn that does not arrive —
/// a rate limit, a dropped connection, a preview model having a bad minute —
/// leaves what the director typed standing in the column with nothing under it.
/// It is kept and marked rather than dropped, because a paragraph they wrote is
/// work and the box it was written in has already been emptied: `failed` is what
/// lets it be sent again with one click, and what keeps it out of the history the
/// next turn carries.
export type ChatMessage = {
  role: "user" | "model";
  text: string;
  kind?: "event" | "failed";
  attachments?: ChatAttachment[];
  /// The pages the director attached to this message (§V.5). Kept on the message
  /// rather than only in the payload for the two things the column has to do with
  /// them: say under the bubble which pages went up with those words, and send the
  /// same ones again when a failed message is retried — a turn that goes again
  /// without its attachment is a different question.
  pages?: PageChoice[];
};

export type ChatLog = {
  messages: ChatMessage[];
  /// The offers that are no longer offers, by the key their tile is drawn under.
  /// An offer stays on screen under the reply that made it, and the moment its
  /// cut is filed that tile is a decision the director has already taken — so it
  /// becomes the cut instead, and the click goes to the row rather than back to
  /// the review that would file it a second time.
  taken: Record<string, TakenCut>;
  /// The boards that are no longer there, by the key their tile is drawn under.
  /// A discard offer is the one tile whose subject can stop existing while the
  /// reply that made it is still on screen — so the tile has to stop offering
  /// (the board cannot be discarded twice) *and* stop being a click, since the
  /// tab row falls back to the first board for an id it does not hold and would
  /// open the wrong one.
  ///
  /// A picture removed from the project is the same story with a longer reach —
  /// the cuts of it go too — so it is recorded in the same map rather than a
  /// second one: the keys are namespaced by kind and cannot collide, and what
  /// the map means is "the subject of this tile is not there any more".
  discarded: Record<string, DiscardedBoard | DiscardedReference>;
  /// A turn on the wire. Here rather than on the mutation that carries it,
  /// because the mutation dies with the component and the turn does not.
  asking: boolean;
  /// Why the last turn did not arrive, if it did not. Cleared by the next ask
  /// rather than left standing under an answered question.
  error: string | null;
  /// What the director has typed and not yet sent. Here for the same reason as
  /// everything else: a half-written message is work, and the collapse arrow is
  /// two inches above the box it is written in.
  draft: string;
  /// The pages picked for the message being written, in the order they were
  /// picked. Beside the draft because it is the same half-written message, and
  /// per-message rather than sticky (§V.5): it is emptied by the send, so the
  /// next question is about a page only if the director says so again.
  attached: PageChoice[];
};

export const EMPTY_CHAT_LOG: ChatLog = {
  messages: [],
  taken: {},
  discarded: {},
  asking: false,
  error: null,
  draft: "",
  attached: [],
};

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

/// The director's message going up. The text is trimmed here rather than at the
/// composer, so what is drawn is what was sent, and the draft is emptied in the
/// same transition — the box is cleared because the message left, so the two are
/// one change rather than two.
///
/// The attached pages go with it on both counts: onto the message, which is what
/// the column draws the chips from and what a retry sends again, and off the
/// draft, because an attachment is per-message (§V.5) and a page that stayed
/// picked would ride up on the next question as well.
export function chatAsked(log: ChatLog, message: string, pages: readonly PageChoice[] = []): ChatLog {
  return {
    ...log,
    messages: [
      ...log.messages,
      { role: "user", text: message.trim(), ...(pages.length ? { pages: [...pages] } : {}) },
    ],
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
  return {
    ...log,
    messages: [
      ...log.messages,
      { role: "model", text: answer.reply, attachments: answer.attachments },
    ],
    asking: false,
  };
}

/// A turn that did not arrive. The question stays in the column: it is what the
/// director asked, and dropping it would leave an error under somebody else's
/// message. It is marked as never having been sent, which is two things at once —
/// the tile the director can send again, and a message the next turn must not
/// carry up as history, since the model was never told it.
export function chatFailed(log: ChatLog, error: string): ChatLog {
  const unsent = lastUnsent(log.messages);
  return {
    ...log,
    asking: false,
    error,
    messages:
      unsent < 0
        ? log.messages
        : log.messages.map((message, index) =>
            index === unsent ? { ...message, kind: "failed" as const } : message,
          ),
  };
}

/// The message the failure was about: the last thing the director said that the
/// assistant has not answered.
///
/// Found by walking back rather than by taking the last message, because a cut
/// taken in the properties panel lands as an event while a turn is in flight — so
/// the question that failed is not reliably the bottom of the column. A model
/// reply on the way back means the failure was not about anything that is still
/// unanswered, and nothing is marked.
function lastUnsent(messages: readonly ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "model") return -1;
    if (message.kind === "event") continue;
    return message.kind === "failed" ? -1 : index;
  }
  return -1;
}

/// Sending a failed message again. The message itself is dropped here rather than
/// left in place and re-marked: what goes up next is a new turn, and two copies of
/// one question in the column is the conversation claiming they asked twice.
export function chatRetried(log: ChatLog, index: number): ChatLog {
  if (log.messages[index]?.kind !== "failed") return log;
  return {
    ...log,
    messages: log.messages.filter((_, at) => at !== index),
    error: null,
  };
}

/// What of this conversation goes back up with the next message.
///
/// The window is `historyWindow`'s; what is decided here is *what is eligible* —
/// a message that never reached the model is not history. Carrying one would have
/// the assistant answering a question it was never asked, directly above the same
/// question being asked again.
export function chatHistory(log: ChatLog): ChatTurn[] {
  return historyWindow(log.messages.filter((message) => message.kind !== "failed"));
}

/// The other end of `crop_reference`. The tool answers with an offer and nothing
/// else — the pixels are cut in the browser — so the cut the conversation asked
/// for appears in the project minutes later, in another column. This is where it
/// comes back: the note rides up as history on the next message, which is what
/// lets the assistant swap the cut onto a board without buying a round to find
/// its id.
///
/// The board beside the cut when the cut was made for one: the swap has already
/// happened, so that tile is the arrangement as it now is — the answer to whether
/// the crop closed the gap.
export function chatCutTaken(log: ChatLog, cut: TakenCut): ChatLog {
  return {
    ...log,
    messages: [
      ...log.messages,
      {
        role: "user",
        kind: "event",
        text: takenCutNote(cut),
        attachments: [takenCutAttachment(cut), ...(cut.board ? [cut.board] : [])],
      },
    ],
    taken: { ...log.taken, [takenOfferKey(cut)]: cut },
  };
}

/// The other end of `discard_board`, and the other half of the same rule the
/// crop offer follows: the tool offers, the director acts, and the conversation
/// is told what they did rather than being left to infer it from a board that
/// has quietly stopped existing.
///
/// It rides up as their turn for the reason a taken cut does — they did it with
/// their hands, and the model has to read it as new information rather than as
/// its own claim. No attachment: the thing this message is about is the one
/// thing in the project that is not there any more.
export function chatBoardDiscarded(log: ChatLog, board: DiscardedBoard): ChatLog {
  return {
    ...log,
    messages: [...log.messages, { role: "user", kind: "event", text: discardedBoardNote(board) }],
    discarded: { ...log.discarded, [discardKey(board.boardId)]: board },
  };
}

/// The other end of `discard_reference`, on the same terms as a board's: the
/// tool offers, the director presses Remove, and the conversation is told rather
/// than left to infer it from a picture that has quietly stopped existing.
///
/// The note carries more than a board's because the loss does: the cuts made of
/// it went with it, and the boards it was holding up now have a gap. No
/// attachment — the thing this message is about is the one thing that is not
/// there any more.
export function chatReferenceDiscarded(log: ChatLog, reference: DiscardedReference): ChatLog {
  return {
    ...log,
    messages: [
      ...log.messages,
      { role: "user", kind: "event", text: discardedReferenceNote(reference) },
    ],
    discarded: { ...log.discarded, [referenceDiscardKey(reference.referenceId)]: reference },
  };
}

/// What a tile actually draws, given everything the director has settled since.
/// An offer whose cut has been filed stops being an offer and becomes the cut;
/// a board they discarded, or a picture they removed, stops being a way in at
/// all; everything else is itself.
/// Keyed on frame *and* box for a crop, so a nudged offer is deliberately still
/// an offer — the box on that tile is not the box that was filed.
export function shownAs(
  { taken, discarded }: Pick<ChatLog, "taken" | "discarded">,
  attachment: ChatAttachment,
): {
  attachment: ChatAttachment;
  filed: TakenCut | undefined;
  /// Set when this tile's subject has been thrown away — a board discarded, or a
  /// picture removed from the project. The tile stays — it is under a reply that
  /// was about it, and a decision the director took is part of the conversation —
  /// but it is no longer a way in, because there is nothing to go to.
  ///
  /// A photograph needs this as badly as a board does: `inspectReference` on an
  /// id the gallery no longer lists resolves to nothing at all, so the tile is
  /// drawn, clicked, and the panel does not move.
  gone: DiscardedBoard | DiscardedReference | undefined;
} {
  const filed = attachment.kind === "crop" ? taken[attachmentKey(attachment)] : undefined;
  const gone =
    attachment.kind === "board" || attachment.kind === "reference"
      ? discarded[attachmentKey(attachment)]
      : undefined;
  return { attachment: filed ? takenCutAttachment(filed) : attachment, filed, gone };
}
