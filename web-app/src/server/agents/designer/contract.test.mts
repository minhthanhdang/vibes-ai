import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

import { DESIGNER_PICTURE_LIMIT, DESIGNER_ROUND_LIMIT, pictureCeilingSaid } from "./loop";
import {
  CANVAS_PUT_LIMIT,
  CANVAS_REMOVE_LIMIT,
  CANVAS_REORDER_LIMIT,
  CANVAS_TRANSFORM_LIMIT,
  CROP_CALL_LIMIT,
  DESIGN_CALL_LIMIT,
  GENERATE_CALL_LIMIT,
  cropCeilingSaid,
  generationCeilingSaid,
} from "@/lib/agent/agent-tools";
import { SKILLS_OVER_CALL_NOTE, SKILLS_PER_CALL } from "@/lib/agent/designer-tools";
import { COMPOSE_BLOCK_LIMIT } from "@/lib/layout/moodboard-compose";
import { PICTURE_WINDOW } from "@/lib/agent/picture-window";
import { RENDER_MAX_DIMENSION } from "@/lib/render/render-plan";
import { TEST, filesNaming, sourceFiles } from "@/server/google/source-tree";
import { RENDER_TIMEOUT_MS } from "@/server/render/for-model";
import { SKILL_NAMES } from "@/server/skills";

/// The seven things that must be true now agent 8 is built, held over the
/// source because none of them is a thing one unit test can reach.
///
/// Each is a rule about *where* something may happen rather than about what a
/// function returns — one renderer, one door, one filer, one canvas
/// implementation — and every one of them is satisfied today by a decision
/// somebody made rather than by a type. A second reader of the board row inside
/// `renderForModel`, a second `sceneWrite` beside the canvas five, a skill
/// folder nobody registered: all of them compile, all of them pass every other
/// test in this directory, and all of them break a rule the whole design rests
/// on. This is the file that notices.
///
/// The idiom is `run-price.test.mts`'s and for the same reason: the lists are
/// written out rather than walked to, because a walk that silently resolved to
/// nothing would satisfy every rule below forever.

const DESIGNER = "src/server/agents/designer/";

async function appSources() {
  const walked = await sourceFiles("src", "scripts");
  return walked.filter((path) => !TEST.test(path));
}

const designerSources = async () =>
  (await appSources()).filter((path) => path.startsWith(DESIGNER));

/// 1. `renderForModel` draws on demand, and no vision-carrying tool sends a
/// picture of a revision other than the one it read the scene at (§III.3).

test("the renderer has no read of its own to disagree with the caller's", async () => {
  /// The invariant made unspellable rather than remembered: the scene comes in
  /// as an argument, so there is no second read of the board row for the
  /// picture to be of. A `db.moodboard` appearing here is the race itself.
  assert.deepEqual(await filesNaming("db.moodboard", ["src/server/render/for-model.ts"]), []);
});

test("the two doors that draw hand over the scene they read", async () => {
  const doors = await filesNaming("render = renderForModel", await appSources());
  assert.deepEqual(doors, [`${DESIGNER}canvas.ts`, `${DESIGNER}page.ts`]);
  /// `get_page`'s words and picture, and `read_canvas`'s boxes and picture, are
  /// each one read stamped with one revision — which is the whole of §III.3.
  assert.deepEqual(await filesNaming("scene: {", doors), doors);
});

/// 2. Agent 8 is an `AgentTool`, reachable only through `design_page`, writing
/// through the same queued, revision-guarded `sceneWrite` the user's controls
/// use (§VI, §IV.1).

test("one door opens onto agent 8", async () => {
  const outside = (await appSources()).filter((path) => !path.startsWith(DESIGNER));
  assert.deepEqual(await filesNaming('from "@/server/agents/designer/', outside), [
    "src/server/agents/tools.ts",
  ]);
});

test("agent 8 writes no scene of its own", async () => {
  /// Every write it makes is one of the canvas five's, which is where the queue
  /// and the revision guard are. A `sceneWrite` in this directory would be a
  /// second writer on a board two agents share.
  assert.deepEqual(await filesNaming("sceneWrite", await designerSources()), []);
});

/// 3. `get_skill` answers from the registry, and the registry is the skills
/// (§V.1).

test("every skill on disk is a skill in the registry", async () => {
  /// The registry's own test walks the other way — a registered skill lives in
  /// the directory it is named after. This is the direction that catches the
  /// fourteenth folder: writing is the long part of a skill and registering it
  /// is one line, so the file written and never imported is the shape this
  /// stage fails in, and it fails silently — the model is simply never offered
  /// it.
  const entries = await readdir(new URL("../../skills", import.meta.url), {
    withFileTypes: true,
  });
  const folders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  assert.deepEqual(folders.sort(), [...SKILL_NAMES].sort());
});

/// 4. A generation reported as done has its bytes in GCS and its row filed
/// (§IV.4).

test("agent 8 files no picture of its own", async () => {
  /// The awaits that make "done" mean filed are in
  /// `@/server/references/tool-generation` and `tool-crop`, one copy for both
  /// agents. A `storeImage` here would be a second sequence to keep in step
  /// with them, and the failure it fails in — bytes without a row — is one the
  /// next round reads as "no reference called that".
  const designer = await designerSources();
  assert.deepEqual(await filesNaming("storeImage(", designer), []);
  assert.deepEqual(await filesNaming("reference.create", designer), []);
});

/// 5. The five canvas tools have one implementation between agent 6 and agent 8
/// (canvas.md §XI).

test("the canvas five are executed in one place and reached from two", async () => {
  assert.deepEqual(await filesNaming("canvasToolset(", await appSources()), [
    `${DESIGNER}canvas.ts`,
    "src/server/agents/tools.ts",
    "src/server/canvas/tool-canvas.ts",
  ]);
});

test("the canvas five are declared once, in agent 6's file", async () => {
  /// Agent 8 imports the declarations rather than writing its own: same
  /// handles, same y-first boxes, same refusals. A copy in `designer-tools.ts`
  /// would be two descriptions of one tool, drifting a sentence at a time.
  const sources = await appSources();
  for (const declaration of [
    "PUT_ON_CANVAS",
    "READ_CANVAS",
    "REMOVE_FROM_CANVAS",
    "TRANSFORM_ON_CANVAS",
    "REORDER_ON_CANVAS",
  ]) {
    assert.deepEqual(await filesNaming(`export const ${declaration}`, sources), [
      "src/lib/agent/agent-tools.ts",
    ]);
  }
});

/// The same rule one tool further out: `resize_page`, `duplicate_page` and
/// `move_to_page` are agent 6's, and a page's rectangle and the pictures standing
/// on it are the scene the canvas five write — so a second implementation of any
/// of them would be a second account of what a page holds after it changes.

test("the shared page tools are executed in one place and reached from two", async () => {
  assert.deepEqual(await filesNaming("pageToolset(", await appSources()), [
    `${DESIGNER}page.ts`,
    "src/server/agents/tools.ts",
    "src/server/pages/tool-pages.ts",
  ]);
});

test("the shared page tools name no tool of their own", async () => {
  /// Everything in those answers is a fact about the scene except the clauses
  /// in `PageToolNotes`, which say what to *call* next — and the two
  /// agents hold different tools. A tool name written into the shared file is
  /// one agent told to call something it was never given, which costs it a round
  /// and reads to the user as the assistant forgetting what it can do.
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
  ]) {
    assert.doesNotMatch(written, new RegExp(tool));
  }
});

test("one board queue is handed to both toolsets that write", async () => {
  /// A page's rectangle and the objects standing on it are one row and one
  /// revision. Two queues would serialise each toolset against itself and
  /// neither against the other, so a reshape and a `put_on_canvas` in one round
  /// would read one revision, land one write, and tell the model the user
  /// changed the board underneath the other. Nobody had it open.
  const source = await readFile(`${DESIGNER}design.ts`, "utf8");
  assert.equal(source.match(/keyedQueue\(\)/g)?.length, 1);
  for (const toolset of ["designerCanvasToolset({", "designerPageToolset({"]) {
    const line = source.slice(source.indexOf(toolset)).split("\n")[0]!;
    assert.match(line, /boardEdits,/);
  }
});

/// 6. Every ceiling in §VII is enforced and reported, never silently applied.

test("§VII's table is the one the code holds", () => {
  assert.equal(DESIGNER_ROUND_LIMIT, 12);
  assert.equal(PICTURE_WINDOW, 2);
  assert.equal(DESIGNER_PICTURE_LIMIT, 8);
  assert.equal(SKILLS_PER_CALL, 3);
  assert.equal(GENERATE_CALL_LIMIT, 2);
  /// §VII writes this one as 2 and the code is right instead. It was raised to
  /// `COMPOSE_BLOCK_LIMIT` before agent 8 existed, for a reason written out at
  /// the constant: "crop everything on this board to fit" is one sentence about
  /// a board that may hold twelve pictures, and a ceiling of two turned it into
  /// six turns of the user saying "and the next one". Inherited whole, which is
  /// what §VII's "inherited, same sharing" actually asks for — a second number
  /// here would be agent 8 cropping to a different budget than agent 6 on the
  /// same shared tally.
  assert.equal(CROP_CALL_LIMIT, COMPOSE_BLOCK_LIMIT);
  assert.equal(CANVAS_PUT_LIMIT, 10);
  assert.equal(CANVAS_REMOVE_LIMIT, 10);
  assert.equal(CANVAS_TRANSFORM_LIMIT, 10);
  assert.equal(CANVAS_REORDER_LIMIT, 10);
  assert.equal(RENDER_TIMEOUT_MS, 8_000);
  assert.equal(RENDER_MAX_DIMENSION, 1_600);
  assert.equal(DESIGN_CALL_LIMIT, 1);
});

test("a ceiling reached is a ceiling said, with its own number in the sentence", () => {
  /// The number matters as much as the refusal: "that is all" tells a model to
  /// stop and tells it nothing about what it has, and a model that stops
  /// without knowing how much it spent describes the work it meant to do.
  assert.match(pictureCeilingSaid("get_image", 1), new RegExp(String(DESIGNER_PICTURE_LIMIT)));
  assert.match(SKILLS_OVER_CALL_NOTE, new RegExp(String(SKILLS_PER_CALL)));
  assert.match(
    cropCeilingSaid(CROP_CALL_LIMIT, CROP_CALL_LIMIT),
    new RegExp(`\\b${CROP_CALL_LIMIT} cuts\\b`),
  );
  assert.match(
    generationCeilingSaid(GENERATE_CALL_LIMIT, GENERATE_CALL_LIMIT),
    new RegExp(`\\b${GENERATE_CALL_LIMIT} pictures\\b`),
  );
});

/// 7. Nothing agent 8 draws is ever shown to a user (§III).

test("the renders agent 8 looks at are named only where they are made", async () => {
  /// `renders/` is its own prefix for this reason, and the two path builders
  /// are the only way to spell it. A tab or a tRPC router naming one would be
  /// a picture drawn for a model's judgement — geometry exact, fidelity beside
  /// the point — put in front of the person whose page it is.
  const sources = await appSources();
  for (const path of ["modelPageRenderObjectPath", "modelBoardRenderObjectPath"]) {
    assert.deepEqual(await filesNaming(path, sources), [
      "src/lib/scene/moodboard-render.ts",
      "src/server/render/for-model.ts",
    ]);
  }
});

test("agent 8's answers carry nothing for a chat to show", async () => {
  /// `DesignerOutcome` has no `attachments` and this is why: its pictures go up
  /// as parts for its own eyes. The one thing the user sees after a design is
  /// the board itself, and agent 6's door draws that tile from its own fresh
  /// read.
  assert.deepEqual(await filesNaming("ChatAttachment", await designerSources()), []);
});
