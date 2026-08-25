/// Which thread is open, per project — the value half of the only other
/// `localStorage` in this app (`sidebar.ts` beside `use-sidebar-store.ts`).
///
/// **One entry for the whole app**, holding `Record<projectId, conversationId>`,
/// rather than one key per project: a key per project is an unbounded set of
/// entries nothing ever cleans up, and the read is one `getItem` either way.
///
/// It is the *window's* property and not the project's — there is no
/// `Project.activeConversationId` column, because two tabs on one project would
/// write it against each other and the loser would find its column swapped out
/// from under a half-written message (orchestrator-tool-reference §VII.2).
///
/// `localStorage` does not give that property on its own: it is shared across
/// every tab of one origin, and a `storage` event fires in the others on every
/// write. The per-window property comes from the store **never subscribing to
/// that event** and reading at mount only. §VII.2 states the reason wrongly —
/// this is the constraint that actually holds it up, and it lives in a comment
/// because nothing in the type system can.

export type OpenConversations = Readonly<Record<string, string>>;

export const NO_OPEN_CONVERSATIONS: OpenConversations = {};

/// Anything written by another build, by an older version of this one, or by
/// hand has to degrade to *no selection* rather than to an id the column would
/// then try to open. A conversation id that is not a string is not a
/// conversation id, and a project whose entry is one is a project with no
/// selection — dropped per entry, so one bad key does not cost the others.
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

/// The selection, moved. **The same object comes back when nothing changed**,
/// which is what stops `useSyncExternalStore` re-rendering the whole workspace
/// on every read — the snapshot is compared by identity.
export function withOpenConversation(
  state: OpenConversations,
  projectId: string,
  conversationId: string,
): OpenConversations {
  if (state[projectId] === conversationId) return state;
  return { ...state, [projectId]: conversationId };
}
