"use client";

import { create } from "zustand";
import type { ChatAttachment } from "@/lib/agent/shared/attachments";
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
  chatProgressed,
  chatReferenceDiscarded,
  chatStalled,
  chatFailed,
  chatRetried,
  chatTyped,
  recordedEvent,
  type ChatLog,
} from "@/lib/agent/shared/chat-log";
import type { Part } from "@/lib/agent/shared/conversation";
import type { AgentEvent, TurnEvent } from "@/lib/agent/shared/turn-events";
import { attachedPageInput, type PageChoice } from "@/lib/pages/page-attach";
import type { PagePicture } from "@/lib/pages/page-picture";
import type { TakenCut } from "@/lib/crop/cut-taken";
import type { ChatSeat, RecordChatEvent } from "../types";

type ChatLogState = { logs: Readonly<Record<string, ChatLog>> };

export const useChatLogStore = create<ChatLogState>()(() => ({ logs: {} }));

const hydrated = new Set<string>();

function read(conversationId: string): ChatLog {
  return useChatLogStore.getState().logs[conversationId] ?? EMPTY_CHAT_LOG;
}

function write(conversationId: string, next: ChatLog) {
  useChatLogStore.setState((state) => ({ logs: { ...state.logs, [conversationId]: next } }));
}

export function useChatLog(conversationId: string) {
  return useChatLogStore((state) => state.logs[conversationId] ?? EMPTY_CHAT_LOG);
}

export function mintChat(conversationId: string) {
  hydrated.add(conversationId);
  if (!(conversationId in useChatLogStore.getState().logs)) write(conversationId, EMPTY_CHAT_LOG);
}

export function hydrateChat(conversationId: string, rows: readonly unknown[]) {
  if (hydrated.has(conversationId)) return;
  hydrated.add(conversationId);
  write(conversationId, chatHydrated(read(conversationId), rows));
}

export function emptyChat(conversationId: string) {
  hydrated.delete(conversationId);
  write(conversationId, {
    ...read(conversationId),
    messages: [],
    asking: false,
    error: null,
    progress: null,
  });
}

export function forgetChat(conversationId: string) {
  hydrated.delete(conversationId);
  useChatLogStore.setState((state) => {
    if (!(conversationId in state.logs)) return state;
    const logs = { ...state.logs };
    delete logs[conversationId];
    return { logs };
  });
}

export function typeDraft(conversationId: string, draft: string) {
  write(conversationId, chatTyped(read(conversationId), draft));
}

export function pickPage(conversationId: string, choice: PageChoice) {
  write(conversationId, chatPagePicked(read(conversationId), choice));
}

export function listedPages(
  conversationId: string,
  board: { boardId: string; revision: number; pages: readonly { pageId: string; name: string }[] },
) {
  write(conversationId, chatPagesListed(read(conversationId), board));
}

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
  });
}

export function recordCutTaken(seat: ChatSeat, cut: TakenCut, record?: RecordChatEvent) {
  noted(seat, chatCutTaken(read(seat.conversationId), cut), record);
}

export function recordBoardDiscarded(seat: ChatSeat, board: DiscardedBoard, record?: RecordChatEvent) {
  noted(seat, chatBoardDiscarded(read(seat.conversationId), board), record);
}

export function recordPageDiscarded(seat: ChatSeat, page: DiscardedPage, record?: RecordChatEvent) {
  noted(seat, chatPageDiscarded(read(seat.conversationId), page), record);
}

export function recordReferenceDiscarded(seat: ChatSeat, reference: DiscardedReference, record?: RecordChatEvent) {
  noted(seat, chatReferenceDiscarded(read(seat.conversationId), reference), record);
}

const TURN_STALL_AFTER = 120_000;

export async function sendTurn({
  projectId,
  conversationId,
  message,
  retryOf,
  pages,
  currentBoardId,
  picture,
  ask,
  onAnswered,
  onFailed,
  onEvent,
}: ChatSeat & {
  message: string;
  retryOf?: string;
  pages?: readonly PageChoice[];
  currentBoardId?: string;
  picture?: (pages: readonly PageChoice[]) => Promise<PagePicture[]>;
  ask: (input: {
    projectId: string;
    conversationId: string;
    message: string;
    pages: { boardId: string; pageId: string; revision: number; renderUri?: string }[];
    currentBoardId?: string;
  }) => Promise<AsyncIterable<TurnEvent>>;
  onAnswered?: (attachments: ChatAttachment[]) => void | Promise<void>;
  onFailed?: () => void | Promise<void>;
  onEvent?: (event: AgentEvent) => void;
}) {
  const current = read(conversationId);
  const log = retryOf === undefined ? current : chatRetried(current, retryOf);
  const text = message.trim();
  if (!text || log.asking) return;
  const attached = pages ?? (retryOf === undefined ? current.attached : []);

  write(conversationId, chatAsked(log, text, attached));

  let quiet: ReturnType<typeof setTimeout> | null = null;
  const heard = () => {
    if (quiet) clearTimeout(quiet);
    const current = read(conversationId);
    const spoke = chatStalled(current, false);
    if (spoke !== current) write(conversationId, spoke);
    quiet = setTimeout(() => {
      write(conversationId, chatStalled(read(conversationId), true));
    }, TURN_STALL_AFTER);
  };
  const stopListening = () => {
    if (quiet) clearTimeout(quiet);
    quiet = null;
  };

  try {
    const pictures = attached.length && picture ? await picture(attached) : [];
    heard();
    const events = await ask({
      projectId,
      conversationId,
      message: text,
      pages: attachedPageInput(attached, pictures),
      currentBoardId,
    });

    let answer: { reply: string; attachments: ChatAttachment[]; parts?: Part[] } | null = null;
    let failure: string | null = null;

    for await (const event of events) {
      heard();
      if (event.kind === "answer") {
        answer = event;
        write(conversationId, chatAnswered(read(conversationId), event));
        break;
      }
      if (event.kind === "failed") {
        failure ??= event.error;
        continue;
      }
      write(conversationId, chatProgressed(read(conversationId), event));
      try {
        onEvent?.(event);
      } catch {
      }
    }

    if (failure) throw new Error(failure);
    if (!answer) throw new Error("The turn ended without an answer.");
    stopListening();
    await onAnswered?.(answer.attachments);
  } catch (error) {
    stopListening();
    write(
      conversationId,
      chatFailed(
        read(conversationId),
        error instanceof Error ? error.message : "Something went wrong.",
      ),
    );
    await onFailed?.();
  }
}
