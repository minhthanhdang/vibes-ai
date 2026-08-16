"use client";

import { useSyncExternalStore } from "react";
import type { ChatAttachment } from "@/lib/agent-tools";
import { historyWindow, type ChatTurn } from "@/lib/chat-history";
import {
  EMPTY_CHAT_LOG,
  chatAnswered,
  chatAsked,
  chatCutTaken,
  chatFailed,
  chatTyped,
  type ChatLog,
} from "@/lib/chat-log";
import type { TakenCut } from "@/lib/cut-taken";

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
  ask,
  onAnswered,
}: {
  projectId: string;
  message: string;
  ask: (input: {
    projectId: string;
    message: string;
    history: ChatTurn[];
  }) => Promise<{ reply: string; attachments: ChatAttachment[] }>;
  onAnswered?: (attachments: ChatAttachment[]) => void | Promise<void>;
}) {
  const log = read(projectId);
  const text = message.trim();
  if (!text || log.asking) return;

  /// History is what the model already answered — the pending turn is passed
  /// separately, so it is read before the ask is recorded. Windowed here as well
  /// as on the server: the chat keeps the whole conversation on screen, but
  /// sending all of it is bytes the turn would only drop, and the two ends
  /// agreeing means what the director can see the model was told matches what it
  /// was told.
  const history = historyWindow(log.messages);
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
  }
}
