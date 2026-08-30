export type OpenConversations = Readonly<Record<string, string>>;

export const NO_OPEN_CONVERSATIONS: OpenConversations = {};

export function parseOpenConversations(raw: string | null): OpenConversations {
  if (!raw) return NO_OPEN_CONVERSATIONS;

  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return NO_OPEN_CONVERSATIONS;
  }
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    return NO_OPEN_CONVERSATIONS;
  }

  const kept: Record<string, string> = {};
  for (const [projectId, conversationId] of Object.entries(stored)) {
    if (typeof conversationId === "string" && conversationId) kept[projectId] = conversationId;
  }
  return kept;
}

export function serializeOpenConversations(state: OpenConversations) {
  return JSON.stringify(state);
}

export function openConversationFor(state: OpenConversations, projectId: string): string | null {
  return state[projectId] ?? null;
}

export function withOpenConversation(
  state: OpenConversations,
  projectId: string,
  conversationId: string,
): OpenConversations {
  if (state[projectId] === conversationId) return state;
  return { ...state, [projectId]: conversationId };
}
