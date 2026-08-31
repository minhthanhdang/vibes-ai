import { test } from "node:test";
import assert from "node:assert/strict";

import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { EDIT_CALL_LIMIT } from "@/lib/agent/orchestrator/reference-tools";
import { EDIT_IMAGE, DESIGNER_GENERATE_IMAGE, IMAGE_TOOLS } from "@/lib/agent/designer/image-tools";

function argument(tool: ToolDeclaration, name: string): string {
  const properties = tool.parameters.properties as Record<string, { description: string }>;
  return properties[name].description;
}

test("the image set is the two image tools", () => {
  assert.deepEqual(
    IMAGE_TOOLS.map((tool) => tool.name),
    ["generate_image", "edit_image"],
  );
});

test("generate_image ends at a filed picture the next round can place", () => {
  const said = DESIGNER_GENERATE_IMAGE.description;
  assert.match(said, /file it in the gallery/);
  assert.match(said, /put_on_canvas/);
  assert.match(said, /at most 2 a turn/);
  assert.match(said, /list_gallery carries the description it was drawn at/);
  assert.match(said, /made rather than found/);
  assert.deepEqual(DESIGNER_GENERATE_IMAGE.parameters.required, ["description"]);
  assert.deepEqual(Object.keys(DESIGNER_GENERATE_IMAGE.parameters.properties as object), [
    "description",
    "aspect",
  ]);
});

test("generate_image says the drawing model sees nothing but the description", () => {
  const said = argument(DESIGNER_GENERATE_IMAGE, "description");
  assert.match(said, /cannot see the project, the board or the conversation/);
});

test("edit_image takes its four arguments and no board", () => {
  assert.deepEqual(EDIT_IMAGE.parameters.required, ["imageId", "intention"]);
  assert.deepEqual(Object.keys(EDIT_IMAGE.parameters.properties as object), [
    "imageId",
    "intention",
    "aspect",
    "toObjectId",
  ]);
  const said = JSON.stringify(EDIT_IMAGE);
  assert.ok(!said.includes("boardId"), "edit_image still takes agent 6's boardId");
  assert.ok(!said.includes("pageId"), "edit_image still takes agent 6's pageId");
});

test("edit_image files rather than offers, and says the id is placeable next round", () => {
  const said = EDIT_IMAGE.description;
  assert.match(said, /made in this call, not offered/);
  assert.match(said, /put_on_canvas takes that id on the next round/);
  assert.match(said, /discard_image/);
  assert.match(said, new RegExp(`at most ${EDIT_CALL_LIMIT} a turn`));
});

test("edit_image says the board is not changed, since agent 8 has no swap", () => {
  assert.match(EDIT_IMAGE.description, /Nothing on any board changes/);
  assert.match(EDIT_IMAGE.description, /remove_from_canvas/);
  const said = argument(EDIT_IMAGE, "toObjectId");
  assert.match(said, /the board is not changed by this call/);
  assert.match(said, /put the cut on with put_on_canvas/);
});

test("toObjectId is a read_canvas handle, and it is the shape that is read off it", () => {
  const said = argument(EDIT_IMAGE, "toObjectId");
  assert.match(said, /objectId from read_canvas/);
  assert.match(said, /held to that box's own shape/);
  assert.match(said, /a shape named in aspect wins/);
});

test("edit_image keeps the nudge — a version's id moves that cut", () => {
  const said = argument(EDIT_IMAGE, "imageId");
  assert.match(said, /modification/);
  assert.match(said, /moves that cut instead of taking a smaller piece out of it/);
});

test("both image declarations offer the same two shape vocabularies", () => {
  for (const tool of IMAGE_TOOLS) {
    const said = argument(tool, "aspect");
    assert.match(said, /width:height/);
    assert.match(said, /square/);
  }
});
