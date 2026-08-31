import { test } from "node:test";
import assert from "node:assert/strict";

import { editorToolset } from "./toolset";
import type { EditOp } from "@/lib/edit/edit-ops";
import { looseShapeOf } from "@/lib/references/reference-version";
import type { EditPreview } from "@/server/references/edits";

const call = (name: string, args: Record<string, unknown> = {}) => ({ name, args });

const errorOf = (result: Record<string, unknown>) =>
  typeof result.error === "string" ? result.error : null;

const previewing = (shown: EditPreview | null = { base64: "AAAA", mimeType: "image/jpeg" }) => {
  const seen: EditOp[][] = [];
  const preview = async (ops: readonly EditOp[]) => {
    seen.push([...ops]);
    return shown;
  };
  return { seen, preview };
};

test("the four edits are declared, and only the one asked for when one is", () => {
  assert.deepEqual(
    editorToolset().declarations.map((declaration) => declaration.name),
    ["crop", "turn", "flip", "grade"],
  );
  assert.deepEqual(
    editorToolset({ only: "crop" }).declarations.map((declaration) => declaration.name),
    ["crop"],
  );
});

test("a crop applies against the frame and comes back as a box in columns", async () => {
  const tools = editorToolset();
  const { result } = await tools.execute(call("crop", { box: [100, 200, 800, 900] }));

  assert.equal(errorOf(result), null);
  assert.equal(result.edit, "crop");
  assert.deepEqual(tools.ops(), [{ op: "crop", box: [100, 200, 800, 900] }]);
});

test("what is not a box of the image is refused and nothing is applied", async () => {
  const tools = editorToolset();
  const { result } = await tools.execute(call("crop", { box: "the middle one" }));

  assert.match(errorOf(result) ?? "", /not a box of this image/);
  assert.deepEqual(tools.ops(), []);
});

test("a strip of a frame is refused as a strip rather than a shot", async () => {
  const tools = editorToolset();
  const { result } = await tools.execute(call("crop", { box: [500, 100, 508, 900] }));

  assert.match(errorOf(result) ?? "", /strip rather than a shot/);
  assert.deepEqual(tools.ops(), []);
});

test("a box that misses the shape it is held to is refused in the shape's own words", async () => {
  const tools = editorToolset({
    held: { loose: looseShapeOf("square")!, frame: { width: 1000, height: 1000 } },
  });
  const missed = await tools.execute(call("crop", { box: [400, 100, 600, 900] }));
  assert.match(errorOf(missed.result) ?? "", /roughly square/);

  const held = await tools.execute(call("crop", { box: [100, 100, 700, 700] }));
  assert.equal(errorOf(held.result), null);
  assert.deepEqual(tools.ops(), [{ op: "crop", box: [100, 100, 700, 700] }]);
});

test("a second crop moves the box while the crop is the only edit", async () => {
  const tools = editorToolset();
  await tools.execute(call("crop", { box: [100, 100, 900, 900] }));
  const { result } = await tools.execute(call("crop", { box: [200, 200, 800, 800] }));

  assert.equal(errorOf(result), null);
  assert.match(String(result.status), /replaces the one before it/);
  assert.deepEqual(tools.ops(), [{ op: "crop", box: [200, 200, 800, 800] }]);
});

test("a crop after a pixel edit is refused, and the pixel edit stands", async () => {
  const tools = editorToolset();
  await tools.execute(call("turn", { turn: "right" }));
  const { result } = await tools.execute(call("crop", { box: [100, 100, 900, 900] }));

  assert.match(errorOf(result) ?? "", /first edit or none/);
  assert.deepEqual(tools.ops(), [{ op: "turn", turn: "right" }]);
});

test("a second turn is refused rather than put on top of the first", async () => {
  const tools = editorToolset();
  const first = await tools.execute(call("turn", { turn: "right" }));
  assert.equal(errorOf(first.result), null);

  const { result } = await tools.execute(call("turn", { turn: "left" }));
  assert.match(errorOf(result) ?? "", /already turned it right/);
  assert.deepEqual(tools.ops(), [{ op: "turn", turn: "right" }]);
});

test("a second flip is refused the same way", async () => {
  const tools = editorToolset();
  await tools.execute(call("flip", { axis: "horizontal" }));
  const { result } = await tools.execute(call("flip", { axis: "vertical" }));

  assert.match(errorOf(result) ?? "", /already flipped it left to right/);
  assert.deepEqual(tools.ops(), [{ op: "flip", axis: "horizontal" }]);
});

test("a turn that is not a quarter turn says what the words are", async () => {
  const tools = editorToolset();
  const { result } = await tools.execute(call("turn", { turn: "45 degrees" }));

  assert.match(errorOf(result) ?? "", /left, right, upside-down/);
  assert.deepEqual(tools.ops(), []);
});

test("a grade with every knob at 0 is not an edit", async () => {
  const tools = editorToolset();
  const { result } = await tools.execute(call("grade", { warmth: 0, contrast: 0 }));

  assert.match(errorOf(result) ?? "", /changes nothing/);
  assert.deepEqual(tools.ops(), []);
});

test("a second grade replaces the first rather than adding to it", async () => {
  const tools = editorToolset();
  await tools.execute(call("grade", { warmth: 60 }));
  const { result } = await tools.execute(call("grade", { warmth: 25, contrast: 10 }));

  assert.match(String(result.status), /replace the grade you made before/);
  assert.deepEqual(tools.ops(), [
    { op: "grade", brightness: 0, contrast: 10, saturation: 0, warmth: 25, hue: 0 },
  ]);
});

test("the ops come back in the canonical order however they were called", async () => {
  const tools = editorToolset();
  await tools.execute(call("grade", { warmth: 20 }));
  await tools.execute(call("flip", { axis: "horizontal" }));
  await tools.execute(call("turn", { turn: "right" }));

  assert.deepEqual(tools.ops(), [
    { op: "turn", turn: "right" },
    { op: "flip", axis: "vertical" },
    { op: "grade", brightness: 0, contrast: 0, saturation: 0, warmth: 20, hue: 0 },
  ]);
});

test("every answer says what has been done to the picture so far", async () => {
  const tools = editorToolset();
  await tools.execute(call("crop", { box: [100, 100, 900, 900] }));
  const { result } = await tools.execute(call("grade", { warmth: 30 }));

  assert.equal(result.done, "cropped it and warmed it up");
});

test("a tool that was not declared is refused with the ones that were", async () => {
  const tools = editorToolset({ only: "crop" });
  const { result } = await tools.execute(call("grade", { warmth: 30 }));

  assert.match(errorOf(result) ?? "", /is not an edit this can make/);
  assert.match(errorOf(result) ?? "", /crop/);
});

test("the preview is of the ops as they now stand, as bytes", async () => {
  const { seen, preview } = previewing();
  const tools = editorToolset({ preview });

  assert.equal(await tools.preview(), null);
  assert.deepEqual(seen, []);

  await tools.execute(call("crop", { box: [100, 100, 900, 900] }));
  await tools.execute(call("grade", { warmth: 30 }));

  const shown = await tools.preview();
  assert.deepEqual(seen, [tools.ops()]);
  assert.equal(shown?.inlineData?.data, "AAAA");
  assert.equal(shown?.inlineData?.mimeType, "image/jpeg");
});

test("a picture already shown is not made or shown a second time", async () => {
  const { seen, preview } = previewing();
  const tools = editorToolset({ preview });
  await tools.execute(call("crop", { box: [100, 100, 900, 900] }));

  assert.ok(await tools.preview());
  assert.equal(await tools.preview(), null);
  assert.equal(seen.length, 1);

  await tools.execute(call("grade", { warmth: 20 }));
  assert.ok(await tools.preview());
  assert.equal(seen.length, 2);
});

test("a preview that could not be made is no picture rather than a fault", async () => {
  const { preview } = previewing(null);
  const tools = editorToolset({ preview });
  await tools.execute(call("crop", { box: [100, 100, 900, 900] }));

  assert.equal(await tools.preview(), null);
});

test("with no previewer at all there is nothing to show", async () => {
  const tools = editorToolset();
  await tools.execute(call("crop", { box: [100, 100, 900, 900] }));

  assert.equal(await tools.preview(), null);
});
