import { attachmentKey, type ChatAttachment } from "./agent-tools";
import { takenCutAttachment, takenCutNote, takenOfferKey, type TakenCut } from "./cut-taken";

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
export type ChatMessage = {
  role: "user" | "model";
  text: string;
  kind?: "event";
  attachments?: ChatAttachment[];
};

export type ChatLog = {
  messages: ChatMessage[];
  /// The offers that are no longer offers, by the key their tile is drawn under.
  /// An offer stays on screen under the reply that made it, and the moment its
  /// cut is filed that tile is a decision the director has already taken — so it
  /// becomes the cut instead, and the click goes to the row rather than back to
  /// the review that would file it a second time.
  taken: Record<string, TakenCut>;
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
};

export const EMPTY_CHAT_LOG: ChatLog = {
  messages: [],
  taken: {},
  asking: false,
  error: null,
  draft: "",
};

export function chatTyped(log: ChatLog, draft: string): ChatLog {
  return { ...log, draft };
}

/// The director's message going up. The text is trimmed here rather than at the
/// composer, so what is drawn is what was sent, and the draft is emptied in the
/// same transition — the box is cleared because the message left, so the two are
/// one change rather than two.
export function chatAsked(log: ChatLog, message: string): ChatLog {
  return {
    ...log,
    messages: [...log.messages, { role: "user", text: message.trim() }],
    asking: true,
    error: null,
    draft: "",
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
/// message.
export function chatFailed(log: ChatLog, error: string): ChatLog {
  return { ...log, asking: false, error };
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

/// What a tile actually draws, given everything the director has settled since.
/// An offer whose cut has been filed stops being an offer and becomes the cut;
/// everything else is itself. Keyed on frame *and* box, so a nudged offer is
/// deliberately still an offer — the box on that tile is not the box that was
/// filed.
export function shownAs(
  taken: ChatLog["taken"],
  attachment: ChatAttachment,
): { attachment: ChatAttachment; filed: TakenCut | undefined } {
  const filed = attachment.kind === "crop" ? taken[attachmentKey(attachment)] : undefined;
  return { attachment: filed ? takenCutAttachment(filed) : attachment, filed };
}
