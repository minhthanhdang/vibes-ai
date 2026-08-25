import type { ChatEvent } from "@/lib/agent/shared/chat-log";

/// One thread, as the switcher lists it.
export type ConversationRow = { id: string; title: string; updatedAt: Date };

/// Which thread, in which project. Both, because the two are different
/// questions: the thread is what the store keys by and what the row is written
/// under, and the project is what the server checks the thread against — and
/// opens it under, when the thread is one the browser minted and nobody has
/// spoken in yet (§VII.3).
export type ChatSeat = { projectId: string; conversationId: string };

/// The store's door for a client-originated event, passed in the way `ask` is so
/// the log never has to know about tRPC. Fire-and-forget on the caller's side:
/// the session's column already has the message, and a record that does not land
/// costs the *next* session the note, not this one.
export type RecordChatEvent = (input: ChatEvent & ChatSeat) => Promise<unknown>;
