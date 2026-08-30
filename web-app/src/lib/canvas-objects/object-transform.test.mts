import { test } from "node:test";
import assert from "node:assert/strict";

import { canvasObjects } from "@/lib/canvas-objects/object-read";
import { transformObjects } from "@/lib/canvas-objects/object-transform";
import { LAYOUT_TEXT_MIN_FONT, PAGE_PRESETS } from "@/lib/layout/moodboard-layouts";
import { setWidth } from "@/lib/render/text-set";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

const HD = PAGE_PRESETS.LANDSCAPE_HD;

type Box = { x: number; y: number; width: number; height: number };

function pageFrame(id: string, box: Box, extra: object = {}): SceneElement {
  return { id, type: "frame", name: "Page 1", ...box, customData: { page: true }, ...extra };
}

function photo(id: string, box: Box, extra: object = {}): SceneElement {
  return { id, type: "image", fileId: "ref:ref-a", ...box, ...extra };
}

function words(id: string, text: string, box: Box, extra: object = {}): SceneElement {
  return { id, type: "text", text, ...box, ...extra };
}

function byId(elements: readonly SceneElement[] | null, id: string): SceneElement {
  const found = elements?.find((element) => element.id === id);
  assert.ok(found, `no element ${id}`);
  return found;
}

test("a photo on a page moves by thousandths and lands on scene pixels", () => {
  const result = transformObjects(
    [
      photo("el-1", { x: 100, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
      pageFrame("p1", { x: 0, y: 0, ...HD }),
    ],
    [{ objectId: "el-1", to: [500, 250] }],
  );

  assert.deepEqual(result.transformed, ["el-1"]);
  const moved = byId(result.elements, "el-1");
  assert.equal(moved.x, 480);
  assert.equal(moved.y, 540);
  assert.equal(moved.width, 300);
  assert.equal(moved.height, 200);
  assert.equal(moved.frameId, "p1");
});

test("echoing the read's box back is a no-op that writes nothing", () => {
  const scene = [
    pageFrame("p1", { x: 0, y: 0, ...HD }),
    photo("el-1", { x: 100.3, y: 200.7, width: 300, height: 200 }),
  ];
  const read = canvasObjects(scene)!.find((object) => object.objectId === "el-1")!;
  const [ymin, xmin, ymax, xmax] = read.box;

  const result = transformObjects(scene, [
    { objectId: "el-1", to: [ymin, xmin], size: [ymax - ymin, xmax - xmin] },
  ]);

  assert.equal(result.elements, null);
  assert.deepEqual(result.unchanged, ["el-1"]);
});

test("a sub-threshold move is a no-op", () => {
  const result = transformObjects(
    [photo("loose", { x: 100, y: 100, width: 300, height: 200 })],
    [{ objectId: "loose", to: [100.3, 100.3] }],
  );
  assert.equal(result.elements, null);
  assert.deepEqual(result.unchanged, ["loose"]);
});

test("pages cannot rotate — the whole change is refused with the reason", () => {
  const result = transformObjects(
    [pageFrame("p1", { x: 0, y: 0, ...HD })],
    [{ objectId: "p1", to: [500, 500], angle: 15 }],
  );

  assert.equal(result.elements, null);
  assert.equal(result.refused.length, 1);
  assert.match(result.refused[0]!.reason, /cannot rotate/);
});

test("a page resize is refused toward resize_page", () => {
  const result = transformObjects(
    [pageFrame("p1", { x: 0, y: 0, ...HD })],
    [{ objectId: "p1", size: [1000, 1000] }],
  );
  assert.equal(result.elements, null);
  assert.match(result.refused[0]!.reason, /resize_page/);
});

test("locked is refused — the element itself, a locked page, and a group with a locked member", () => {
  const result = transformObjects(
    [
      photo("solo", { x: 0, y: 0, width: 100, height: 100 }, { locked: true }),
      photo("a", { x: 300, y: 0, width: 100, height: 100 }, { groupIds: ["g1"] }),
      words("cap", "caption", { x: 300, y: 110, width: 100, height: 20 }, {
        groupIds: ["g1"],
        locked: true,
      }),
      pageFrame("p-locked", { x: 3000, y: 0, ...HD }, { locked: true }),
    ],
    [
      { objectId: "solo", to: [500, 500] },
      { objectId: "a", to: [500, 500] },
      { objectId: "p-locked", to: [500, 5000] },
    ],
  );

  assert.equal(result.elements, null);
  assert.deepEqual(
    result.refused.map((entry) => entry.objectId),
    ["solo", "a", "p-locked"],
  );
  assert.equal(result.refused[0]!.reason, "locked");
  assert.match(result.refused[1]!.reason, /locked/);
});

test("a grouped element transforms its whole group rigidly", () => {
  const result = transformObjects(
    [
      photo("a", { x: 0, y: 0, width: 100, height: 100 }, { groupIds: ["g1"] }),
      words("cap", "caption", { x: 0, y: 110, width: 100, height: 20 }, {
        groupIds: ["g1"],
        fontSize: 10,
      }),
    ],
    [{ objectId: "a", to: [300, 200], size: [200, 200] }],
  );

  const a = byId(result.elements, "a");
  assert.deepEqual([a.x, a.y, a.width, a.height], [200, 300, 200, 200]);
  const cap = byId(result.elements, "cap");
  assert.deepEqual([cap.x, cap.y, cap.width, cap.height], [200, 520, 200, 40]);
  assert.equal(cap.fontSize, 20);
  assert.deepEqual(result.transformed, ["a"]);
});

test("text resize is fontSize scaling with the box following", () => {
  const result = transformObjects(
    [words("t", "hello", { x: 10, y: 20, width: 200, height: 50 }, { fontSize: 20 })],
    [{ objectId: "t", size: [100, 400] }],
  );

  const scaled = byId(result.elements, "t");
  assert.deepEqual([scaled.width, scaled.height, scaled.fontSize], [400, 100, 40]);
});

test("a line scaled under the floor stops there and the shortfall is said", () => {
  const result = transformObjects(
    [words("t", "hello", { x: 10, y: 20, width: 200, height: 50 }, { fontSize: 20 })],
    [{ objectId: "t", size: [10, 40] }],
  );

  const scaled = byId(result.elements, "t");
  assert.equal(scaled.fontSize, LAYOUT_TEXT_MIN_FONT);
  assert.equal(scaled.width, 40);
  assert.deepEqual(result.clamped, [{ objectId: "t", asked: 4, set: LAYOUT_TEXT_MIN_FONT }]);
});

test("no scale can round a line's type to zero", () => {
  const result = transformObjects(
    [words("t", "hello", { x: 0, y: 0, width: 1000, height: 100 }, { fontSize: 12 })],
    [{ objectId: "t", size: [2, 20] }],
  );

  assert.equal(byId(result.elements, "t").fontSize, LAYOUT_TEXT_MIN_FONT);
});

test("a floored block breaks again to its narrower box and stands to the block", () => {
  const copy =
    "Each lot is test-profiled in three-kilo micro-batches to isolate origin character before it is released to the counter.";
  const result = transformObjects(
    [
      words("t", copy, { x: 0, y: 0, width: 600, height: 60 }, {
        fontSize: 20,
        originalText: copy,
        autoResize: false,
      }),
    ],
    [{ objectId: "t", size: [30, 300] }],
  );

  const scaled = byId(result.elements, "t");
  const lines = String(scaled.text).split("\n");
  assert.ok(lines.length > 1, "the copy broke");
  for (const line of lines) {
    assert.ok(
      setWidth(line, LAYOUT_TEXT_MIN_FONT) <= 300,
      `"${line}" sets wider than the box it was broken to`,
    );
  }
  assert.ok(Number(scaled.height) > 30, "the block stands taller than the box the scale asked for");
  assert.equal(scaled.originalText, copy);
});

test("a block that sizes itself keeps its breaks and takes only the floor's height", () => {
  const result = transformObjects(
    [
      words("t", "one\ntwo", { x: 0, y: 0, width: 400, height: 80 }, { fontSize: 40 }),
    ],
    [{ objectId: "t", size: [8, 40] }],
  );

  const scaled = byId(result.elements, "t");
  assert.equal(scaled.fontSize, LAYOUT_TEXT_MIN_FONT);
  assert.equal(scaled.text, "one\ntwo");
  assert.ok(Number(scaled.height) > 8);
});

test("a bound label takes the floor without its breaks being touched", () => {
  const result = transformObjects(
    [
      photo("box", { x: 0, y: 0, width: 400, height: 400 }, { groupIds: ["g1"] }),
      words("lab", "a label long enough to break", { x: 0, y: 0, width: 400, height: 60 }, {
        containerId: "box",
        fontSize: 40,
        autoResize: false,
        groupIds: ["g1"],
      }),
    ],
    [{ objectId: "box", size: [40, 40] }],
  );

  const label = byId(result.elements, "lab");
  assert.equal(label.fontSize, LAYOUT_TEXT_MIN_FONT);
  assert.equal(label.text, "a label long enough to break");
});

test("a floored caption in a group is named by its own id", () => {
  const result = transformObjects(
    [
      photo("a", { x: 0, y: 0, width: 100, height: 100 }, { groupIds: ["g1"] }),
      words("cap", "caption", { x: 0, y: 110, width: 100, height: 20 }, {
        groupIds: ["g1"],
        fontSize: 20,
      }),
    ],
    [{ objectId: "a", to: [0, 0], size: [20, 20] }],
  );

  assert.deepEqual(result.transformed, ["a"]);
  assert.deepEqual(result.clamped, [{ objectId: "cap", asked: 4, set: LAYOUT_TEXT_MIN_FONT }]);
});

test("type that clears the floor is scaled and nothing else about it moves", () => {
  const result = transformObjects(
    [
      words("t", "one\ntwo", { x: 0, y: 0, width: 400, height: 80 }, {
        fontSize: 40,
        originalText: "one\ntwo",
        autoResize: false,
      }),
    ],
    [{ objectId: "t", size: [40, 200] }],
  );

  const scaled = byId(result.elements, "t");
  assert.deepEqual(
    [scaled.width, scaled.height, scaled.fontSize, scaled.text],
    [200, 40, 20, "one\ntwo"],
  );
  assert.deepEqual(result.clamped, []);
});

test("an image keeps its aspect unless the call stretches it", () => {
  const contained = transformObjects(
    [photo("img", { x: 50, y: 60, width: 400, height: 300 })],
    [{ objectId: "img", size: [150, 400] }],
  );
  const kept = byId(contained.elements, "img");
  assert.deepEqual([kept.width, kept.height], [200, 150]);

  const stretched = transformObjects(
    [photo("img", { x: 50, y: 60, width: 400, height: 300 })],
    [{ objectId: "img", size: [150, 400], stretch: true }],
  );
  const exact = byId(stretched.elements, "img");
  assert.deepEqual([exact.width, exact.height], [400, 150]);
});

test("stretch is refused for text and for groups", () => {
  const result = transformObjects(
    [
      words("t", "hello", { x: 0, y: 0, width: 200, height: 50 }),
      photo("a", { x: 300, y: 0, width: 100, height: 100 }, { groupIds: ["g1"] }),
      photo("b", { x: 450, y: 0, width: 100, height: 100 }, { groupIds: ["g1"] }),
    ],
    [
      { objectId: "t", size: [100, 400], stretch: true },
      { objectId: "a", size: [200, 200], stretch: true },
    ],
  );
  assert.equal(result.refused.length, 2);
  assert.match(result.refused[0]!.reason, /lone picture or shape/);
});

test("moved off its page, an element's frameId is released toward geometry", () => {
  const result = transformObjects(
    [
      photo("el-1", { x: 100, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
      pageFrame("p1", { x: 0, y: 0, ...HD }),
    ],
    [{ objectId: "el-1", to: [0, 1500] }],
  );

  const off = byId(result.elements, "el-1");
  assert.equal(off.x, 2880);
  assert.equal(off.frameId, null);
});

test("moved onto a page, an element is adopted and lands in the page's child run", () => {
  const result = transformObjects(
    [
      pageFrame("p1", { x: 0, y: 0, ...HD }),
      photo("loose", { x: 2500, y: 100, width: 300, height: 200 }),
    ],
    [{ objectId: "loose", to: [100, 100] }],
  );

  const adopted = byId(result.elements, "loose");
  assert.equal(adopted.frameId, "p1");
  assert.deepEqual(
    result.elements!.map((element) => element.id),
    ["loose", "p1"],
  );
});

test("a section's photo moved on the canvas keeps its section", () => {
  const result = transformObjects(
    [
      { id: "sec", type: "frame", x: 0, y: 0, width: 500, height: 500 },
      photo("owned", { x: 100, y: 100, width: 200, height: 200 }, { frameId: "sec" }),
    ],
    [{ objectId: "owned", to: [800, 800] }],
  );

  assert.equal(byId(result.elements, "owned").frameId, "sec");
});

test("a moved page carries its geometric members and leaves the rest", () => {
  const result = transformObjects(
    [
      pageFrame("p1", { x: 0, y: 0, ...HD }),
      photo("m1", { x: 100, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
      photo("m2", { x: 500, y: 500, width: 300, height: 200 }),
      photo("elsewhere", { x: 9000, y: 100, width: 300, height: 200 }),
    ],
    [{ objectId: "p1", to: [2000, 5000] }],
  );

  assert.deepEqual(result.transformed, ["p1"]);
  const page = byId(result.elements, "p1");
  assert.deepEqual([page.x, page.y], [5000, 2000]);
  const carried = byId(result.elements, "m1");
  assert.deepEqual([carried.x, carried.y], [5100, 2100]);
  const geometric = byId(result.elements, "m2");
  assert.deepEqual([geometric.x, geometric.y], [5500, 2500]);
  const left = byId(result.elements, "elsewhere");
  assert.deepEqual([left.x, left.y], [9000, 100]);
});

test("a page and one of its members cannot both move in one call", () => {
  const result = transformObjects(
    [
      pageFrame("p1", { x: 0, y: 0, ...HD }),
      photo("m1", { x: 100, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
    ],
    [
      { objectId: "p1", to: [2000, 5000] },
      { objectId: "m1", to: [0, 0] },
    ],
  );

  assert.deepEqual(result.transformed, ["p1"]);
  assert.equal(result.refused.length, 1);
  assert.equal(result.refused[0]!.objectId, "m1");
  assert.match(result.refused[0]!.reason, /already transformed/);
});

test("a rotation lands in radians, and a group spins about its shared centre", () => {
  const lone = transformObjects(
    [photo("img", { x: 50, y: 60, width: 100, height: 100 })],
    [{ objectId: "img", angle: 90 }],
  );
  const turned = byId(lone.elements, "img");
  assert.ok(Math.abs((turned.angle as number) - Math.PI / 2) < 1e-9);
  assert.deepEqual([turned.x, turned.y], [50, 60]);

  const grouped = transformObjects(
    [
      photo("a", { x: 0, y: 0, width: 100, height: 100 }, { groupIds: ["g1"] }),
      photo("b", { x: 200, y: 0, width: 100, height: 100 }, { groupIds: ["g1"] }),
    ],
    [{ objectId: "a", angle: 180 }],
  );
  const a = byId(grouped.elements, "a");
  const b = byId(grouped.elements, "b");
  assert.deepEqual([a.x, a.y], [200, 0]);
  assert.deepEqual([b.x, b.y], [0, 0]);
  assert.ok(Math.abs((a.angle as number) - Math.PI) < 1e-9);
  assert.ok(Math.abs((b.angle as number) - Math.PI) < 1e-9);
});

test("echoing the read's angle back rotates nothing", () => {
  const result = transformObjects(
    [photo("img", { x: 0, y: 0, width: 100, height: 100 }, { angle: Math.PI / 4 })],
    [{ objectId: "img", angle: 45 }],
  );
  assert.equal(result.elements, null);
  assert.deepEqual(result.unchanged, ["img"]);
});

test("an unknown id, a tombstone and a section frame are not objects on this canvas", () => {
  const result = transformObjects(
    [
      photo("gone", { x: 0, y: 0, width: 100, height: 100 }, { isDeleted: true }),
      { id: "sec", type: "frame", x: 0, y: 0, width: 500, height: 500 },
    ],
    [
      { objectId: "ghost", to: [0, 0] },
      { objectId: "gone", to: [0, 0] },
      { objectId: "sec", to: [0, 0] },
    ],
  );

  assert.equal(result.elements, null);
  assert.deepEqual(result.notFound, ["ghost", "gone", "sec"]);
});

test("a bound label is refused toward its container", () => {
  const result = transformObjects(
    [
      { id: "rect-1", type: "rectangle", x: 0, y: 0, width: 200, height: 100 },
      words("label", "title", { x: 10, y: 10, width: 180, height: 30 }, {
        containerId: "rect-1",
      }),
    ],
    [{ objectId: "label", to: [500, 500] }],
  );

  assert.equal(result.elements, null);
  assert.match(result.refused[0]!.reason, /rect-1/);
});

test("a change asking for nothing is reported unchanged, not dropped", () => {
  const result = transformObjects(
    [photo("img", { x: 0, y: 0, width: 100, height: 100 })],
    [{ objectId: "img" }],
  );
  assert.equal(result.elements, null);
  assert.deepEqual(result.unchanged, ["img"]);
});

test("an unreadable number refuses the change rather than guessing", () => {
  const result = transformObjects(
    [photo("img", { x: 0, y: 0, width: 100, height: 100 })],
    [
      { objectId: "img", to: [Number.NaN, 0] },
      { objectId: "img", size: [0, 100] },
    ],
  );
  assert.equal(result.elements, null);
  assert.equal(result.refused.length, 2);
});

function shape(id: string, type: string, box: Box, extra: object = {}): SceneElement {
  return { id, type, ...box, ...extra };
}

test("a shape moves by the dialect its read box was in", () => {
  const result = transformObjects(
    [
      shape("s1", "rectangle", { x: 100, y: 100, width: 300, height: 200 }, { frameId: "p1" }),
      pageFrame("p1", { x: 0, y: 0, ...HD }),
    ],
    [{ objectId: "s1", to: [500, 250] }],
  );

  assert.deepEqual(result.transformed, ["s1"]);
  assert.deepEqual(result.notFound, []);
  const moved = byId(result.elements, "s1");
  assert.equal(moved.x, 480);
  assert.equal(moved.y, 540);
});

test("a lone shape takes the size asked exactly, with no aspect kept", () => {
  const result = transformObjects(
    [
      shape("s1", "rectangle", { x: 0, y: 0, width: 300, height: 300 }, { frameId: "p1" }),
      pageFrame("p1", { x: 0, y: 0, ...HD }),
    ],
    [{ objectId: "s1", to: [0, 0], size: [1000, 1000] }],
  );

  const grown = byId(result.elements, "s1");
  assert.equal(grown.width, HD.width);
  assert.equal(grown.height, HD.height);
});

test("a photo at the same ask is still contained, never reshaped", () => {
  const result = transformObjects(
    [
      photo("el-1", { x: 0, y: 0, width: 300, height: 300 }, { frameId: "p1" }),
      pageFrame("p1", { x: 0, y: 0, ...HD }),
    ],
    [{ objectId: "el-1", to: [0, 0], size: [1000, 1000] }],
  );

  const grown = byId(result.elements, "el-1");
  assert.equal(grown.width, HD.height);
  assert.equal(grown.height, HD.height);
});

test("a flat rule moves and lengthens, points scaled with the box", () => {
  const result = transformObjects(
    [
      shape(
        "rule",
        "line",
        { x: 100, y: 500, width: 400, height: 0 },
        {
          frameId: "p1",
          points: [
            [0, 0],
            [400, 0],
          ],
        },
      ),
      pageFrame("p1", { x: 0, y: 0, ...HD }),
    ],
    [{ objectId: "rule", to: [500, 0], size: [0, 1000] }],
  );

  assert.deepEqual(result.notFound, []);
  const stretched = byId(result.elements, "rule");
  assert.equal(stretched.x, 0);
  assert.equal(stretched.width, HD.width);
  assert.equal(stretched.height, 0);
  assert.deepEqual(stretched.points, [
    [0, 0],
    [HD.width, 0],
  ]);
});

test("a grouped shape scales uniformly with the group it is in", () => {
  const result = transformObjects(
    [
      shape("s1", "rectangle", { x: 0, y: 0, width: 100, height: 100 }, { groupIds: ["g1"] }),
      photo("a", { x: 100, y: 0, width: 100, height: 100 }, { groupIds: ["g1"] }),
    ],
    [{ objectId: "s1", size: [400, 400] }],
  );

  assert.deepEqual(result.transformed, ["s1"]);
  const block = byId(result.elements, "s1");
  assert.equal(block.width, block.height);
});

test("a diamond has no handle in the read and none here either", () => {
  const result = transformObjects(
    [shape("d1", "diamond", { x: 0, y: 0, width: 100, height: 100 })],
    [{ objectId: "d1", to: [10, 10] }],
  );

  assert.deepEqual(result.notFound, ["d1"]);
  assert.deepEqual(
    canvasObjects([shape("d1", "diamond", { x: 0, y: 0, width: 100, height: 100 })])!.map(
      (object) => object.objectId,
    ),
    [],
  );
});

test("a bound label is still refused toward its container, not answered notFound", () => {
  const result = transformObjects(
    [
      shape("box", "rectangle", { x: 0, y: 0, width: 200, height: 100 }),
      words("lbl", "#aabbcc", { x: 10, y: 10, width: 80, height: 20 }, { containerId: "box" }),
    ],
    [{ objectId: "lbl", to: [0, 0] }],
  );

  assert.deepEqual(result.notFound, []);
  assert.equal(result.refused.length, 1);
  assert.match(result.refused[0]!.reason, /travels with its container/);
});

test("a page's ground does not move and does not resize — it is the page, refused by name", () => {
  const box = { x: 0, y: 0, ...HD };
  const ground = {
    id: "ground",
    type: "rectangle",
    ...box,
    backgroundColor: "#0c111c",
    locked: true,
    customData: { pageBackground: true },
  } as unknown as SceneElement;

  const result = transformObjects([ground, pageFrame("p1", box)], [
    { objectId: "ground", to: [200, 200] },
  ]);
  assert.equal(result.elements, null);
  assert.deepEqual(result.notFound, [], "refused with the reason rather than answered no such id");
  assert.match(result.refused[0]!.reason, /set_page_background/);
});
