import { attachmentKey, type ChatAttachment } from "@/lib/agent/shared/attachments";
import { discardKey, discardedBoardNote, type DiscardedBoard } from "@/lib/boards/board-discard";
import {
  discardedReferenceNote,
  referenceDiscardKey,
  type DiscardedReference,
} from "@/lib/references/reference-discard";
import {
  messageSchema,
  partsOfType,
  type EVENT_KINDS,
  type Message,
  type Part,
  type TurnStep,
} from "@/lib/agent/shared/conversation";
import { stepsAfter, type TurnEvent } from "@/lib/agent/shared/turn-events";
import { discardedPageNote, pageDiscardKey, type DiscardedPage } from "@/lib/pages/page-discard";
import { pagesAfterPick, pagesStillOnBoard, type PageChoice } from "@/lib/pages/page-attach";
import { takenCutAttachment, takenCutNote, type TakenCut } from "@/lib/crop/cut-taken";

/// The conversation, as a value — and, since it is stored, as a cache. The
/// messages are the format's `Message` rows (`conversation.ts`); what is *not*
/// a row stays a value on the log.

export type ChatLog = {
  messages: Message[];
  /// A turn on the wire.
  asking: boolean;
  /// Why the last turn did not arrive, if it did not. Cleared by the next ask.
  error: string | null;
  /// What the user has typed and not yet sent.
  draft: string;
  /// The pages picked for the message being written, in the order they were
  /// picked. Per-message rather than sticky, so it is emptied by the send.
  attached: PageChoice[];
  /// What the turn on the wire is doing, live. Null between turns, so `asking`
  /// and this are never asked to disagree.
  ///
  /// Cleared by the transition that settles the turn, because a step list under
  /// an answered question is the progress of a turn that is over. Every field it
  /// holds is either recoverable from the stored parts afterwards (the steps,
  /// through `stepsOf`) or deliberately never kept at all (the thought, the
  /// agent labels, the clock) — which is why this is a value on the log and not
  /// a column in the row.
  progress: ChatProgress | null;
};

/// The turn on the wire, as it is going.
export type ChatProgress = {
  /// The steps in the order the rounds started them. Parallel calls of one round
  /// arrive together and keep the order the model made them in.
  steps: TurnStep[];
  /// The model's own last thought summary, or null before the first one.
  /// Replaced rather than accumulated: it is a label for what is happening now,
  /// not a transcript, and it is never stored.
  thought: string | null;
  /// When the question went out — the pending message's own `at`, not a second
  /// clock reading. What the ticking seconds under the label count from.
  startedAt: string;
  /// What the model is writing *now*, as the tokens arrive.
  ///
  /// Emptied by the next round's `calling`, because text on a round that turns
  /// out to call tools was narration about work that is now happening — it stays
  /// in the row as a bubble, and repeating it above the step it introduced would
  /// be the column saying it twice. Text on the round that ends the loop is the
  /// reply, and `chatAnswered` replaces the whole block with it.
  ///
  /// So nothing here is ever retracted: it is either superseded by the step it
  /// was introducing, or by the answer it was.
  said: string;
  /// Nothing has come off the stream for a long time (`TURN_STALL_AFTER`).
  ///
  /// A note and never an abort: the work is paid for the moment it is sent and
  /// the rows are written whether or not anyone is listening, so a turn this is
  /// true of is a turn that will still land. What it buys is the difference
  /// between a ticking clock under a frozen step and a sentence saying which of
  /// the two has happened.
  ///
  /// Driven from the drain rather than from a clock here: a timestamp on the
  /// progress would be a new object per event, which is the one thing this
  /// value's same-object rule exists to prevent.
  stalled?: boolean;
};

export const EMPTY_CHAT_LOG: ChatLog = {
  messages: [],
  asking: false,
  error: null,
  draft: "",
  attached: [],
  progress: null,
};

/// A message this session penned, in the row's own shape. The ids are the
/// browser's and have only to be unique in this column.
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

/// The question the live turn is about. Searched for rather than taken off the
/// end, because an event landing while a turn is in flight means the question
/// is not reliably the bottom of the column.
const pendingIn = (messages: readonly Message[]) =>
  messages.findLast((message) => message.status === "pending");

export function chatTyped(log: ChatLog, draft: string): ChatLog {
  return { ...log, draft };
}

/// A page clicked in the picker, on or off — `pagesAfterPick`'s rule, over the
/// *draft's* selection.
export function chatPagePicked(log: ChatLog, choice: PageChoice): ChatLog {
  return { ...log, attached: pagesAfterPick(log.attached, choice) };
}

/// The selection held against the board's pages as they now stand, called when
/// the picker's list lands.
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

/// The user's message going up: trimmed text, the attached pages as `page`
/// parts ahead of the words, and both the draft and the selection emptied in
/// the same transition. `pending` until the turn settles it.
export function chatAsked(log: ChatLog, message: string, pages: readonly PageChoice[] = []): ChatLog {
  const parts: Part[] = [
    ...pages.map(
      ({ boardId, pageId, revision, name }): Part => ({ type: "page", boardId, pageId, revision, name }),
    ),
    { type: "text", text: message.trim() },
  ];
  const asked = penned(log, { role: "user", parts, status: "pending" });
  return {
    ...log,
    messages: [...log.messages, asked],
    asking: true,
    error: null,
    draft: "",
    attached: [],
    /// Opened here so the column has somewhere to put the first event, and
    /// stamped with the question's own `at` rather than a second clock reading —
    /// which keeps this transition at exactly one, the one `penned` already made.
    progress: { steps: [], thought: null, startedAt: asked.at, said: "" },
  };
}

/// One event of the live turn, folded in. The only writer of `progress`, and
/// total: an event that arrives with no turn in flight, an event for a call
/// already known, a thought that repeats itself, and an event of a kind this
/// build has not met all return the same log object.
///
/// The same-object rule is `chatPagesListed`'s and for the same reason — this
/// runs tens of times per turn, and a new object each time is a re-render of the
/// column per round.
export function chatProgressed(log: ChatLog, event: TurnEvent): ChatLog {
  const progress = log.progress;
  /// No turn in flight is not an error: an event can land in the same tick the
  /// answer settled the log, and the answer wins.
  if (!progress) return log;

  if (event.kind === "thinking") {
    return event.text === progress.thought
      ? log
      : { ...log, progress: { ...progress, thought: event.text } };
  }

  if (event.kind === "delta") {
    return event.text
      ? { ...log, progress: { ...progress, said: progress.said + event.text } }
      : log;
  }

  /// `answer` and `failed` are the caller's — they settle the log rather than
  /// advance it. Anything from a newer build is nobody's, and a wire between two
  /// halves that deploy separately gets the same read-never-rejects treatment a
  /// stored row gets.
  if (event.kind !== "calling" && event.kind !== "called") return log;

  /// The fold itself is shared with the Vibes run's own live list, which keeps
  /// exactly the same steps for exactly the same reason.
  const steps = stepsAfter(progress.steps, event);
  /// A round handing over to its tools is the end of whatever it was narrating.
  const said = event.kind === "calling" ? "" : progress.said;
  if (steps === progress.steps && said === progress.said) return log;
  return { ...log, progress: { ...progress, steps: [...steps], said } };
}

/// A turn that has said nothing for a long time, and the same turn speaking
/// again. Two transitions rather than one flag written on every event, and both
/// return the same log when the answer is already the one being written.
export function chatStalled(log: ChatLog, stalled: boolean): ChatLog {
  const progress = log.progress;
  if (!progress || Boolean(progress.stalled) === stalled) return log;
  return { ...log, progress: { ...progress, stalled } };
}

export function chatAnswered(
  log: ChatLog,
  answer: { reply: string; attachments: ChatAttachment[]; parts?: Part[] },
): ChatLog {
  const asked = pendingIn(log.messages);
  const settled = log.messages.map((message) =>
    message === asked ? { ...message, status: "sent" as const } : message,
  );
  return {
    ...log,
    messages: [
      ...settled,
      /// The answer shares the question's turnId.
      penned(log, {
        role: "assistant",
        turnId: asked?.turnId,
        /// The turn's own record when the turn sent one, and the reply alone
        /// when it did not. The stored parts carry the `call` and `result` the
        /// step summary is read from, so the session that ran the turn holds the
        /// same message a reload would fetch; without them the summary would be
        /// empty until the page reloaded, which is the wrong way round. An older
        /// server, or a stream that ended early, leaves a message that says what
        /// was said and nothing about how — the column exactly as it was.
        parts: answer.parts?.length
          ? answer.parts
          : [
              { type: "text", text: answer.reply },
              ...answer.attachments.map((attachment): Part => ({ type: "attachment", attachment })),
            ],
      }),
    ],
    asking: false,
    progress: null,
  };
}

/// A turn that did not arrive. The question stays in the column, marked as
/// never having been sent — which is both the tile the user can send again and
/// a message the next turn must not carry up as history.
export function chatFailed(log: ChatLog, error: string): ChatLog {
  const asked = pendingIn(log.messages);
  return {
    ...log,
    asking: false,
    error,
    /// A turn that broke has its steps in no row, so there is nothing to expand
    /// to — leaving the block up would offer a record that will not survive the
    /// reload.
    progress: null,
    messages: asked
      ? log.messages.map((message) =>
          message === asked ? { ...message, status: "failed" as const, error } : message,
        )
      : log.messages,
  };
}

/// Sending a failed message again — the message itself is dropped, by id rather
/// than by index.
export function chatRetried(log: ChatLog, id: string): ChatLog {
  const failed = log.messages.find((message) => message.id === id);
  if (failed?.status !== "failed") return log;
  return {
    ...log,
    messages: log.messages.filter((message) => message !== failed),
    error: null,
  };
}

/// The stored conversation, loaded in front of whatever this session has
/// already said. Parsed by `messageSchema`, whose rule is that a stored row is
/// never rejected on read.
export function chatHydrated(log: ChatLog, rows: readonly unknown[]): ChatLog {
  const stored = rows.flatMap((row) => {
    const parsed = messageSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
  return stored.length ? { ...log, messages: [...stored, ...log.messages] } : log;
}

/// An event, as one message carries it — one shape for the transitions below
/// and for `chat.record`.
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

/// The event a message carries, read back off it. By schema rather than by tag,
/// because `Message["parts"]` admits parts this build does not know.
export function recordedEvent(message: Message): ChatEvent | null {
  /// The last of each, as the walk that read them one part at a time did: a
  /// message carries one event, and the tile under it is the one beside it.
  const event = partsOfType(message.parts, "event").at(-1);
  const attachment = partsOfType(message.parts, "attachment").at(-1)?.attachment;
  if (!event) return null;
  return {
    event: event.event,
    note: event.note,
    payload: event.payload,
    ...(attachment ? { attachment } : {}),
  };
}

/// The other end of the properties panel's crop. No payload — the cut is a row
/// the project holds.
export function chatCutTaken(log: ChatLog, cut: TakenCut): ChatLog {
  return noted(log, {
    event: "cut_taken",
    note: takenCutNote(cut),
    attachment: takenCutAttachment(cut),
  });
}

/// The other end of `discard_board`. No attachment, and the record itself is
/// the payload — which is what lets `discardedIn` rebuild the settled tiles
/// from the stored conversation.
export function chatBoardDiscarded(log: ChatLog, board: DiscardedBoard): ChatLog {
  return noted(log, { event: "board_discarded", note: discardedBoardNote(board), payload: board });
}

/// The other end of `discard_page`, on the same terms as a board's, except that
/// the note has to say the *board* id is still good.
export function chatPageDiscarded(log: ChatLog, page: DiscardedPage): ChatLog {
  return noted(log, { event: "page_discarded", note: discardedPageNote(page), payload: page });
}

/// The other end of `discard_reference`, on the same terms. The note carries
/// more than a board's because the loss does.
export function chatReferenceDiscarded(log: ChatLog, reference: DiscardedReference): ChatLog {
  return noted(log, {
    event: "reference_discarded",
    note: discardedReferenceNote(reference),
    payload: reference,
  });
}

/// The subjects the user has thrown away, by the key their tile is drawn under.
/// A fold over the event parts rather than a map the log carries, and a payload
/// a newer build shaped differently folds to nothing.
export type Discarded = Record<string, DiscardedBoard | DiscardedReference | DiscardedPage>;

export function discardedIn(messages: readonly Message[]): Discarded {
  const gone: Discarded = {};
  for (const message of messages) {
    for (const { event, payload } of partsOfType(message.parts, "event")) {
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

/// The subjects a conversation's tiles name. Over rows rather than parsed
/// messages, because the caller holding them (`chat.list`) has rows on their
/// way to the wire.
export function subjectsIn(rows: readonly { parts?: unknown }[]): {
  boardIds: string[];
  referenceIds: string[];
} {
  const boards = new Set<string>();
  const references = new Set<string>();
  for (const row of rows) {
    if (!Array.isArray(row.parts)) continue;
    for (const { attachment } of partsOfType(row.parts, "attachment")) {
      if (attachment.kind === "board") boards.add(attachment.boardId);
      else references.add(attachment.referenceId);
    }
  }
  return { boardIds: [...boards], referenceIds: [...references] };
}

/// The gone-ness the fold cannot see — what was deleted by a door the
/// conversation never heard about. The records are synthesized off the
/// attachments, because after the delete the snapshot in the chat is the only
/// place the title survives.
export type GoneSubjects = { boardIds: readonly string[]; referenceIds: readonly string[] };

export function goneAtLoad(messages: readonly Message[], gone: GoneSubjects | undefined): Discarded {
  if (!gone || (!gone.boardIds.length && !gone.referenceIds.length)) return {};
  const boards = new Set(gone.boardIds);
  const references = new Set(gone.referenceIds);
  const dead: Discarded = {};
  for (const message of messages) {
    for (const { attachment } of partsOfType(message.parts, "attachment")) {
      if (attachment.kind === "board" && boards.has(attachment.boardId)) {
        dead[discardKey(attachment.boardId)] = {
          boardId: attachment.boardId,
          title: attachment.title,
        };
      } else if (attachment.kind === "reference" && references.has(attachment.referenceId)) {
        dead[referenceDiscardKey(attachment.referenceId)] = {
          referenceId: attachment.referenceId,
          title: attachment.title,
          frameId: attachment.frameId,
          origin: attachment.origin ?? null,
        };
      }
    }
  }
  return dead;
}

/// The pages a message carried, back in the picker's shape — what a retry
/// sends.
export function pagesOf(message: Message): PageChoice[] {
  return partsOfType(message.parts, "page").map(({ boardId, pageId, revision, name }) => ({
    boardId,
    pageId,
    revision,
    name,
  }));
}

/// What a tile actually draws, given everything the user has settled since.
export function shownAs(
  discarded: Discarded,
  attachment: ChatAttachment,
): {
  attachment: ChatAttachment;
  /// Set when this tile's subject has been thrown away. The tile stays but is
  /// no longer a way in.
  gone: DiscardedBoard | DiscardedReference | DiscardedPage | undefined;
} {
  /// The board's own key first: a board thrown away takes its pages with it.
  const gone =
    discarded[attachmentKey(attachment)] ??
    (attachment.kind === "board" && attachment.discardPage
      ? discarded[pageDiscardKey(attachment.boardId, attachment.discardPage.pageId)]
      : undefined);
  return { attachment, gone };
}
