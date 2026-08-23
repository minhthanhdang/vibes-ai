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
import {
  CANVAS_PUT_LIMIT,
  CANVAS_REMOVE_LIMIT,
  CANVAS_REORDER_LIMIT,
  CANVAS_TRANSFORM_LIMIT,
  CROP_CALL_LIMIT,
  DESIGN_PAGE,
  GENERATE_CALL_LIMIT,
  cropCeilingSaid,
  generationCeilingSaid,
} from "@/lib/agent/agent-tools";
import { SKILLS_PER_CALL, SKILLS_PER_DESIGN, skillsOverCallSaid } from "@/lib/agent/designer-tools";
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

test("two doors open onto agent 8, and both open onto the same one", async () => {
  const outside = (await appSources()).filter((path) => !path.startsWith(DESIGNER));
  /// Agent 6's `design_page` and the user's own "Let's Vibes" (§IX.2). Two
  /// doors is the design and two *agents* is the failure, so what is asserted
  /// beside the list is that neither caller assembles agent 8 out of its parts:
  /// a `designerToolsets` or a `runDesigner` outside this directory is a second
  /// agent with the same name, one instruction and two behaviours (§IX.5).
  assert.deepEqual(await filesNaming('from "@/server/agents/designer/', outside), [
    "src/server/agents/tools.ts",
    "src/server/api/routers/vibes.ts",
  ]);
  /// The scripts are left out of the second pair on purpose: `npm run floor`
  /// prices the toolsets and `npm run design:runs` reads what the loop spent,
  /// and neither is a door — they are how the two doors above get measured.
  const app = outside.filter((path) => path.startsWith("src/"));
  assert.deepEqual(await filesNaming("designerToolsets", app), []);
  assert.deepEqual(await filesNaming("runDesigner", app), []);
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
    /// An operator script, and the reason it is allowed to be here is the same
    /// reason the pin exists: `--page-box` makes a page for a design to work in,
    /// and it makes it through this door rather than writing a page element into
    /// the scene itself. A third *caller* is not a second implementation — a
    /// script that reached for `putObjects` and `sceneWrite` on its own would be
    /// one, and the run measured against the page it made would be measuring
    /// the script.
    "scripts/design-check.mts",
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

/// The same rule one tool further out: §IV.2's four inherited page tools —
/// `resize_page`, `duplicate_page`, `move_to_page` and `discard_page` — are agent
/// 6's, and a page's rectangle and the pictures standing on it are the scene the
/// canvas five write, so a second implementation of any of them would be a second
/// account of what a page holds after it changes. `discard_page` is the one that
/// changes nothing, and the rule is the same for it: what a discard would cost is
/// counted by the code that would take it.

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
    "remove_from_canvas",
    "discard_board",
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

test("§VII's table is the one the code holds", async () => {
  assert.equal(DESIGNER_ROUND_LIMIT, 12);
  assert.equal(PICTURE_WINDOW, 5);
  assert.equal(DESIGNER_PICTURE_LIMIT, 8);
  /// §VII's table wrote this as 3-and-one-call. Both numbers moved when the
  /// registry did: a catalogue of this size behind three slots is a harder
  /// choice rather than a bigger allowance, so the per-call cap is what an
  /// answer may carry and `SKILLS_PER_DESIGN` is what the design may read over
  /// as many calls as it takes.
  assert.equal(SKILLS_PER_CALL, 8);
  assert.equal(SKILLS_PER_DESIGN, 12);
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
  /// The one row §VI took out rather than moved: `DESIGN_CALL_LIMIT` = 1 is
  /// removed, so "a poster and a banner" is one turn and two designs, and what
  /// bounds it is `TURN_TOKEN_CEILING` reading the bill instead of a count of
  /// calls. Held over the source rather than over the exports, because the
  /// tally that enforced it lived in agent 6's toolset and not at the constant
  /// — a count of designs kept anywhere is the ceiling back without it.
  assert.deepEqual(await filesNaming(/designs\.made|designs = \{/, await appSources()), []);
  /// And the declaration says so by saying nothing: a ceiling this file may
  /// not apply silently is one the description would have had to name.
  assert.doesNotMatch(DESIGN_PAGE.description, / a turn/);
});

/// The two ceilings §VII calls shared — "one budget, whoever spends it". A
/// design is not a turn of its own: it runs inside the turn that called
/// `design_page`, so the tallies come down from agent 6's toolset and nothing
/// under `designer/` may open a pair. A second `ownPictureBudget()` anywhere in
/// the app is a turn that may draw four pictures while both agents count two.
test("agent 8 is handed the turn's picture budget rather than opening one", async () => {
  assert.deepEqual(await filesNaming("ownPictureBudget", await appSources()), [
    `${DESIGNER}images.ts`,
  ]);
  /// And the door really hands it down: the one place `designPage` is called is
  /// agent 6's `makeDesign`, which spends the same two objects its own
  /// `generate_image` and `crop_reference` do.
  const source = await readFile("src/server/agents/tools.ts", "utf8");
  assert.match(source, /budget: \{ generations: pictures, crops \},/);
});

test("a ceiling reached is a ceiling said, with its own number in the sentence", () => {
  /// The number matters as much as the refusal: "that is all" tells a model to
  /// stop and tells it nothing about what it has, and a model that stops
  /// without knowing how much it spent describes the work it meant to do.
  assert.match(pictureCeilingSaid("get_image", 1), new RegExp(String(DESIGNER_PICTURE_LIMIT)));
  assert.match(skillsOverCallSaid(0), new RegExp(String(SKILLS_PER_CALL)));
  assert.match(skillsOverCallSaid(0), new RegExp(String(SKILLS_PER_DESIGN)));
  assert.match(skillsOverCallSaid(4), /4 more skills/);
  assert.match(
    cropCeilingSaid(CROP_CALL_LIMIT, CROP_CALL_LIMIT),
    new RegExp(`\\b${CROP_CALL_LIMIT} cuts\\b`),
  );
  assert.match(
    generationCeilingSaid(GENERATE_CALL_LIMIT, GENERATE_CALL_LIMIT),
    new RegExp(`\\b${GENERATE_CALL_LIMIT} pictures\\b`),
  );
  /// The round ceiling is the one that is said *before* it bites as well as
  /// after: every other ceiling here refuses one call and leaves the design
  /// running, and this one ends it — so a model told only afterwards is told
  /// by `DESIGNER_STUCK_LINE`, which is written for agent 6 and which agent 8
  /// never reads.
  assert.match(roundsLeftSaid(DESIGNER_ROUNDS_WARNED), new RegExp(String(DESIGNER_ROUND_LIMIT)));
  assert.match(roundsLeftSaid(0), new RegExp(String(DESIGNER_ROUND_LIMIT)));
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

/// The instrument, rather than one of the seven: the prompt asks for agent 8's
/// declaration cost measured the way the tool reference's §III measures every
/// other addition, and `npm run floor` is that instrument.

test("the floor prices the list a design really sends", async () => {
  /// A floor measured off a hand-kept copy of the toolsets is a floor that
  /// silently stops being the real one the first time a tool is added — the
  /// number keeps printing and keeps being wrong, which is worse than no
  /// number. So there is one assembly of agent 8's tools and the script asks
  /// for it rather than listing anything itself.
  ///
  /// `design-runs.mts` is the second caller and is the same argument one step
  /// on: it asks which of those priced declarations no design has ever called,
  /// and a hand-kept list there would answer for the tools somebody remembered.
  assert.deepEqual(await filesNaming("designerToolsets", await appSources()), [
    "scripts/design-runs.mts",
    "scripts/floor.mts",
    `${DESIGNER}design.ts`,
  ]);
});

/// The other instrument: §VIII's second risk — free placement can make an ugly
/// page and nothing in the system will say so — is answered with a fixture set
/// of asks kept and eyeballed rather than with an assertion, because no test
/// asserts taste. What a test *can* hold is that the set is still the three the
/// spec named and that they are still asks rather than instructions.

test("the fixture set is §VIII's three asks, in a director's own words", async () => {
  const source = await readFile("scripts/design-fixtures.mts", "utf8");
  const asks = [...source.matchAll(/name: "([a-z-]+)",\s*\n\s*intention:\s*\n?\s*"([^"]+)"/g)];
  assert.deepEqual(
    asks.map(([, name]) => name),
    ["welcome-sign", "banner", "photo-spread"],
  );
  for (const [, name, intention] of asks) {
    /// A fixture whose ask names a tool, an id or a box exercises a model
    /// nobody has: the whole point of the set is the reading agent 8 does of a
    /// sentence somebody would really say, and an ask written as arguments
    /// skips exactly the step that can produce an ugly page.
    assert.doesNotMatch(intention as string, /_|\bpageId\b|\bboardId\b|\bbox\b/, name as string);
    assert.ok((intention as string).length > 60, `${name} is too thin an ask`);
  }
});

/// The third instrument: §VIII's other two risks — the render cache's hit rate
/// and `DESIGNER_PICTURE_LIMIT` — are both written down as a number to *read*
/// before a ceiling moves, off the run rows. `npm run design:runs` is that
/// read, and what a test can hold is that it reads the ceilings rather than
/// repeating them.

test("the run census measures against the ceilings the loop really holds", async () => {
  const source = await readFile("scripts/design-runs.mts", "utf8");
  /// A census with `12` typed into it goes on reporting "3 of 30 at the limit"
  /// after somebody moves the limit, which is worse than no reading: the number
  /// keeps printing and quietly stops being about the loop that ran.
  assert.match(source, /DESIGNER_ROUND_LIMIT/);
  assert.match(source, /DESIGNER_PICTURE_LIMIT/);
  assert.deepEqual(await filesNaming("designRunsRead", await appSources()), [
    "scripts/design-runs.mts",
    "src/lib/agent/design-runs.ts",
  ]);
});
