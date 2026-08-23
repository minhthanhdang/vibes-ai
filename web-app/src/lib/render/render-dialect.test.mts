import { test } from "node:test";
import assert from "node:assert/strict";

import { DIALECT_SCENE, renderDialect } from "@/lib/render/render-dialect";
import { MODEL_RENDER_DIALECT } from "@/lib/scene/moodboard-render";
import { boardPages } from "@/lib/pages/board-pages";
import { boardRenderPlan, pageRenderPlan } from "@/lib/render/render-plan";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// The tripwire. Everything else in this file is about whether the specimen is
/// worth signing; this is the assertion that makes the object name honest.
test("the pinned dialect is the renderer this checkout holds", () => {
  assert.equal(
    MODEL_RENDER_DIALECT,
    renderDialect(),
    `the renderer draws differently than the pinned dialect says. Set MODEL_RENDER_DIALECT in lib/scene/moodboard-render.ts to "${renderDialect()}" — every stored model render is now of an older hand, and a name that does not change keeps serving them.`,
  );
});

test("the fingerprint is the same on every run and every process", () => {
  assert.equal(renderDialect(), renderDialect());
  assert.match(renderDialect(), /^[0-9a-f]{8}$/);
});

test("a scene the renderer draws differently fingerprints differently", () => {
  const moved = DIALECT_SCENE.map((element) =>
    element.id === "dialect-panel" ? { ...element, strokeStyle: "solid" } : element,
  );
  assert.notEqual(renderDialect(moved), renderDialect());
});

/// The specimen is only as good as what it exercises: a rule with nothing here
/// that would move under it is a rule the fingerprint certifies without having
/// looked. These are the ones this run's eight disagreements landed on.
test("the specimen carries one of everything the renderer decides", () => {
  const plan = boardRenderPlan(DIALECT_SCENE);
  assert.ok(plan);

  const drawn = plan.draws;
  const shapes = drawn.filter((draw) => draw.kind === "shape");
  assert.ok(drawn.some((draw) => draw.kind === "image"));
  assert.ok(drawn.some((draw) => draw.kind === "text"));
  assert.ok(drawn.some((draw) => draw.kind === "outline"));
  assert.ok(shapes.some((draw) => draw.sketch));
  assert.ok(shapes.some((draw) => draw.dash));
  assert.ok(shapes.some((draw) => draw.radius));
  assert.ok(drawn.some((draw) => draw.kind === "image" && draw.radius > 0));
  assert.ok(shapes.some((draw) => draw.shape === "ellipse"));
  assert.ok(shapes.some((draw) => draw.shape === "line"));
  assert.ok(shapes.some((draw) => draw.shape === "arrow"));
  assert.ok(shapes.some((draw) => draw.shape === "frame"));
  assert.ok(shapes.some((draw) => draw.curve));
  assert.ok(shapes.some((draw) => draw.arrowheads.end));
  assert.ok(drawn.some((draw) => draw.opacity < 1));
  assert.ok(drawn.some((draw) => draw.angle !== 0));
  assert.equal(plan.undrawn.length, 2);
});

test("the specimen is one page and something standing off it", () => {
  const pages = boardPages(DIALECT_SCENE);
  assert.equal(pages.length, 1);

  const board = boardRenderPlan(DIALECT_SCENE);
  const page = pageRenderPlan(DIALECT_SCENE, pages[0]!);
  assert.ok(board);
  assert.notDeepEqual(board.frame, page.frame);
  assert.ok(page.draws.length < board.draws.length);
});

test("the fingerprint moves with a ruler that moves no field of the plan", () => {
  /// A wider face is the change iteration 39 made and the plan cannot see: the
  /// text draw carries the string and the size, and only the measured ink says
  /// how wide it sets. Stood in for here by asking the same question of a
  /// longer string in the same box.
  const longer: readonly SceneElement[] = DIALECT_SCENE.map((element) =>
    element.id === "dialect-body"
      ? { ...element, text: `${String(element.text)} And one more sentence still.` }
      : element,
  );
  assert.notEqual(renderDialect(longer), renderDialect());
});
