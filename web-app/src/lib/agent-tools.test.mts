import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CATALOG_LIMIT,
  COMPOSE_MOODBOARD,
  CROP_REFERENCE,
  LIST_REFERENCES,
  SHOWN_LIMIT,
  SHOW_REFERENCES,
  aspectLabel,
  attachmentKey,
  attachmentOf,
  attachmentTarget,
  boardAttachmentOf,
  cropAttachmentOf,
  digestTags,
  mergedAttachments,
  pickReferences,
  referenceCatalog,
  referenceDigest,
  type ToolReference,
} from "./agent-tools";
import { LAYOUT_REQUESTS } from "./moodboard-layouts";
import { CROP_ASPECT_IDS } from "./reference-version";
import type { CropOffer } from "./crop-offer";

function reference(overrides: Partial<ToolReference> = {}): ToolReference {
  return {
    id: "ref-1",
    title: "Hallway",
    width: 1920,
    height: 1080,
    thumbUrl: "/api/references/ref-1/image?variant=thumb",
    ...overrides,
  };
}

test("a photograph's shape is said by the name a director uses for it", () => {
  assert.equal(aspectLabel(1920, 1080), "16:9");
  assert.equal(aspectLabel(2048, 2048), "1:1");
  assert.equal(aspectLabel(1080, 1920), "9:16");
});

test("a shape nobody has a name for is said as its own ratio", () => {
  assert.equal(aspectLabel(5568, 3712), "1.50:1");
});

test("a row with no recorded pixels has no shape rather than a made-up one", () => {
  assert.equal(aspectLabel(null, null), "unknown");
  assert.equal(aspectLabel(1920, 0), "unknown");
});

test("the digest carries the id, the shape and the tags and nothing else", () => {
  const digest = referenceDigest(
    reference({
      analysis: { lighting: ["low-key"], subject: ["interior"], colorPalette: ["#112233"] },
    }),
  );

  assert.deepEqual(digest, {
    id: "ref-1",
    title: "Hallway",
    shape: "16:9",
    tags: ["Low key", "Interior"],
  });
});

test("the palette stays out of the digest — hex codes are tokens a model cannot see", () => {
  assert.equal(digestTags({ colorPalette: ["#112233", "#445566"] }), undefined);
});

test("a cut says which frame it came out of and what it keeps", () => {
  const digest = referenceDigest(
    reference({
      id: "cut-1",
      title: "Hallway (crop 2)",
      editIntent: "the doorway",
      source: { id: "ref-1", title: "Hallway" },
    }),
  );

  assert.equal(digest.croppedFrom, "ref-1");
  assert.equal(digest.keeps, "the doorway");
});

test("an untitled reference is still named — a blank row is unpointable", () => {
  assert.equal(referenceDigest(reference({ title: "   " })).title, "Untitled");
});

test("the catalog says how many did not fit, so a truncated list is not read as the whole gallery", () => {
  const references = Array.from({ length: CATALOG_LIMIT + 5 }, (_, index) =>
    reference({ id: `ref-${index}` }),
  );
  const catalog = referenceCatalog(references);

  assert.equal(catalog.total, CATALOG_LIMIT + 5);
  assert.equal(catalog.shown, CATALOG_LIMIT);
  assert.equal(catalog.references.length, CATALOG_LIMIT);
});

test("a catalog that fits reports no truncation", () => {
  const catalog = referenceCatalog([reference(), reference({ id: "ref-2" })]);
  assert.equal(catalog.total, 2);
  assert.equal(catalog.shown, 2);
});

test("an attachment of a photograph opens that photograph", () => {
  const target = attachmentTarget(attachmentOf(reference()));
  assert.deepEqual(target, { view: "gallery", inspectId: "ref-1" });
});

test("an attachment of a cut opens the frame it was cut from", () => {
  const attachment = attachmentOf(
    reference({
      id: "cut-1",
      title: "Hallway (crop 2)",
      editIntent: "the doorway",
      source: { id: "ref-1", title: "Hallway" },
    }),
  );

  assert.equal(attachment.caption, "Hallway — the doorway");
  assert.deepEqual(attachmentTarget(attachment), { view: "gallery", inspectId: "ref-1" });
});

test("named references come back in the order they were named", () => {
  const references = [reference({ id: "a" }), reference({ id: "b" }), reference({ id: "c" })];
  const { found, missing } = pickReferences(references, ["c", "a"]);

  assert.deepEqual(
    found.map((entry) => entry.id),
    ["c", "a"],
  );
  assert.deepEqual(missing, []);
});

test("an id that answers to nothing is reported, not dropped", () => {
  const { found, missing } = pickReferences([reference({ id: "a" })], ["a", "ghost"]);
  assert.deepEqual(
    found.map((entry) => entry.id),
    ["a"],
  );
  assert.deepEqual(missing, ["ghost"]);
});

test("a reference named twice in one call is shown once", () => {
  const { found } = pickReferences([reference({ id: "a" })], ["a", "a"]);
  assert.equal(found.length, 1);
});

test("a call naming more pictures than the chat has room for is cut to the limit", () => {
  const references = Array.from({ length: SHOWN_LIMIT + 3 }, (_, index) =>
    reference({ id: `ref-${index}` }),
  );
  const { found } = pickReferences(
    references,
    references.map((entry) => entry.id),
  );
  assert.equal(found.length, SHOWN_LIMIT);
});

test("the same picture shown on two rounds of one exchange is drawn once", () => {
  const first = [attachmentOf(reference({ id: "a" }))];
  const merged = mergedAttachments(first, [
    attachmentOf(reference({ id: "a" })),
    attachmentOf(reference({ id: "b" })),
  ]);

  assert.deepEqual(merged.map(attachmentKey), ["reference:a", "reference:b"]);
});

test("the declarations name themselves as the model is told to call them", () => {
  assert.equal(LIST_REFERENCES.name, "list_references");
  assert.equal(SHOW_REFERENCES.name, "show_references");
  assert.deepEqual(SHOW_REFERENCES.parameters.required, ["referenceIds"]);
});

test("a board and a reference of the same id are two attachments", () => {
  const board = boardAttachmentOf({
    id: "a",
    title: "Act one",
    layout: "GRID_3X3",
    images: 9,
    thumbUrl: null,
  });
  const merged = mergedAttachments([attachmentOf(reference({ id: "a" }))], [board, board]);

  assert.deepEqual(merged.map(attachmentKey), ["reference:a", "board:a"]);
});

test("a board says what it is rather than what it is called", () => {
  const board = boardAttachmentOf({
    id: "b1",
    title: "  ",
    layout: "HERO_LEFT",
    images: 1,
    thumbUrl: "/api/references/ref-1/image?variant=thumb",
  });

  assert.equal(board.title, "Untitled board");
  assert.equal(board.caption, "1 photograph · Hero left");
});

test("a board attachment opens the board, a cut opens its frame", () => {
  assert.deepEqual(
    attachmentTarget(
      boardAttachmentOf({ id: "b1", title: "Act one", layout: "SPLIT", images: 2, thumbUrl: null }),
    ),
    { view: "moodboard", boardId: "b1" },
  );
  assert.deepEqual(
    attachmentTarget(attachmentOf(reference({ id: "cut", source: { id: "frame", title: "Hallway" } }))),
    { view: "gallery", inspectId: "frame" },
  );
});

test("compose_moodboard only offers templates that exist, plus RANDOM", () => {
  assert.equal(COMPOSE_MOODBOARD.name, "compose_moodboard");
  assert.deepEqual(COMPOSE_MOODBOARD.parameters.required, ["intention", "referenceIds"]);

  const properties = COMPOSE_MOODBOARD.parameters.properties as Record<
    string,
    { enum?: string[] }
  >;
  assert.deepEqual(properties.layout?.enum, [...LAYOUT_REQUESTS]);
});

test("crop_reference offers only the shapes a cut can be held to", () => {
  assert.equal(CROP_REFERENCE.name, "crop_reference");
  assert.deepEqual(CROP_REFERENCE.parameters.required, ["referenceId", "intention"]);

  const properties = CROP_REFERENCE.parameters.properties as Record<string, { enum?: string[] }>;
  assert.deepEqual(properties.aspect?.enum, [...CROP_ASPECT_IDS]);
});

function offer(overrides: Partial<CropOffer> = {}): CropOffer {
  return {
    referenceId: "ref-1",
    region: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    cropBox: [100, 100, 600, 600],
    editIntent: "the doorway",
    editRationale: "the light falls through it",
    aspect: null,
    ...overrides,
  };
}

test("an offer is drawn on the frame it would be cut from, under what it keeps", () => {
  const attachment = cropAttachmentOf(reference(), offer());

  assert.equal(attachment.kind, "crop");
  assert.equal(attachment.referenceId, "ref-1");
  assert.equal(attachment.title, "the doorway");
  assert.equal(attachment.thumbUrl, reference().thumbUrl);
  assert.match(attachment.caption, /Keeps 25% of the frame/);
});

test("clicking an offer opens its frame and carries the cut to the review there", () => {
  const target = attachmentTarget(cropAttachmentOf(reference(), offer()));

  assert.deepEqual(target, {
    view: "gallery",
    inspectId: "ref-1",
    offer: offer(),
  });
});

test("two cuts of one frame are two offers, and the same cut twice is one", () => {
  const first = cropAttachmentOf(reference(), offer());
  const second = cropAttachmentOf(reference(), offer({ cropBox: [0, 0, 500, 500] }));
  const merged = mergedAttachments([], [first, second, first]);

  assert.deepEqual(merged.map(attachmentKey), [
    "crop:ref-1:100,100,600,600",
    "crop:ref-1:0,0,500,500",
  ]);
});

test("an offer and the picture it is a cut of are two attachments", () => {
  const merged = mergedAttachments(
    [attachmentOf(reference())],
    [cropAttachmentOf(reference(), offer())],
  );

  assert.deepEqual(merged.map(attachmentKey), ["reference:ref-1", "crop:ref-1:100,100,600,600"]);
});
