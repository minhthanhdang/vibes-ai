import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAPTION_GAP,
  CAPTION_MAX_FONT,
  CAPTION_MAX_LENGTH,
  CAPTION_MIN_FONT,
  captionCentre,
  captionFontSize,
  captionPlacement,
  captionText,
  captionablePhotos,
} from "@/lib/canvas/moodboard-caption";
import { arrangeableUnits } from "@/lib/canvas/moodboard-arrange";

test("a caption is set in proportion to the photo, within readable bounds", () => {
  assert.equal(captionFontSize(320), 20);
  assert.equal(captionFontSize(60), CAPTION_MIN_FONT);
  assert.equal(captionFontSize(6000), CAPTION_MAX_FONT);
  assert.equal(captionFontSize(0), CAPTION_MIN_FONT);
  assert.equal(captionFontSize(Number.NaN), CAPTION_MIN_FONT);
});

test("a caption is one line, trimmed, and short enough not to widen the photo", () => {
  assert.equal(captionText("  act two \n the hallway  "), "act two the hallway");
  assert.equal(captionText("   "), null);
  assert.equal(captionText(""), null);

  const long = captionText("x".repeat(200));
  assert.ok(long);
  assert.equal(long.length, CAPTION_MAX_LENGTH);
  assert.ok(long.endsWith("…"));
});

test("it lands under the photo and is centred once the editor has measured it", () => {
  const photo = { x: 100, y: 50, width: 320, height: 200 };

  assert.deepEqual(captionPlacement(photo), {
    x: 100,
    y: 50 + 200 + CAPTION_GAP,
    fontSize: 20,
  });
  assert.equal(captionCentre(photo, 120), 100 + (320 - 120) / 2);
});

test("only a selected, unlocked, ungrouped photo is offered a caption", () => {
  const elements = [
    { id: "plain", type: "image", x: 0, y: 0, width: 10, height: 10 },
    { id: "pinned", type: "image", locked: true, x: 0, y: 0, width: 10, height: 10 },
    { id: "already", type: "image", groupIds: ["g"], x: 0, y: 0, width: 10, height: 10 },
    { id: "gone", type: "image", isDeleted: true, x: 0, y: 0, width: 10, height: 10 },
    { id: "note", type: "text", x: 0, y: 0, width: 10, height: 10 },
  ];
  const all = Object.fromEntries(elements.map((element) => [element.id, true]));

  assert.equal(captionablePhotos(elements, { selectedElementIds: all }), 1);
  assert.equal(captionablePhotos(elements, { selectedElementIds: {} }), 0);
  assert.equal(captionablePhotos(elements, { selectedElementIds: { plain: false } }), 0);
});

test("a captioned photo reads back as one unit the tidy carries whole", () => {
  const photo = { id: "p", type: "image", fileId: "ref:r1", x: 0, y: 0, width: 320, height: 200 };
  const { x, y, fontSize } = captionPlacement(photo);
  const groupId = "g1";

  const units = arrangeableUnits([
    { ...photo, groupIds: [groupId] },
    {
      id: "c",
      type: "text",
      groupIds: [groupId],
      x: captionCentre(photo, 140),
      y,
      width: 140,
      height: fontSize * 1.25,
      fontSize,
    },
  ]);

  assert.equal(units.length, 1);
  assert.equal(units[0]!.id, groupId);
  assert.deepEqual(units[0]!.members?.map((member) => member.id), ["p", "c"]);
  assert.equal(units[0]!.referenceId, "r1");
  assert.equal(x, 0);
  assert.ok(units[0]!.height > photo.height);
});
