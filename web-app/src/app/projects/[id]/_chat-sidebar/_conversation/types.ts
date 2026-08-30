import type { ChatEvent } from "@/lib/agent/shared/chat-log";

export type ConversationRow = { id: string; title: string; updatedAt: Date };

export type ChatSeat = { projectId: string; conversationId: string };

export type RecordChatEvent = (input: ChatEvent & ChatSeat) => Promise<unknown>;
