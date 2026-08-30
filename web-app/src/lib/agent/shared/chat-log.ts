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

export type ChatLog = {
  messages: Message[];
  asking: boolean;
  error: string | null;
  draft: string;
  attached: PageChoice[];
  progress: ChatProgress | null;
};

export type ChatProgress = {
  steps: TurnStep[];
  thought: string | null;
  startedAt: string;
  said: string;
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

const pendingIn = (messages: readonly Message[]) =>
  messages.findLast((message) => message.status === "pending");

export function chatTyped(log: ChatLog, draft: string): ChatLog {
  return { ...log, draft };
}

export function chatPagePicked(log: ChatLog, choice: PageChoice): ChatLog {
  return { ...log, attached: pagesAfterPick(log.attached, choice) };
}

export function chatPagesListed(
  log: ChatLog,
  board: { boardId: string; revision: number; pages: readonly { pageId: string; name: string }[] },
): ChatLog {
  const attached = pagesStillOnBoard(log.attached, board);
  return attached.length === log.attached.length &&
    attached.every((page, index) => page === log.attached[index])
    ? log
    : { ...log, attached };
}

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
    progress: { steps: [], thought: null, startedAt: asked.at, said: "" },
  };
}

export function chatProgressed(log: ChatLog, event: TurnEvent): ChatLog {
  const progress = log.progress;
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

  if (event.kind !== "calling" && event.kind !== "called") return log;

  const steps = stepsAfter(progress.steps, event);
  const said = event.kind === "calling" ? "" : progress.said;
  if (steps === progress.steps && said === progress.said) return log;
  return { ...log, progress: { ...progress, steps: [...steps], said } };
}

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
      penned(log, {
        role: "assistant",
        turnId: asked?.turnId,
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

export function chatFailed(log: ChatLog, error: string): ChatLog {
  const asked = pendingIn(log.messages);
  return {
    ...log,
    asking: false,
    error,
    progress: null,
    messages: asked
      ? log.messages.map((message) =>
          message === asked ? { ...message, status: "failed" as const, error } : message,
        )
      : log.messages,
  };
}

export function chatRetried(log: ChatLog, id: string): ChatLog {
  const failed = log.messages.find((message) => message.id === id);
  if (failed?.status !== "failed") return log;
  return {
    ...log,
    messages: log.messages.filter((message) => message !== failed),
    error: null,
  };
}

export function chatHydrated(log: ChatLog, rows: readonly unknown[]): ChatLog {
  const stored = rows.flatMap((row) => {
    const parsed = messageSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
  return stored.length ? { ...log, messages: [...stored, ...log.messages] } : log;
}

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

export function recordedEvent(message: Message): ChatEvent | null {
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

export function chatCutTaken(log: ChatLog, cut: TakenCut): ChatLog {
  return noted(log, {
    event: "cut_taken",
    note: takenCutNote(cut),
    attachment: takenCutAttachment(cut),
  });
}

export function chatBoardDiscarded(log: ChatLog, board: DiscardedBoard): ChatLog {
  return noted(log, { event: "board_discarded", note: discardedBoardNote(board), payload: board });
}

export function chatPageDiscarded(log: ChatLog, page: DiscardedPage): ChatLog {
  return noted(log, { event: "page_discarded", note: discardedPageNote(page), payload: page });
}

export function chatReferenceDiscarded(log: ChatLog, reference: DiscardedReference): ChatLog {
  return noted(log, {
    event: "reference_discarded",
    note: discardedReferenceNote(reference),
    payload: reference,
  });
}

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

export function pagesOf(message: Message): PageChoice[] {
  return partsOfType(message.parts, "page").map(({ boardId, pageId, revision, name }) => ({
    boardId,
    pageId,
    revision,
    name,
  }));
}

export function shownAs(
  discarded: Discarded,
  attachment: ChatAttachment,
): {
  attachment: ChatAttachment;
  gone: DiscardedBoard | DiscardedReference | DiscardedPage | undefined;
} {
  const gone =
    discarded[attachmentKey(attachment)] ??
    (attachment.kind === "board" && attachment.discardPage
      ? discarded[pageDiscardKey(attachment.boardId, attachment.discardPage.pageId)]
      : undefined);
  return { attachment, gone };
}
