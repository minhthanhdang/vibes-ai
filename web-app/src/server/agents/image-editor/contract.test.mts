import { test } from "node:test";
import assert from "node:assert/strict";

import { EDITOR_PICTURE_LIMIT, EDITOR_ROUND_LIMIT } from "./loop";
import { editorDeclarations } from "@/lib/agent/image-editor/edit-tools";
import { EDIT_OP_ORDER } from "@/lib/edit/edit-ops";
import { TEST, filesNaming, sourceFiles } from "@/server/google/source-tree";

const EDITOR = "src/server/agents/image-editor/";

async function appSources() {
  const walked = await sourceFiles("src", "scripts");
  return walked.filter((path) => !TEST.test(path));
}

test("every edit agent 3 can make is a declared tool, and nothing else is", () => {
  assert.deepEqual(
    editorDeclarations().map((declaration) => declaration.name),
    [...EDIT_OP_ORDER],
  );
});

test("two doors open onto agent 3, and both open onto the same one", async () => {
  const outside = (await appSources()).filter(
    (path) => path.startsWith("src/server/") && !path.startsWith(EDITOR),
  );
  const doors = await filesNaming("editReference(", outside);

  assert.deepEqual(doors, ["src/server/api/routers/reference.ts"]);
  assert.deepEqual(await filesNaming("edit = editReference", outside), [
    "src/server/agents/designer/images.ts",
    "src/server/agents/orchestrator/tools.ts",
    "src/server/references/tool-crop.ts",
  ]);
  assert.deepEqual(await filesNaming("runImageEditor", outside), []);
  assert.deepEqual(await filesNaming("editorToolset", outside), []);
});

test("the loop is agent 3's own and borrows nothing from agent 8's", async () => {
  const editor = (await appSources()).filter((path) => path.startsWith(EDITOR));
  assert.deepEqual(await filesNaming('from "@/server/agents/designer/', editor), []);
});

test("a picture a round is all the loop can ever show", () => {
  assert.ok(EDITOR_PICTURE_LIMIT >= EDITOR_ROUND_LIMIT);
});
