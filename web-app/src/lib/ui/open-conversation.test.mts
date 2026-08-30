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
  assert.equal(openConversationFor(state, "project-3"), null);
});

test("a blob that is not JSON parses as no selection rather than crashing hydration", () => {
  assert.deepEqual(parseOpenConversations("{not json"), NO_OPEN_CONVERSATIONS);
  assert.deepEqual(parseOpenConversations(null), NO_OPEN_CONVERSATIONS);
  assert.deepEqual(parseOpenConversations(""), NO_OPEN_CONVERSATIONS);
  assert.deepEqual(parseOpenConversations('["thread-a"]'), NO_OPEN_CONVERSATIONS);
  assert.deepEqual(parseOpenConversations('"thread-a"'), NO_OPEN_CONVERSATIONS);
});

test("a stored entry that is not a string is dropped rather than opened as an id", () => {
  const parsed = parseOpenConversations(
    '{"project-1": 7, "project-2": "thread-b", "project-3": null, "project-4": ""}',
  );
  assert.deepEqual(parsed, { "project-2": "thread-b" });
});

test("choosing what is already chosen returns the same object", () => {
  const state = withOpenConversation(NO_OPEN_CONVERSATIONS, "project-1", "thread-a");
  assert.equal(withOpenConversation(state, "project-1", "thread-a"), state);
  assert.notEqual(withOpenConversation(state, "project-1", "thread-b"), state);
});
