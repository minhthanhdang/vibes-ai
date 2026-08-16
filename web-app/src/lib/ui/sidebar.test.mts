import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SIDEBAR_DEFAULT_STATE,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_RAIL_WIDTH,
  clampSidebarWidth,
  parseSidebarState,
  serializeSidebarState,
  sidebarPageWidth,
  widthAfterDrag,
} from "@/lib/ui/sidebar";

test("width is held between the readable minimum and the grid-crushing maximum", () => {
  assert.equal(clampSidebarWidth(400), 400);
  assert.equal(clampSidebarWidth(10), SIDEBAR_MIN_WIDTH);
  assert.equal(clampSidebarWidth(4000), SIDEBAR_MAX_WIDTH);
});

test("a width that is not a number falls back to the default rather than to zero", () => {
  assert.equal(clampSidebarWidth(Number.NaN), SIDEBAR_DEFAULT_WIDTH);
  assert.equal(clampSidebarWidth(Number.POSITIVE_INFINITY), SIDEBAR_DEFAULT_WIDTH);
  assert.equal(clampSidebarWidth(360.4), 360);
});

test("dragging the handle left widens the sidebar and right narrows it", () => {
  assert.equal(widthAfterDrag(360, 900, 800), 460);
  assert.equal(widthAfterDrag(360, 900, 940), 320);
});

test("a drag past either end stops at the bound instead of inverting", () => {
  assert.equal(widthAfterDrag(360, 900, 0), SIDEBAR_MAX_WIDTH);
  assert.equal(widthAfterDrag(360, 900, 1600), SIDEBAR_MIN_WIDTH);
});

test("a collapsed sidebar still takes the rail, so the expand button stays reachable", () => {
  assert.equal(sidebarPageWidth({ isOpen: true, width: 420 }), 420);
  assert.equal(sidebarPageWidth({ isOpen: false, width: 420 }), SIDEBAR_RAIL_WIDTH);
});

test("nothing stored means the default state", () => {
  assert.deepEqual(parseSidebarState(null), SIDEBAR_DEFAULT_STATE);
  assert.deepEqual(parseSidebarState(""), SIDEBAR_DEFAULT_STATE);
});

test("junk in storage degrades to the default instead of throwing", () => {
  assert.deepEqual(parseSidebarState("{not json"), SIDEBAR_DEFAULT_STATE);
  assert.deepEqual(parseSidebarState("null"), SIDEBAR_DEFAULT_STATE);
  assert.deepEqual(parseSidebarState("42"), SIDEBAR_DEFAULT_STATE);
});

test("a half-written or out-of-range stored state keeps the parts that make sense", () => {
  assert.deepEqual(parseSidebarState('{"isOpen":false}'), {
    isOpen: false,
    width: SIDEBAR_DEFAULT_WIDTH,
  });
  assert.deepEqual(parseSidebarState('{"width":"wide"}'), SIDEBAR_DEFAULT_STATE);
  assert.deepEqual(parseSidebarState('{"isOpen":true,"width":9000}'), {
    isOpen: true,
    width: SIDEBAR_MAX_WIDTH,
  });
});

test("a state survives a round trip through storage", () => {
  const state = { isOpen: false, width: 420 };

  assert.deepEqual(parseSidebarState(serializeSidebarState(state)), state);
});
