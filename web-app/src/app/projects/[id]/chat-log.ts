"use client";

import { useSyncExternalStore } from "react";
import type { ChatAttachment } from "@/lib/agent/agent-tools";
import type { ChatTurn } from "@/lib/agent/chat-history";
import type { DiscardedBoard } from "@/lib/boards/board-discard";
import type { DiscardedReference } from "@/lib/references/reference-discard";
import {
  EMPTY_CHAT_LOG,
  chatAnswered,
  chatAsked,
  chatBoardDiscarded,
  chatCutTaken,
  chatReferenceDiscarded,
  chatFailed,
  chatHistory,
  chatRetried,
  chatTyped,
  type ChatLog,
} from "@/lib/agent/chat-log";
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
/// In memory only — see `@/lib/chat-log` for why a restored conversation would be
/// a column of expired thumbnails.
const listeners = new Set<() => void>();
const logs = new Map<string, ChatLog>();

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

export function typeDraft(projectId: string, draft: string) {
  write(projectId, chatTyped(read(projectId), draft));
}

/// A cut the director took, put into the conversation. Announced from the
/// workspace rather than from the chat, so a cut taken with the assistant
/// collapsed is still recorded — it happened in this session and the conversation
/// is the record of it.
export function recordCutTaken(projectId: string, cut: TakenCut) {
  write(projectId, chatCutTaken(read(projectId), cut));
}

/// A board the director threw away from an offer in the chat. Recorded here
/// rather than in the component for the same reason a cut is: the tile it
/// settles is drawn from the log, and what the model is told on the next message
/// is the log as well.
export function recordBoardDiscarded(projectId: string, board: DiscardedBoard) {
  write(projectId, chatBoardDiscarded(read(projectId), board));
}

/// A picture the director removed, from whichever door they removed it by.
/// Recorded here rather than in the component for the reason a discarded board
/// is: the tile it settles is drawn from the log, and what the model is told on
/// the next message is the log as well.
export function recordReferenceDiscarded(projectId: string, reference: DiscardedReference) {
  write(projectId, chatReferenceDiscarded(read(projectId), reference));
}

/// One turn, start to finish, outside React.
///
/// `ask` is the wire and `onAnswered` the cache work the answer implies — both
/// passed in, so this file never has to know about tRPC or query keys. What it
/// owns is the part that must not be cancelled: the request is already paid for
/// the moment it is sent, so a director who collapses the sidebar while the
/// assistant is thinking should come back to the answer rather than to the
/// question with nothing under it.
export async function sendTurn({
  projectId,
  message,
  retryOf,
  ask,
  onAnswered,
  onFailed,
}: {
  projectId: string;
  message: string;
  /// The failed message this send replaces, when the director asked for it to go
  /// again. Dropped before the ask is recorded, so the question appears once in
  /// the column rather than twice.
  retryOf?: number;
  ask: (input: {
    projectId: string;
    message: string;
    history: ChatTurn[];
  }) => Promise<{ reply: string; attachments: ChatAttachment[] }>;
  onAnswered?: (attachments: ChatAttachment[]) => void | Promise<void>;
  onFailed?: () => void | Promise<void>;
}) {
  const current = read(projectId);
  const log = retryOf === undefined ? current : chatRetried(current, retryOf);
  const text = message.trim();
  if (!text || log.asking) return;

  /// History is what the model already answered — the pending turn is passed
  /// separately, so it is read before the ask is recorded. Windowed here as well
  /// as on the server: the chat keeps the whole conversation on screen, but
  /// sending all of it is bytes the turn would only drop, and the two ends
  /// agreeing means what the director can see the model was told matches what it
  /// was told.
  const history = chatHistory(log);
  write(projectId, chatAsked(log, text));

  try {
    const answer = await ask({ projectId, message: text, history });
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
