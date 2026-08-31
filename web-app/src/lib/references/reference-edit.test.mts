import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cropEdit,
  cropOf,
  cropPlan,
  editBox,
  editShape,
  editVerb,
  existingEdit,
  versionCredit,
} from "@/lib/references/reference-edit";
import { cropBoxOf } from "@/lib/references/reference-version";
import type { EditOp } from "@/lib/edit/edit-ops";

const box = (ymin: number, xmin: number, ymax: number, xmax: number) => [ymin, xmin, ymax, xmax];

const cut = (
  ymin: number,
  xmin: number,
  ymax: number,
  xmax: number,
  shape?: string,
): EditOp[] => [{ op: "crop", box: [ymin, xmin, ymax, xmax], ...(shape && { shape }) }];

const TURN: EditOp = { op: "turn", turn: "right" };

const GRADE: EditOp = {
  op: "grade",
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 30,
  hue: 0,
};

test("a row's crop is read out of the list, whatever else is in it", () => {
  assert.deepEqual(cropOf([TURN, ...cut(100, 200, 800, 900)]), {
    op: "crop",
    box: [100, 200, 800, 900],
  });
  assert.deepEqual(editBox(cut(100, 200, 800, 900)), [100, 200, 800, 900]);
  assert.equal(editBox([TURN]), null);
  assert.equal(editBox([]), null);
  assert.equal(editBox(null), null);
});

test("the shape a cut was held to sits on the crop, not on the row", () => {
  assert.equal(editShape(cut(0, 0, 500, 500, "16:9")), "16:9");
  assert.equal(editShape(cut(0, 0, 500, 500)), "");
  assert.equal(editShape([GRADE]), "");
});

test("a box drawn by hand becomes a one-op list", () => {
  assert.deepEqual(cropEdit(cropBoxOf(box(100, 200, 800, 900))!), [
    { op: "crop", box: [100, 200, 800, 900] },
  ]);
  assert.deepEqual(cropEdit(cropBoxOf(box(100, 200, 800, 900))!, "square"), [
    { op: "crop", box: [100, 200, 800, 900], shape: "square" },
  ]);
  assert.deepEqual(cropEdit(cropBoxOf(box(0, 0, 500, 500))!, null), [
    { op: "crop", box: [0, 0, 500, 500] },
  ]);
});

test("a version is credited by what was actually done to it", () => {
  assert.equal(editVerb(cut(0, 0, 500, 500)), "Cropped");
  assert.equal(editVerb([TURN]), "Turned");
  assert.equal(editVerb([{ op: "flip", axis: "both" }]), "Flipped");
  assert.equal(editVerb([GRADE]), "Graded");
  assert.equal(editVerb([...cut(0, 0, 500, 500), GRADE]), "Edited");
  assert.equal(editVerb([]), "Edited");
});

test("a plan is the cut, the name it is filed under, the box it came from and why", () => {
  const plan = cropPlan({
    box: cropBoxOf(box(120, 430, 260, 520))!,
    intent: "  just the\thands  ",
    rationale: "  Tight on the hands;\n the face reads as a distraction here.  ",
    sourceTitle: "Hallway, night",
  });

  assert.deepEqual(plan, {
    region: { x: 0.43, y: 0.12, width: 0.09, height: 0.14 },
    title: "Hallway, night (crop)",
    editIntent: "just the hands",
    editRationale: "Tight on the hands; the face reads as a distraction here.",
    cropBox: [120, 430, 260, 520],
  });
});

test("a plan from an editor that reasoned about nothing still files a version", () => {
  const plan = cropPlan({
    box: cropBoxOf(box(0, 200, 1000, 800))!,
    intent: "the sign",
    sourceTitle: "Wide",
  });
  assert.equal(plan?.editRationale, "");
});

test("cropping a crop counts up rather than stacking suffixes", () => {
  const plan = cropPlan({
    box: cropBoxOf(box(0, 200, 1000, 800))!,
    intent: "the sign",
    sourceTitle: "Hallway, night (crop)",
  });
  assert.equal(plan?.title, "Hallway, night (crop 2)");
});

test("there is no plan when the frame is already the shot", () => {
  assert.equal(
    cropPlan({ box: cropBoxOf(box(0, 0, 1000, 1000))!, intent: "all of it", sourceTitle: "Wide" }),
    null,
  );
  assert.equal(
    cropPlan({ box: cropBoxOf(box(500, 500, 505, 900))!, intent: "a sliver", sourceTitle: "Wide" }),
    null,
  );
});

test("the whole frame is a plan when the list does other work to it", () => {
  const plan = cropPlan({
    box: cropBoxOf(box(0, 0, 1000, 1000))!,
    intent: "the right way up",
    sourceTitle: "Wide",
    ops: [TURN],
  });

  assert.deepEqual(plan?.region, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(plan?.title, "Wide (turned)");
});

test("a sliver is refused even when the list does other work", () => {
  assert.equal(
    cropPlan({
      box: cropBoxOf(box(500, 500, 505, 900))!,
      intent: "a sliver",
      sourceTitle: "Wide",
      ops: [...cut(500, 500, 505, 900), TURN],
    })?.region.height,
    0.005,
  );
});

test("a version with no intent is still a version", () => {
  const plan = cropPlan({
    box: cropBoxOf(box(0, 200, 1000, 800))!,
    intent: "",
    sourceTitle: "Wide",
  });
  assert.equal(plan?.editIntent, "");
});

test("a photograph has nothing to credit", () => {
  assert.equal(versionCredit({ editIntent: "", source: null }), null);
  assert.equal(versionCredit({}), null);
});

test("a cut is credited to the frame first and to the asking second", () => {
  assert.equal(
    versionCredit({
      editIntent: "just the hands",
      edit: cut(0, 0, 500, 500),
      source: { title: "Hallway, night" },
    }),
    "Cropped from “Hallway, night” — just the hands",
  );
});

test("a version that was not a crop is credited with the verb that was", () => {
  assert.equal(
    versionCredit({ editIntent: "warmer", edit: [GRADE], source: { title: "Grey day" } }),
    "Graded from “Grey day” — warmer",
  );
  assert.equal(
    versionCredit({
      editIntent: "the sign, warmer",
      edit: [...cut(0, 0, 500, 500), GRADE],
      source: { title: "Grey day" },
    }),
    "Edited from “Grey day” — the sign, warmer",
  );
});

test("a cut nobody said anything about is still credited to its frame", () => {
  assert.equal(
    versionCredit({ editIntent: "", edit: cut(0, 0, 500, 500), source: { title: "Hallway, night" } }),
    "Cropped from “Hallway, night”",
  );
  assert.equal(
    versionCredit({ editIntent: "  ", edit: cut(0, 0, 500, 500), source: { title: "Hallway, night" } }),
    "Cropped from “Hallway, night”",
  );
});

test("a frame with no title is still the frame this was cut from", () => {
  assert.equal(
    versionCredit({ editIntent: "the sign", edit: cut(0, 0, 500, 500), source: { title: "   " } }),
    "Cropped from the original — the sign",
  );
  assert.equal(
    versionCredit({ edit: cut(0, 0, 500, 500), source: { title: null } }),
    "Cropped from the original",
  );
});

test("a credited intent is one line however it was written", () => {
  assert.equal(
    versionCredit({
      editIntent: " just\n the  hands ",
      edit: cut(0, 0, 500, 500),
      source: { title: "Wide" },
    }),
    "Cropped from “Wide” — just the hands",
  );
});

test("a box the frame has already been cut at names the version it repeats", () => {
  const versions = [
    { id: "sign", edit: cut(100, 100, 400, 400) },
    { id: "hands", edit: cut(500, 200, 900, 700) },
  ];
  assert.equal(existingEdit(box(502, 199, 898, 703), versions)?.id, "hands");
});

test("a box of another part of the frame is a version of its own", () => {
  const versions = [{ id: "hands", edit: cut(500, 200, 900, 700) }];
  assert.equal(existingEdit(box(100, 100, 400, 400), versions), null);
  assert.equal(existingEdit(box(550, 250, 850, 650), versions), null);
});

test("the version a box repeats is the closest one, not the first", () => {
  const near = box(300, 300, 700, 700);
  const versions = [
    { id: "wide", edit: cut(298, 298, 703, 703) },
    { id: "exact", edit: cut(300, 300, 700, 700) },
  ];
  assert.equal(existingEdit(near, versions)?.id, "exact");
});

test("nothing is repeated when there is no box to compare", () => {
  const versions = [{ id: "hands", edit: cut(500, 200, 900, 700) }];
  assert.equal(existingEdit(null, versions), null);
  assert.equal(existingEdit(box(500, 200, 900, 700), undefined), null);
  assert.equal(existingEdit(box(500, 200, 900, 700), [{ id: "old", edit: [] }]), null);
  assert.equal(existingEdit(box(500, 200, 900, 700), [{ id: "turned", edit: [TURN] }]), null);
});

test("the version being adjusted is not the version the offer repeats", () => {
  const versions = [
    { id: "hands", edit: cut(500, 200, 900, 700) },
    { id: "sign", edit: cut(100, 100, 400, 400) },
  ];
  assert.equal(existingEdit(box(505, 205, 895, 695), versions, { except: "hands" }), null);
  assert.equal(existingEdit(box(102, 98, 398, 402), versions, { except: "hands" })?.id, "sign");
  assert.equal(existingEdit(box(505, 205, 895, 695), versions)?.id, "hands");
});
