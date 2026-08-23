import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NO_OPEN_CONVERSATIONS,
  openConversationFor,
  parseOpenConversations,
  serializeOpenConversations,
  withOpenConversation,
} from "@/lib/ui/open-conversation";

test("the open thread is remembered across a reload", () => {
  const written = serializeOpenConversations(
    withOpenConversation(NO_OPEN_CONVERSATIONS, "project-1", "thread-a"),
  );
  assert.equal(openConversationFor(parseOpenConversations(written), "project-1"), "thread-a");
});

test("it is remembered per project, so opening a second does not move the first", () => {
  let state = withOpenConversation(NO_OPEN_CONVERSATIONS, "project-1", "thread-a");
  state = withOpenConversation(state, "project-2", "thread-b");

  assert.equal(openConversationFor(state, "project-1"), "thread-a");
  assert.equal(openConversationFor(state, "project-2"), "thread-b");
  /// And a project nobody has chosen in has no selection rather than someone
  /// else's.
  assert.equal(openConversationFor(state, "project-3"), null);
});

test("a blob that is not JSON parses as no selection rather than crashing hydration", () => {
  /// This runs inside `useSyncExternalStore`'s snapshot read, on the first
  /// client render. A throw here is a blank workspace, not a blank sidebar.
  assert.deepEqual(parseOpenConversations("{not json"), NO_OPEN_CONVERSATIONS);
  assert.deepEqual(parseOpenConversations(null), NO_OPEN_CONVERSATIONS);
  assert.deepEqual(parseOpenConversations(""), NO_OPEN_CONVERSATIONS);
  /// JSON that is not a record of projects either — an array and a bare string
  /// are both valid JSON and neither is a selection.
  assert.deepEqual(parseOpenConversations('["thread-a"]'), NO_OPEN_CONVERSATIONS);
  assert.deepEqual(parseOpenConversations('"thread-a"'), NO_OPEN_CONVERSATIONS);
});

test("a stored entry that is not a string is dropped rather than opened as an id", () => {
  const parsed = parseOpenConversations(
    '{"project-1": 7, "project-2": "thread-b", "project-3": null, "project-4": ""}',
  );
  /// One bad entry costs its own project a selection and none of the others
  /// theirs.
  assert.deepEqual(parsed, { "project-2": "thread-b" });
});

test("choosing what is already chosen returns the same object", () => {
  /// Identity, not equality: this is the snapshot `useSyncExternalStore`
  /// compares, and a fresh object every read is a re-render of the workspace
  /// per read.
  const state = withOpenConversation(NO_OPEN_CONVERSATIONS, "project-1", "thread-a");
  assert.equal(withOpenConversation(state, "project-1", "thread-a"), state);
  assert.notEqual(withOpenConversation(state, "project-1", "thread-b"), state);
});
