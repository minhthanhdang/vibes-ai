import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

import {
  DESIGNER_PICTURE_LIMIT,
  DESIGNER_ROUND_LIMIT,
  DESIGNER_ROUNDS_WARNED,
  pictureCeilingSaid,
  roundsLeftSaid,
} from "./loop";
import { CANVAS_PUT_LIMIT, CANVAS_REMOVE_LIMIT, CANVAS_REORDER_LIMIT, CANVAS_TRANSFORM_LIMIT } from "@/lib/agent/shared/canvas-tools";
import { EDIT_CALL_LIMIT, editCeilingSaid, GENERATE_CALL_LIMIT, generationCeilingSaid } from "@/lib/agent/orchestrator/reference-tools";
import { DESIGN_PAGE } from "@/lib/agent/orchestrator/handoff-tools";
import { COMPOSE_BLOCK_LIMIT } from "@/lib/layout/moodboard-compose";
import { PICTURE_WINDOW } from "@/lib/agent/designer/picture-window";
import { RENDER_MAX_DIMENSION } from "@/lib/render/render-plan";
import { TEST, filesNaming, sourceFiles } from "@/server/google/source-tree";
import { RENDER_TIMEOUT_MS } from "@/server/render/for-model";
import { SKILL_NAMES } from "@/server/skills";

const DESIGNER = "src/server/agents/designer/";

async function appSources() {
  const walked = await sourceFiles("src", "scripts");
  return walked.filter((path) => !TEST.test(path));
}

const designerSources = async () =>
  (await appSources()).filter((path) => path.startsWith(DESIGNER));

test("the renderer has no read of its own to disagree with the caller's", async () => {
  assert.deepEqual(await filesNaming("db.moodboard", ["src/server/render/for-model.ts"]), []);
});

test("the two doors that draw hand over the scene they read", async () => {
  const doors = await filesNaming("render = renderForModel", await appSources());
  assert.deepEqual(doors, [`${DESIGNER}canvas.ts`, `${DESIGNER}page.ts`]);
  assert.deepEqual(await filesNaming("scene: {", doors), doors);
});

test("two doors open onto agent 8, and both open onto the same one", async () => {
  const outside = (await appSources()).filter((path) => !path.startsWith(DESIGNER));
  assert.deepEqual(await filesNaming('from "@/server/agents/designer/', outside), [
    "src/server/agents/orchestrator/tools.ts",
    "src/server/agents/vibes/run-vibes-page.ts",
  ]);
  const app = outside.filter((path) => path.startsWith("src/"));
  assert.deepEqual(await filesNaming("designerToolsets", app), []);
  assert.deepEqual(await filesNaming("runDesigner", app), []);
});

test("agent 8 writes no scene of its own", async () => {
  assert.deepEqual(await filesNaming("sceneWrite", await designerSources()), []);
});

test("every skill on disk is a skill in the registry", async () => {
  const entries = await readdir(new URL("../../skills", import.meta.url), {
    withFileTypes: true,
  });
  const folders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  assert.deepEqual(folders.sort(), [...SKILL_NAMES].sort());
});

test("agent 8 files no picture of its own", async () => {
  const designer = await designerSources();
  assert.deepEqual(await filesNaming("storeImage(", designer), []);
  assert.deepEqual(await filesNaming("reference.create", designer), []);
});

test("the canvas five are executed in one place and reached from two", async () => {
  assert.deepEqual(await filesNaming("canvasToolset(", await appSources()), [
    "scripts/design-check.mts",
    `${DESIGNER}canvas.ts`,
    "src/server/agents/orchestrator/tools.ts",
    "src/server/canvas/tool-canvas.ts",
  ]);
});

test("the canvas five are declared once, in the file both agents read", async () => {
  const sources = await appSources();
  for (const declaration of [
    "PUT_ON_CANVAS",
    "READ_CANVAS",
    "REMOVE_FROM_CANVAS",
    "TRANSFORM_ON_CANVAS",
    "REORDER_ON_CANVAS",
  ]) {
    assert.deepEqual(await filesNaming(`export const ${declaration}`, sources), [
      "src/lib/agent/shared/canvas-tools.ts",
    ]);
  }
});

test("the shared page tools are executed in one place and reached from two", async () => {
  assert.deepEqual(await filesNaming("pageToolset(", await appSources()), [
    `${DESIGNER}page.ts`,
    "src/server/agents/orchestrator/tools.ts",
    "src/server/pages/tool-pages.ts",
  ]);
});

test("the shared page tools name no tool of their own", async () => {
  const written = (await readFile("src/server/pages/tool-pages.ts", "utf8"))
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("///"))
    .join("\n");
  for (const tool of [
    "add_page",
    "compose_moodboard",
    "duplicate_board",
    "inspect_board",
    "put_on_canvas",
    "transform_on_canvas",
    "remove_from_canvas",
    "discard_board",
  ]) {
    assert.doesNotMatch(written, new RegExp(tool));
  }
});

test("one board queue is handed to every toolset that writes", async () => {
  const source = await readFile(`${DESIGNER}design.ts`, "utf8");
  assert.equal(source.match(/keyedQueue\(\)/g)?.length, 1);
  for (const toolset of [
    "designerCanvasToolset({",
    "designerPageToolset({",
    "designerBoardToolset({",
  ]) {
    const line = source.slice(source.indexOf(toolset)).split("\n")[0]!;
    assert.match(line, /\bboardEdits\b/);
  }
});

test("the ceiling table is the one the code holds", async () => {
  assert.equal(DESIGNER_ROUND_LIMIT, 12);
  assert.equal(PICTURE_WINDOW, 5);
  assert.equal(DESIGNER_PICTURE_LIMIT, 8);
  assert.deepEqual(await filesNaming(/SKILLS_PER_(CALL|DESIGN)/, await appSources()), []);
  assert.equal(GENERATE_CALL_LIMIT, 2);
  assert.equal(EDIT_CALL_LIMIT, COMPOSE_BLOCK_LIMIT);
  assert.equal(CANVAS_PUT_LIMIT, 10);
  assert.equal(CANVAS_REMOVE_LIMIT, 10);
  assert.equal(CANVAS_TRANSFORM_LIMIT, 10);
  assert.equal(CANVAS_REORDER_LIMIT, 10);
  assert.equal(RENDER_TIMEOUT_MS, 8_000);
  assert.equal(RENDER_MAX_DIMENSION, 1_600);
  assert.deepEqual(
    await filesNaming(/designs\.made|designs = \{|designs = 0|RESERVE_MS|DESIGN_CALL_LIMIT/, await appSources()),
    [],
  );
  assert.doesNotMatch(DESIGN_PAGE.description, / a turn/);
});

test("agent 8 is handed the turn's picture budget rather than opening one", async () => {
  assert.deepEqual(await filesNaming("ownPictureBudget", await appSources()), [
    `${DESIGNER}images.ts`,
  ]);
  const source = await readFile("src/server/agents/orchestrator/tools.ts", "utf8");
  assert.match(source, /budget: \{ generations: pictures, crops \},/);
});

test("a ceiling reached is a ceiling said, with its own number in the sentence", () => {
  assert.match(pictureCeilingSaid("get_image", 1), new RegExp(String(DESIGNER_PICTURE_LIMIT)));
  assert.match(
    editCeilingSaid(EDIT_CALL_LIMIT, EDIT_CALL_LIMIT),
    new RegExp(`\\b${EDIT_CALL_LIMIT} edits\\b`),
  );
  assert.match(
    generationCeilingSaid(GENERATE_CALL_LIMIT, GENERATE_CALL_LIMIT),
    new RegExp(`\\b${GENERATE_CALL_LIMIT} pictures\\b`),
  );
  assert.match(roundsLeftSaid(DESIGNER_ROUNDS_WARNED), new RegExp(String(DESIGNER_ROUND_LIMIT)));
  assert.match(roundsLeftSaid(0), new RegExp(String(DESIGNER_ROUND_LIMIT)));
});

test("the renders agent 8 looks at are named only where they are made", async () => {
  const sources = await appSources();
  for (const path of ["modelPageRenderObjectPath", "modelBoardRenderObjectPath"]) {
    assert.deepEqual(await filesNaming(path, sources), [
      "src/lib/scene/moodboard-render.ts",
      "src/server/render/for-model.ts",
    ]);
  }
});

test("agent 8's answers carry nothing for a chat to show", async () => {
  assert.deepEqual(await filesNaming("ChatAttachment", await designerSources()), []);
});

test("the floor prices the list a design really sends", async () => {
  assert.deepEqual(await filesNaming("designerToolsets", await appSources()), [
    "scripts/design-runs.mts",
    "scripts/floor.mts",
    `${DESIGNER}design.ts`,
  ]);
});

test("the fixture set is three asks, in a director's own words", async () => {
  const source = await readFile("scripts/design-fixtures.mts", "utf8");
  const asks = [...source.matchAll(/name: "([a-z-]+)",\s*\n\s*intention:\s*\n?\s*"([^"]+)"/g)];
  assert.deepEqual(
    asks.map(([, name]) => name),
    ["welcome-sign", "banner", "photo-spread"],
  );
  for (const [, name, intention] of asks) {
    assert.doesNotMatch(intention as string, /_|\bpageId\b|\bboardId\b|\bbox\b/, name as string);
    assert.ok((intention as string).length > 60, `${name} is too thin an ask`);
  }
});

test("the run census measures against the ceilings the loop really holds", async () => {
  const source = await readFile("scripts/design-runs.mts", "utf8");
  assert.match(source, /DESIGNER_ROUND_LIMIT/);
  assert.match(source, /DESIGNER_PICTURE_LIMIT/);
  assert.deepEqual(await filesNaming("designRunsRead", await appSources()), [
    "scripts/design-runs.mts",
    "src/lib/agent/designer/design-runs.ts",
  ]);
});
