"use client";

import { useSyncExternalStore } from "react";
import type { ChatAttachment } from "@/lib/agent/agent-tools";
import type { DiscardedBoard } from "@/lib/boards/board-discard";
import type { DiscardedPage } from "@/lib/pages/page-discard";
import type { DiscardedReference } from "@/lib/references/reference-discard";
import {
  EMPTY_CHAT_LOG,
  chatAnswered,
  chatAsked,
  chatBoardDiscarded,
  chatCutTaken,
  chatHydrated,
  chatPageDiscarded,
  chatPagePicked,
  chatPagesListed,
  chatReferenceDiscarded,
  chatFailed,
  chatRetried,
  chatTyped,
  recordedEvent,
  type ChatEvent,
  type ChatLog,
} from "@/lib/agent/chat-log";
import { attachedPageInput, type PageChoice } from "@/lib/pages/page-attach";
import type { PagePicture } from "@/lib/pages/page-picture";
import type { TakenCut } from "@/lib/crop/cut-taken";

/// Where the conversation lives, which is not in the column that draws it.
///
/// The fifth cross-column module in this directory and the first that is neither
/// a selection nor an event: `reference-inspection`, `board-selection` and
/// `version-focus` each say what is being pointed at now, `cut-taken` says what
/// just happened, and this holds a thing that accumulates. Keyed by project
/// because two projects are two conversations, and the assistant is a per-project
/// seat.
///
/// A cache over the store, not the conversation itself: `hydrateChat` loads the
/// stored messages under the session's own, and everything said or done here is
/// written back — a turn by `orchestrator.send`, an event by `chat.record` — so
/// a reload draws the column the sessions before it built.
const listeners = new Set<() => void>();
const logs = new Map<string, ChatLog>();

/// Once per project per session. The list is fetched when the column first
/// mounts, and the column mounts again every time the sidebar reopens —
/// hydrating on each of those would put the fetch-time snapshot back under
/// messages the session has since replaced with its own copies.
const hydrated = new Set<string>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read(projectId: string): ChatLog {
  return logs.get(projectId) ?? EMPTY_CHAT_LOG;
}

function write(projectId: string, next: ChatLog) {
  logs.set(projectId, next);
  for (const listener of listeners) listener();
}

export function useChatLog(projectId: string) {
  return useSyncExternalStore(
    subscribe,
    () => read(projectId),
    () => EMPTY_CHAT_LOG,
  );
}

/// The stored conversation, arriving. Rows go under whatever the session has
/// already said — the fetch went out before any of it was said.
export function hydrateChat(projectId: string, rows: readonly unknown[]) {
  if (hydrated.has(projectId)) return;
  hydrated.add(projectId);
  write(projectId, chatHydrated(read(projectId), rows));
}

export function typeDraft(projectId: string, draft: string) {
  write(projectId, chatTyped(read(projectId), draft));
}

/// A page the user clicked in the picker, on or off (§V.5). Held with the
/// draft rather than in the picker, for the reason the draft itself is: the
/// column that draws both collapses, and a selection made before the arrow was
/// pressed is still the message being written.
export function pickPage(projectId: string, choice: PageChoice) {
  write(projectId, chatPagePicked(read(projectId), choice));
}

/// The picker's list, landing. What it settles is the selection: a page that was
/// picked and has since been deleted from the board stops being a chip under the
/// composer rather than going up as an id the server would drop in silence.
export function listedPages(
  projectId: string,
  board: { boardId: string; revision: number; pages: readonly { pageId: string; name: string }[] },
) {
  write(projectId, chatPagesListed(read(projectId), board));
}

/// The store's door for a client-originated event, passed in the way `ask` is so
/// this file never has to know about tRPC. Fire-and-forget on the caller's side:
/// the session's column already has the message, and a record that does not land
/// costs the *next* session the note, not this one.
export type RecordChatEvent = (input: ChatEvent & { projectId: string }) => Promise<unknown>;

/// The payload and the tile go over the wire as JSON, and the records the
/// callers hand in carry `undefined` in their optional fields — which JSON has
/// no word for and a strict input schema may refuse. What is posted is what
/// would have survived storage anyway.
function asJson<T>(value: T): T | undefined {
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as T);
}

function noted(projectId: string, next: ChatLog, record?: RecordChatEvent) {
  write(projectId, next);
  const event = recordedEvent(next.messages.at(-1)!);
  if (!record || !event) return;
  void record({
    projectId,
    event: event.event,
    note: event.note,
    payload: asJson(event.payload),
    attachment: asJson(event.attachment),
  }).catch(() => {
    /// The next load is one event short; the session's own column is not.
  });
}

/// A cut the user took, put into the conversation. Announced from the
/// workspace rather than from the chat, so a cut taken with the assistant
/// collapsed is still recorded — it happened in this session and the conversation
/// is the record of it.
export function recordCutTaken(projectId: string, cut: TakenCut, record?: RecordChatEvent) {
  noted(projectId, chatCutTaken(read(projectId), cut), record);
}

/// A board the user threw away from an offer in the chat. Recorded here
/// rather than in the component for the same reason a cut is: the tile it
/// settles is drawn from the log, and what the model is told on the next message
/// is the log as well.
export function recordBoardDiscarded(
  projectId: string,
  board: DiscardedBoard,
  record?: RecordChatEvent,
) {
  noted(projectId, chatBoardDiscarded(read(projectId), board), record);
}

/// A page the user took off a board from an offer in the chat. Recorded here
/// for the reason a discarded board is, and it is the only one of the three whose
/// subject's *container* survives it: the board is still in the project and the
/// next message's brief still lists it, one page shorter.
export function recordPageDiscarded(
  projectId: string,
  page: DiscardedPage,
  record?: RecordChatEvent,
) {
  noted(projectId, chatPageDiscarded(read(projectId), page), record);
}

/// A picture the user removed, from whichever door they removed it by.
/// Recorded here rather than in the component for the reason a discarded board
/// is: the tile it settles is drawn from the log, and what the model is told on
/// the next message is the log as well.
export function recordReferenceDiscarded(
  projectId: string,
  reference: DiscardedReference,
  record?: RecordChatEvent,
) {
  noted(projectId, chatReferenceDiscarded(read(projectId), reference), record);
}

/// One turn, start to finish, outside React.
///
/// `ask` is the wire and `onAnswered` the cache work the answer implies — both
/// passed in, so this file never has to know about tRPC or query keys. What it
/// owns is the part that must not be cancelled: the request is already paid for
/// the moment it is sent, so a user who collapses the sidebar while the
/// assistant is thinking should come back to the answer rather than to the
/// question with nothing under it.
export async function sendTurn({
  projectId,
  message,
  retryOf,
  pages,
  picture,
  ask,
  onAnswered,
  onFailed,
}: {
  projectId: string;
  message: string;
  /// The failed message this send replaces, when the user asked for it to go
  /// again. Dropped before the ask is recorded, so the question appears once in
  /// the column rather than twice.
  retryOf?: string;
  /// The pages this message carries (§V.5). Passed in rather than read off the
  /// log, because a retry sends the ones that were on the failed message rather
  /// than whatever is picked now — the question going again is the question that
  /// was asked.
  pages?: readonly PageChoice[];
  /// Draws the attached pages, for the tab that has one of their boards open
  /// (§V.5.1). Passed in rather than called from here for the reason `ask` is:
  /// this file knows what a turn is and nothing about canvases. A send with
  /// nothing attached never asks, so a project whose user never attaches a
  /// page pays nothing for this.
  picture?: (pages: readonly PageChoice[]) => Promise<PagePicture[]>;
  ask: (input: {
    projectId: string;
    message: string;
    pages: { boardId: string; pageId: string; revision: number; renderUri?: string }[];
  }) => Promise<{ reply: string; attachments: ChatAttachment[] }>;
  onAnswered?: (attachments: ChatAttachment[]) => void | Promise<void>;
  onFailed?: () => void | Promise<void>;
}) {
  const current = read(projectId);
  const log = retryOf === undefined ? current : chatRetried(current, retryOf);
  const text = message.trim();
  if (!text || log.asking) return;
  /// A retry carries what the failed message carried and nothing else — the
  /// pages picked since were picked for the message being written now, and
  /// spending them on a question that was asked before they existed would change
  /// what is being sent again.
  const attached = pages ?? (retryOf === undefined ? current.attached : []);

  write(projectId, chatAsked(log, text, attached));

  try {
    /// After the message is on screen and before the ask: drawing a page flushes
    /// the board's pending save and uploads a PNG, which is long enough that a
    /// user watching their own words wait for it would read it as the send
    /// having failed.
    const pictures = attached.length && picture ? await picture(attached) : [];
    const answer = await ask({
      projectId,
      message: text,
      pages: attachedPageInput(attached, pictures),
    });
    write(projectId, chatAnswered(read(projectId), answer));
    await onAnswered?.(answer.attachments);
  } catch (error) {
    write(
      projectId,
      chatFailed(read(projectId), error instanceof Error ? error.message : "Something went wrong."),
    );
    /// A turn that broke is not a turn that did nothing. The tools write as they
    /// are called — a board filed on the round before the one that failed is a
    /// row in the database with no tile to say so — so the answer's cache work is
    /// still owed even though there is no answer.
    await onFailed?.();
  }
}
