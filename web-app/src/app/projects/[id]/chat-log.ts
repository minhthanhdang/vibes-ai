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
/// just happened, and this holds a thing that accumulates.
///
/// Keyed by **conversation** and not by project (orchestrator-tool-reference
/// §VII.2): a project holds many threads and one is open at a time. Everything
/// the log holds that is not a stored row — the draft, the picked pages, the
/// in-flight flag, the error — goes with the key, so switching threads
/// mid-sentence costs nothing and the sentence is still there when you come
/// back. Which is the reason the draft was moved out of the component in the
/// first place, one level up.
///
/// A cache over the store, not the conversation itself: `hydrateChat` loads the
/// stored messages under the session's own, and everything said or done here is
/// written back — a turn by `orchestrator.send`, an event by `chat.record` — so
/// a reload draws the column the sessions before it built.
const listeners = new Set<() => void>();
const logs = new Map<string, ChatLog>();

/// Once per conversation per session. The list is fetched when the column first
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

function read(conversationId: string): ChatLog {
  return logs.get(conversationId) ?? EMPTY_CHAT_LOG;
}

function write(conversationId: string, next: ChatLog) {
  logs.set(conversationId, next);
  for (const listener of listeners) listener();
}

export function useChatLog(conversationId: string) {
  return useSyncExternalStore(
    subscribe,
    () => read(conversationId),
    () => EMPTY_CHAT_LOG,
  );
}

/// A thread this browser has just minted, born hydrated (§VII.3).
///
/// "New chat" writes no row: the id comes from `crypto.randomUUID()` here and
/// the first thing said creates the conversation under it. There is nothing to
/// fetch for it, and saying so is what stops a later `chat.list` — fired for a
/// thread that has since been spoken in — laying a second copy of these rows
/// under the session's own.
export function mintChat(conversationId: string) {
  hydrated.add(conversationId);
  if (!logs.has(conversationId)) write(conversationId, EMPTY_CHAT_LOG);
}

/// The stored conversation, arriving. Rows go under whatever the session has
/// already said — the fetch went out before any of it was said.
export function hydrateChat(conversationId: string, rows: readonly unknown[]) {
  if (hydrated.has(conversationId)) return;
  hydrated.add(conversationId);
  write(conversationId, chatHydrated(read(conversationId), rows));
}

/// The messages of one thread, dropped — `chat.clear` and `chat.remove`
/// (§VII.6). The draft is deliberately kept: the user asked to lose the record,
/// not the sentence they were part-way through. The hydration mark goes with the
/// messages, or the next mount of the column would put the cleared rows straight
/// back underneath.
///
/// One of three things that have to move together; the other two are the
/// `chat.list` cache entry and the server's rows, and any two of them left in
/// disagreement is a resurrection bug. `chatCacheReset` in the column is what
/// keeps them together.
export function emptyChat(conversationId: string) {
  hydrated.delete(conversationId);
  write(conversationId, { ...read(conversationId), messages: [], asking: false, error: null });
}

/// A thread that no longer exists, forgotten entirely — draft and all, because
/// there is no longer a seat to come back to.
export function forgetChat(conversationId: string) {
  hydrated.delete(conversationId);
  logs.delete(conversationId);
  for (const listener of listeners) listener();
}

export function typeDraft(conversationId: string, draft: string) {
  write(conversationId, chatTyped(read(conversationId), draft));
}

/// A page the user clicked in the picker, on or off (§V.5). Held with the
/// draft rather than in the picker, for the reason the draft itself is: the
/// column that draws both collapses, and a selection made before the arrow was
/// pressed is still the message being written.
export function pickPage(conversationId: string, choice: PageChoice) {
  write(conversationId, chatPagePicked(read(conversationId), choice));
}

/// The picker's list, landing. What it settles is the selection: a page that was
/// picked and has since been deleted from the board stops being a chip under the
/// composer rather than going up as an id the server would drop in silence.
export function listedPages(
  conversationId: string,
  board: { boardId: string; revision: number; pages: readonly { pageId: string; name: string }[] },
) {
  write(conversationId, chatPagesListed(read(conversationId), board));
}

/// The store's door for a client-originated event, passed in the way `ask` is so
/// this file never has to know about tRPC. Fire-and-forget on the caller's side:
/// the session's column already has the message, and a record that does not land
/// costs the *next* session the note, not this one.
export type RecordChatEvent = (input: ChatEvent & ChatSeat) => Promise<unknown>;

/// Which thread, in which project. Both, because the two are different
/// questions: the thread is what the store keys by and what the row is written
/// under, and the project is what the server checks the thread against — and
/// opens it under, when the thread is one the browser minted and nobody has
/// spoken in yet (§VII.3).
export type ChatSeat = { projectId: string; conversationId: string };

/// The payload and the tile go over the wire as JSON, and the records the
/// callers hand in carry `undefined` in their optional fields — which JSON has
/// no word for and a strict input schema may refuse. What is posted is what
/// would have survived storage anyway.
function asJson<T>(value: T): T | undefined {
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as T);
}

function noted(seat: ChatSeat, next: ChatLog, record?: RecordChatEvent) {
  write(seat.conversationId, next);
  const event = recordedEvent(next.messages.at(-1)!);
  if (!record || !event) return;
  void record({
    ...seat,
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
export function recordCutTaken(seat: ChatSeat, cut: TakenCut, record?: RecordChatEvent) {
  noted(seat, chatCutTaken(read(seat.conversationId), cut), record);
}

/// A board the user threw away from an offer in the chat. Recorded here
/// rather than in the component for the same reason a cut is: the tile it
/// settles is drawn from the log, and what the model is told on the next message
/// is the log as well.
export function recordBoardDiscarded(seat: ChatSeat, board: DiscardedBoard, record?: RecordChatEvent) {
  noted(seat, chatBoardDiscarded(read(seat.conversationId), board), record);
}

/// A page the user took off a board from an offer in the chat. Recorded here
/// for the reason a discarded board is, and it is the only one of the three whose
/// subject's *container* survives it: the board is still in the project and the
/// next message's brief still lists it, one page shorter.
export function recordPageDiscarded(seat: ChatSeat, page: DiscardedPage, record?: RecordChatEvent) {
  noted(seat, chatPageDiscarded(read(seat.conversationId), page), record);
}

/// A picture the user removed, from whichever door they removed it by.
/// Recorded here rather than in the component for the reason a discarded board
/// is: the tile it settles is drawn from the log, and what the model is told on
/// the next message is the log as well.
export function recordReferenceDiscarded(seat: ChatSeat, reference: DiscardedReference, record?: RecordChatEvent) {
  noted(seat, chatReferenceDiscarded(read(seat.conversationId), reference), record);
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
  conversationId,
  message,
  retryOf,
  pages,
  picture,
  ask,
  onAnswered,
  onFailed,
}: ChatSeat & {
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
    conversationId: string;
    message: string;
    pages: { boardId: string; pageId: string; revision: number; renderUri?: string }[];
  }) => Promise<{ reply: string; attachments: ChatAttachment[] }>;
  onAnswered?: (attachments: ChatAttachment[]) => void | Promise<void>;
  onFailed?: () => void | Promise<void>;
}) {
  const current = read(conversationId);
  const log = retryOf === undefined ? current : chatRetried(current, retryOf);
  const text = message.trim();
  if (!text || log.asking) return;
  /// A retry carries what the failed message carried and nothing else — the
  /// pages picked since were picked for the message being written now, and
  /// spending them on a question that was asked before they existed would change
  /// what is being sent again.
  const attached = pages ?? (retryOf === undefined ? current.attached : []);

  write(conversationId, chatAsked(log, text, attached));

  try {
    /// After the message is on screen and before the ask: drawing a page flushes
    /// the board's pending save and uploads a PNG, which is long enough that a
    /// user watching their own words wait for it would read it as the send
    /// having failed.
    const pictures = attached.length && picture ? await picture(attached) : [];
    const answer = await ask({
      projectId,
      conversationId,
      message: text,
      pages: attachedPageInput(attached, pictures),
    });
    write(conversationId, chatAnswered(read(conversationId), answer));
    await onAnswered?.(answer.attachments);
  } catch (error) {
    write(
      conversationId,
      chatFailed(
        read(conversationId),
        error instanceof Error ? error.message : "Something went wrong.",
      ),
    );
    /// A turn that broke is not a turn that did nothing. The tools write as they
    /// are called — a board filed on the round before the one that failed is a
    /// row in the database with no tile to say so — so the answer's cache work is
    /// still owed even though there is no answer.
    await onFailed?.();
  }
}
