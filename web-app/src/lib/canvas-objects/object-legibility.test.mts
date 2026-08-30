import { test } from "node:test";
import assert from "node:assert/strict";

import { legibilityChange } from "@/lib/canvas-objects/object-legibility";
import { putObjects } from "@/lib/canvas-objects/object-put";
import { restyleObjects } from "@/lib/canvas-objects/object-restyle";
import { PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

const HD = PAGE_PRESETS.LANDSCAPE_HD;

type Box = { x: number; y: number; width: number; height: number };

function pageFrame(id: string, box: Box, extra: object = {}): SceneElement {
  return { id, type: "frame", name: "Page 1", ...box, customData: { page: true }, ...extra };
}

function ground(id: string, pageId: string, page: Box, colour: string): SceneElement {
  return {
    id,
    type: "rectangle",
    ...page,
    frameId: pageId,
    backgroundColor: colour,
    strokeColor: "transparent",
    fillStyle: "solid",
    customData: { pageBackground: true },
  };
}

function words(id: string, text: string, box: Box, colour: string): SceneElement {
  return {
    id,
    type: "text",
    text,
    autoResize: false,
    ...box,
    fontSize: 40,
    strokeColor: colour,
  };
}

const PAGE: Box = { x: 0, y: 0, ...HD };
const HEADLINE: Box = { x: 100, y: 100, width: 600, height: 60 };

test("type put onto ground it cannot be read on is named back to the caller", () => {
  const before: SceneElement[] = [pageFrame("p1", PAGE), ground("bg", "p1", PAGE, "#101418")];
  const after = [...before, words("t1", "Autumn", HEADLINE, "#1e2329")];

  const { arrived } = legibilityChange(before, after);
  assert.equal(arrived.length, 1);
  assert.equal(arrived[0]!.textId, "t1");
  assert.equal(arrived[0]!.ground, "#101418");
  assert.ok(arrived[0]!.ratio < arrived[0]!.wants);
});

test("a pair that was already failing is not this write's doing and is not said", () => {
  const before: SceneElement[] = [
    pageFrame("p1", PAGE),
    ground("bg", "p1", PAGE, "#101418"),
    words("t1", "Autumn", HEADLINE, "#1e2329"),
  ];
  const after = [...before, words("t2", "Winter", { x: 100, y: 400, width: 600, height: 60 }, "#ffffff")];

  assert.deepEqual(legibilityChange(before, after).arrived, []);
});

test("repainting the block under type that was already there is the write that did it", () => {
  const block: SceneElement = {
    id: "block",
    type: "rectangle",
    x: 50,
    y: 50,
    width: 900,
    height: 900,
    backgroundColor: "#ffffff",
    fillStyle: "solid",
    strokeColor: "transparent",
  };
  const before: SceneElement[] = [
    pageFrame("p1", PAGE),
    block,
    words("t1", "Autumn", HEADLINE, "#2b2b2b"),
    words("t2", "Winter", { x: 100, y: 400, width: 600, height: 60 }, "#2b2b2b"),
  ];
  const edit = restyleObjects(before, [{ objectId: "block", fill: "#333333" }]);
  assert.ok(edit.elements);

  const { arrived } = legibilityChange(before, edit.elements);
  assert.deepEqual(arrived.map((pair) => pair.textId).sort(), ["t1", "t2"]);
});

test("a page nobody wrote to yields nothing, however badly it already reads", () => {
  const other: Box = { x: 3000, y: 0, ...HD };
  const before: SceneElement[] = [
    pageFrame("p1", PAGE),
    ground("bg", "p1", PAGE, "#101418"),
    words("t1", "Autumn", HEADLINE, "#1e2329"),
    pageFrame("p2", other),
    ground("bg2", "p2", other, "#101418"),
  ];
  const after = [
    ...before,
    words("t2", "Winter", { x: 3100, y: 100, width: 600, height: 60 }, "#1e2329"),
  ];

  assert.deepEqual(
    legibilityChange(before, after).arrived.map((pair) => pair.textId),
    ["t2"],
  );
});

test("a bound label is never named, however badly it reads", () => {
  const before: SceneElement[] = [pageFrame("p1", PAGE), ground("bg", "p1", PAGE, "#101418")];
  const swatch: SceneElement = {
    id: "swatch",
    type: "rectangle",
    x: 100,
    y: 100,
    width: 300,
    height: 300,
    backgroundColor: "#101418",
    fillStyle: "solid",
    strokeColor: "transparent",
  };
  const label: SceneElement = {
    ...words("label", "#101418", { x: 120, y: 200, width: 260, height: 40 }, "#1e2329"),
    containerId: "swatch",
  };

  assert.deepEqual(legibilityChange(before, [...before, swatch, label]).arrived, []);
});

test("a page with no ground of its own is read against the board's colour", () => {
  const before: SceneElement[] = [pageFrame("p1", PAGE)];
  const after = [...before, words("t1", "Autumn", HEADLINE, "#2c3234")];

  assert.deepEqual(legibilityChange(before, after, { background: "#ffffff" }).arrived, []);
  const dark = legibilityChange(before, after, { background: "#2b3136" }).arrived;
  assert.equal(dark.length, 1);
  assert.equal(dark[0]!.ground, "#2b3136");
});

test("the worst pair is said first", () => {
  const before: SceneElement[] = [pageFrame("p1", PAGE), ground("bg", "p1", PAGE, "#101418")];
  const edit = putObjects(
    before,
    [
      { kind: "text", pageId: "p1", text: "Nearly", box: [100, 100, 160, 700], colour: "#3c4550" },
      { kind: "text", pageId: "p1", text: "Barely", box: [400, 100, 460, 700], colour: "#12161a" },
    ],
    { defaultSize: HD, sizeOf: () => undefined },
  );
  assert.ok(edit.elements);

  const ratios = legibilityChange(before, edit.elements).arrived.map((pair) => pair.ratio);
  assert.equal(ratios.length, 2);
  assert.ok(ratios[0]! < ratios[1]!);
});
