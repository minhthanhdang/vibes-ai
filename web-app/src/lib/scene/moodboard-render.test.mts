import { test } from "node:test";
import assert from "node:assert/strict";

import {
  boardRenderIsCurrent,
  boardRenderNeeded,
  boardRenderObjectPath,
  MODEL_RENDER_DIALECT,
  MODEL_RENDER_PREFIX,
  modelBoardRenderObjectPath,
  modelPageRenderObjectPath,
  pageRenderObjectPath,
  type BoardRenderNeed,
} from "@/lib/scene/moodboard-render";
import { boardRenderPath } from "@/server/moodboards/display";

function need(overrides: Partial<BoardRenderNeed> = {}): BoardRenderNeed {
  return {
    status: "idle",
    revision: 4,
    renderedRevision: 3,
    attemptedRevision: null,
    elementCount: 2,
    ...overrides,
  };
}

test("a saved board whose picture is older than its scene is rendered", () => {
  assert.equal(boardRenderNeeded(need()), true);
  assert.equal(boardRenderNeeded(need({ renderedRevision: null })), true);
});

test("a board whose picture is of this very revision is left alone", () => {
  assert.equal(boardRenderNeeded(need({ renderedRevision: 4 })), false);
});

test("a board with work the server does not hold is never rendered", () => {
  for (const status of ["pending", "saving", "error", "conflict"] as const) {
    assert.equal(boardRenderNeeded(need({ status })), false, status);
  }
});

test("an empty board has nothing to draw, so it keeps whatever picture it had", () => {
  assert.equal(boardRenderNeeded(need({ elementCount: 0 })), false);
});

test("a render already attempted at this revision is not attempted again", () => {
  assert.equal(boardRenderNeeded(need({ attemptedRevision: 4 })), false);
  assert.equal(boardRenderNeeded(need({ attemptedRevision: 4, revision: 5 })), true);
});

test("a board's picture is one object, overwritten, under its own project", () => {
  assert.equal(
    boardRenderObjectPath("p1", "b1"),
    "projects/p1/boards/b1/render.png",
  );
  assert.equal(boardRenderObjectPath("p1", "b1"), boardRenderObjectPath("p1", "b1"));
  assert.notEqual(boardRenderObjectPath("p1", "b1"), boardRenderObjectPath("p1", "b2"));
});

test("only a picture of the scene a row holds is current", () => {
  assert.equal(boardRenderIsCurrent({ renderUri: "gs://b/o", renderRevision: 4, revision: 4 }), true);
  assert.equal(
    boardRenderIsCurrent({ renderUri: "gs://b/o", renderRevision: 3, revision: 4 }),
    false,
  );
  assert.equal(boardRenderIsCurrent({ renderUri: null, renderRevision: 4, revision: 4 }), false);
  assert.equal(boardRenderIsCurrent({ renderUri: "gs://b/o", renderRevision: null, revision: 0 }), false);
});

test("the picture's url changes when the picture does, so it can be cached", () => {
  assert.notEqual(boardRenderPath("b1", 3), boardRenderPath("b1", 4));
  assert.match(boardRenderPath("b1", 4), /^\/api\/moodboards\/b1\/render\?/);
});

test("a picture drawn for a model lives under its own prefix, named by revision", () => {
  assert.equal(
    modelPageRenderObjectPath("pg1", 7),
    `renders/${MODEL_RENDER_DIALECT}/pages/pg1@7.png`,
  );
  assert.equal(
    modelBoardRenderObjectPath("b1", 7),
    `renders/${MODEL_RENDER_DIALECT}/boards/b1@7.png`,
  );
});

test("both names carry the renderer that drew them, under the swept prefix", () => {
  for (const path of [modelPageRenderObjectPath("pg1", 7), modelBoardRenderObjectPath("b1", 7)]) {
    assert.ok(path.startsWith(MODEL_RENDER_PREFIX), path);
    assert.ok(path.includes(`/${MODEL_RENDER_DIALECT}/`), path);
  }
});

test("the model's page render is never the browser's, at any revision", () => {
  assert.notEqual(modelPageRenderObjectPath("pg1", 7), pageRenderObjectPath("p1", "b1", "pg1", 7));
});

test("a revision names its own object, so one already sent can never be rewritten", () => {
  assert.notEqual(modelPageRenderObjectPath("pg1", 7), modelPageRenderObjectPath("pg1", 8));
  assert.notEqual(modelBoardRenderObjectPath("b1", 7), modelBoardRenderObjectPath("b1", 8));
});
