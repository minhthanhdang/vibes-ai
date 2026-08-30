import { test } from "node:test";
import assert from "node:assert/strict";

import { TEST, filesNaming, sourceFiles } from "@/server/google/source-tree";

const DOORS = [
  "src/server/api/routers/orchestrator.ts",
  "src/server/api/routers/chat.ts",
];

const MAY_TOUCH = [
  "src/server/chat/conversations.ts",
  "src/server/api/routers/chat.ts",
  "src/server/api/routers/orchestrator.ts",
];

const MAY_UPDATE = ["src/server/chat/conversations.ts", "src/server/api/routers/chat.ts"];

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

test("the two doors that lose a record are the two the confirms are attached to", async () => {
  const deleters = await filesNaming(/chatMessage\.delete(Many)?\(/, await appSources());
  assert.deepEqual(deleters, ["src/server/api/routers/chat.ts"]);
  const removers = await filesNaming(/\bconversation\.delete\(/, await appSources());
  assert.deepEqual(removers, ["src/server/api/routers/chat.ts"]);
});

test("nothing else writes a conversation row", async () => {
  assert.deepEqual(
    await filesNaming(/\bconversation\.update\(/, await appSources()),
    [...MAY_UPDATE].sort(),
  );
});
