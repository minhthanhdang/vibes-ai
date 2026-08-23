import { test } from "node:test";
import assert from "node:assert/strict";

import { TEST, filesNaming, sourceFiles } from "@/server/google/source-tree";

/// Who may write a message, and who may move a thread up the switcher — held
/// over the source, because neither is a rule the type system can state.
///
/// `Conversation.updatedAt` is what orders the switcher and it is written by
/// hand rather than by `@updatedAt` (orchestrator-tool-reference §VII.1): the
/// marker fires when the *conversation* row is written and a turn writes
/// `ChatMessage` rows. That makes it a fact with as many owners as there are
/// writers of a message — four, today — and four owners of one ordering is how a
/// switcher starts disagreeing with itself. So: every door that writes a message
/// is named here, and `touchConversation` is the only thing that writes the
/// column.

/// The doors onto `ChatMessage`, named rather than counted: a walk that silently
/// resolved to nothing would satisfy the rules below forever.
const DOORS = [
  /// The user's own message and the assistant's answer, one pair per turn.
  "src/server/api/routers/orchestrator.ts",
  /// Something the user did with their hands that the conversation has to hear
  /// about without a turn being asked (§VII.3).
  "src/server/api/routers/chat.ts",
  /// "Let's Vibes" — the ask, once, and one answer per page. Two writes in one
  /// file because they are one account written by two mutations
  /// (`compositor-v2.md` §IX.2).
  "src/server/api/routers/vibes.ts",
];

/// Which doors mean *spoken in*. `vibes.designPage` is deliberately not one of
/// them: a run answering its own six pages over twenty minutes is not the user
/// speaking again, and `vibes.start` stamps the thread with the moment the form
/// was submitted when it opens it (§VII.1).
const MAY_TOUCH = [
  /// The helper itself.
  "src/server/chat/conversations.ts",
  "src/server/api/routers/chat.ts",
  "src/server/api/routers/orchestrator.ts",
];

/// And who may write a `Conversation` row at all. The touch, plus whatever
/// renames one — nothing else has any business in that table.
const MAY_UPDATE = ["src/server/chat/conversations.ts"];

const SELF = "src/server/chat/conversation-doors.test.mts";

async function appSources() {
  const walked = await sourceFiles("src", "scripts");
  return walked.filter((path) => !TEST.test(path) && path !== SELF);
}

test("the doors onto the message table are the ones these rules are about", async () => {
  const writers = await filesNaming(/chatMessage\.create(Many)?\(/, await appSources());
  assert.deepEqual(writers, [...DOORS].sort());
});

test("a thread is moved up the switcher only by a door that means spoken-in", async () => {
  assert.deepEqual(await filesNaming("touchConversation(", await appSources()), [...MAY_TOUCH].sort());
});

test("nothing else writes a conversation row", async () => {
  assert.deepEqual(
    await filesNaming(/\bconversation\.update\(/, await appSources()),
    [...MAY_UPDATE].sort(),
  );
});
