import { test } from "node:test";
import assert from "node:assert/strict";

import { SIDEBAR_MAX_WIDTH, SIDEBAR_RAIL_WIDTH } from "./sidebar";
import {
  SECOND_LEVEL_DEFAULT_WIDTH,
  SECOND_LEVEL_GUTTER,
  SECOND_LEVEL_MAX_WIDTH,
  nextSecondLevelSelection,
  resolveSecondLevelSelection,
  secondLevelPlacement,
} from "./second-level-sidebar";

test("the panel sits against the sidebar's inner edge, not against the window", () => {
  assert.deepEqual(secondLevelPlacement({ isOpen: true, width: 360 }, 1440), {
    right: 360,
    width: SECOND_LEVEL_MAX_WIDTH,
  });
});

test("a collapsed sidebar leaves only its rail between the panel and the edge", () => {
  assert.deepEqual(secondLevelPlacement({ isOpen: false, width: 360 }, 1440), {
    right: SIDEBAR_RAIL_WIDTH,
    width: SECOND_LEVEL_MAX_WIDTH,
  });
});

test("a stored sidebar width past the maximum cannot push the panel off screen", () => {
  const { right } = secondLevelPlacement({ isOpen: true, width: 9999 }, 1440);
  assert.equal(right, SIDEBAR_MAX_WIDTH);
});

test("a mid-size window gives the panel what is left minus the gutter", () => {
  assert.deepEqual(secondLevelPlacement({ isOpen: true, width: 360 }, 760), {
    right: 360,
    width: 760 - 360 - SECOND_LEVEL_GUTTER,
  });
});

test("too little room left over and the panel covers the sidebar rather than slivering", () => {
  assert.deepEqual(secondLevelPlacement({ isOpen: true, width: 360 }, 600), {
    right: 0,
    width: 600,
  });
});

test("an unmeasured viewport renders a readable panel instead of a zero-width one", () => {
  for (const viewport of [0, Number.NaN, -100]) {
    assert.deepEqual(secondLevelPlacement({ isOpen: true, width: 360 }, viewport), {
      right: 360,
      width: SECOND_LEVEL_DEFAULT_WIDTH,
    });
  }
});

test("clicking the open reference closes the panel, clicking another swaps it", () => {
  assert.equal(nextSecondLevelSelection(null, "a"), "a");
  assert.equal(nextSecondLevelSelection("a", "b"), "b");
  assert.equal(nextSecondLevelSelection("a", "a"), null);
});

test("the panel closes when the reference it is showing leaves the gallery", () => {
  const gallery = [{ id: "a" }, { id: "b" }];
  assert.equal(resolveSecondLevelSelection("a", gallery), "a");
  assert.equal(resolveSecondLevelSelection("c", gallery), null);
  assert.equal(resolveSecondLevelSelection("a", []), null);
  assert.equal(resolveSecondLevelSelection(null, gallery), null);
});
