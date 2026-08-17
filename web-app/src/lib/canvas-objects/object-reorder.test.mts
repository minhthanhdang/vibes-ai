import { test } from "node:test";
import assert from "node:assert/strict";

import { reorderObjects } from "@/lib/canvas-objects/object-reorder";
import { PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

const HD = PAGE_PRESETS.LANDSCAPE_HD;

type Box = { x: number; y: number; width: number; height: number };

function pageFrame(id: string, box: Box, extra: object = {}): SceneElement {
  return { id, type: "frame", name: "Page 1", ...box, customData: { page: true }, ...extra };
}

function photo(id: string, box: Box, extra: object = {}): SceneElement {
  return { id, type: "image", fileId: "ref:ref-a", index: `a-${id}`, ...box, ...extra };
}

function words(id: string, text: string, box: Box, extra: object = {}): SceneElement {
  return { id, type: "text", text, index: `a-${id}`, ...box, ...extra };
}

function order(elements: readonly SceneElement[] | null): string[] {
  assert.ok(elements, "expected a rewritten scene");
  return elements.map((element) => element.id);
}

const BOX = { x: 3000, y: 3000, width: 100, height: 100 };

function looseTrio(): SceneElement[] {
  return [
    photo("a", { ...BOX, x: 3000 }),
    photo("b", { ...BOX, x: 3200 }),
    photo("c", { ...BOX, x: 3400 }),
  ];
}

test("front brings a loose object to the end of the array", () => {
  const result = reorderObjects(looseTrio(), [{ objectId: "a", to: "front" }]);

  assert.deepEqual(result.reordered, ["a"]);
  assert.deepEqual(order(result.elements), ["b", "c", "a"]);
});

test("back sends a loose object behind everything", () => {
  const result = reorderObjects(looseTrio(), [{ objectId: "c", to: "back" }]);
  assert.deepEqual(order(result.elements), ["c", "a", "b"]);
});

test("above and below land the object beside its target", () => {
  const above = reorderObjects(looseTrio(), [{ objectId: "a", to: { above: "b" } }]);
  assert.deepEqual(order(above.elements), ["b", "a", "c"]);

  const below = reorderObjects(looseTrio(), [{ objectId: "c", to: { below: "a" } }]);
  assert.deepEqual(order(below.elements), ["c", "a", "b"]);
});

/// The `index` rule, the bug most likely to look done and not be: a moved
/// element keeping its fractional index restores the old order at the next
/// editor mount, because restore trusts a present index over the array.
test("moved elements lose their fractional index; untouched ones keep theirs", () => {
  const result = reorderObjects(looseTrio(), [{ objectId: "a", to: "front" }]);

  const [b, c, a] = result.elements!;
  assert.equal("index" in a!, false);
  assert.equal(b!.index, "a-b");
  assert.equal(c!.index, "a-c");
});

test("a grouped element moves its whole group as one block, label riding along", () => {
  const result = reorderObjects(
    [
      photo("g-1", { ...BOX, x: 3000 }, { groupIds: ["g"] }),
      words("cap", "caption", { ...BOX, x: 3000, height: 20 }, { containerId: "g-1" }),
      photo("g-2", { ...BOX, x: 3200 }, { groupIds: ["g"] }),
      photo("z", { ...BOX, x: 3400 }),
    ],
    [{ objectId: "g-1", to: "front" }],
  );

  assert.deepEqual(order(result.elements), ["z", "g-1", "cap", "g-2"]);
  for (const id of ["g-1", "cap", "g-2"]) {
    assert.equal("index" in result.elements!.find((element) => element.id === id)!, false);
  }
});

test("below a grouped target lands before the target's whole block", () => {
  const result = reorderObjects(
    [
      photo("a", { ...BOX, x: 3000 }),
      photo("g-1", { ...BOX, x: 3200 }, { groupIds: ["g"] }),
      photo("g-2", { ...BOX, x: 3400 }, { groupIds: ["g"] }),
      photo("z", { ...BOX, x: 3600 }),
    ],
    [{ objectId: "z", to: { below: "g-2" } }],
  );
  assert.deepEqual(order(result.elements), ["a", "z", "g-1", "g-2"]);
});

/// A page's members stack among themselves, and the array's child-run
/// invariant holds afterwards: children immediately before their frame.
test("front for a page-held element is the front of its page's child run", () => {
  const result = reorderObjects(
    [
      photo("m-1", { x: 100, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
      photo("m-2", { x: 500, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
      pageFrame("p1", { x: 0, y: 0, ...HD }),
      photo("loose", { ...BOX }),
    ],
    [{ objectId: "m-1", to: "front" }],
  );

  assert.deepEqual(order(result.elements), ["m-2", "m-1", "p1", "loose"]);
});

test("back for a page-held element is the back of the child run, not the scene", () => {
  const result = reorderObjects(
    [
      photo("loose", { ...BOX }),
      photo("m-1", { x: 100, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
      photo("m-2", { x: 500, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
      pageFrame("p1", { x: 0, y: 0, ...HD }),
    ],
    [{ objectId: "m-2", to: "back" }],
  );

  assert.deepEqual(order(result.elements), ["loose", "m-2", "m-1", "p1"]);
});

test("front on the frontmost writes nothing", () => {
  const scene = looseTrio();
  const result = reorderObjects(scene, [{ objectId: "c", to: "front" }]);

  assert.equal(result.elements, null);
  assert.deepEqual(result.unchanged, ["c"]);
  assert.deepEqual(result.reordered, []);
});

test("front on a child already at the run's front is a no-op", () => {
  const result = reorderObjects(
    [
      photo("m-1", { x: 100, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
      photo("m-2", { x: 500, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
      pageFrame("p1", { x: 0, y: 0, ...HD }),
    ],
    [{ objectId: "m-2", to: "front" }],
  );
  assert.equal(result.elements, null);
  assert.deepEqual(result.unchanged, ["m-2"]);
});

test("tombstones keep their array positions", () => {
  const result = reorderObjects(
    [
      photo("a", { ...BOX, x: 3000 }),
      photo("gone", { ...BOX, x: 9000 }, { isDeleted: true }),
      photo("b", { ...BOX, x: 3200 }),
      photo("c", { ...BOX, x: 3400 }),
    ],
    [{ objectId: "a", to: "front" }],
  );

  assert.deepEqual(order(result.elements), ["b", "gone", "c", "a"]);
  assert.equal(result.elements![1]!.index, "a-gone");
});

test("pages are refused, both as the object and as the target", () => {
  const scene = [
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    photo("m-1", { x: 100, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
    pageFrame("p2", { x: 0, y: 2000, ...HD }),
  ];
  const result = reorderObjects(scene, [
    { objectId: "p1", to: "front" },
    { objectId: "m-1", to: { above: "p2" } },
  ]);

  assert.equal(result.elements, null);
  assert.equal(result.refused.length, 2);
  assert.match(result.refused[0]!.reason, /topmost-wins membership/);
  assert.match(result.refused[1]!.reason, /is a page/);
});

test("locked is refused — the element itself and a group with a locked member", () => {
  const result = reorderObjects(
    [
      photo("solo", { ...BOX, x: 3000 }, { locked: true }),
      photo("g-1", { ...BOX, x: 3200 }, { groupIds: ["g"] }),
      photo("g-2", { ...BOX, x: 3400 }, { groupIds: ["g"], locked: true }),
      photo("z", { ...BOX, x: 3600 }),
    ],
    [
      { objectId: "solo", to: "front" },
      { objectId: "g-1", to: "front" },
    ],
  );

  assert.equal(result.elements, null);
  assert.equal(result.refused[0]!.reason, "locked");
  assert.match(result.refused[1]!.reason, /locked/);
});

test("a bound label is refused toward its container", () => {
  const result = reorderObjects(
    [
      photo("holder", { ...BOX, x: 3000 }),
      words("cap", "caption", { ...BOX, x: 3000, height: 20 }, { containerId: "holder" }),
    ],
    [{ objectId: "cap", to: "front" }],
  );
  assert.equal(result.elements, null);
  assert.match(result.refused[0]!.reason, /holder/);
});

/// The read's `z` is per company — a page's members against each other, loose
/// objects against loose objects — so an order between two companies is a
/// number no read could say back.
test("above across companies is refused", () => {
  const result = reorderObjects(
    [
      photo("m-1", { x: 100, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
      pageFrame("p1", { x: 0, y: 0, ...HD }),
      photo("loose", { ...BOX }),
    ],
    [{ objectId: "loose", to: { above: "m-1" } }],
  );

  assert.equal(result.elements, null);
  assert.match(result.refused[0]!.reason, /different .*company/);
});

test("pageId scopes the call: members move, outsiders and unknown pages are refused", () => {
  const scene = () => [
    photo("m-1", { x: 100, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
    photo("m-2", { x: 500, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    photo("loose", { ...BOX }),
  ];

  const onPage = reorderObjects(scene(), [{ objectId: "m-1", to: "front" }], { pageId: "p1" });
  assert.deepEqual(order(onPage.elements), ["m-2", "m-1", "p1", "loose"]);

  const outsider = reorderObjects(scene(), [{ objectId: "loose", to: "front" }], {
    pageId: "p1",
  });
  assert.equal(outsider.elements, null);
  assert.match(outsider.refused[0]!.reason, /not on page p1/);

  const unknown = reorderObjects(scene(), [{ objectId: "m-1", to: "front" }], {
    pageId: "p-none",
  });
  assert.equal(unknown.elements, null);
  assert.match(unknown.refused[0]!.reason, /names no page/);
});

test("moves apply in order, each against the array the one before left", () => {
  const result = reorderObjects(looseTrio(), [
    { objectId: "c", to: { below: "b" } },
    { objectId: "a", to: { above: "c" } },
  ]);
  assert.deepEqual(order(result.elements), ["c", "a", "b"]);
  assert.deepEqual(result.reordered, ["c", "a"]);
});

test("an unreadable destination, a missing id and a missing target each land in their own bin", () => {
  const result = reorderObjects(looseTrio(), [
    { objectId: "a", to: "top" as never },
    { objectId: "ghost", to: "front" },
    { objectId: "b", to: { above: "ghost" } },
  ]);

  assert.equal(result.elements, null);
  assert.match(result.refused[0]!.reason, /unreadable destination/);
  assert.deepEqual(result.notFound, ["ghost"]);
  assert.match(result.refused[1]!.reason, /names nothing/);
});

test("ordering relative to its own group is refused", () => {
  const result = reorderObjects(
    [
      photo("g-1", { ...BOX, x: 3000 }, { groupIds: ["g"] }),
      photo("g-2", { ...BOX, x: 3200 }, { groupIds: ["g"] }),
    ],
    [{ objectId: "g-1", to: { above: "g-2" } }],
  );
  assert.equal(result.elements, null);
  assert.match(result.refused[0]!.reason, /moves with it/);
});
