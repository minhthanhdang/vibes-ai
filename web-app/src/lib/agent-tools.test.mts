import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CATALOG_LIMIT,
  COMPOSE_MOODBOARD,
  INSPECT_BOARD,
  CROP_REFERENCE,
  LIST_REFERENCES,
  SHOWN_LIMIT,
  SHOW_REFERENCES,
  aspectLabel,
  attachmentKey,
  attachmentOf,
  attachmentTarget,
  boardAttachmentOf,
  boardsBrief,
  BOARDS_BRIEF_LIMIT,
  catalogBrief,
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

/// The brief is what a round used to cost. What it has to be is complete enough
/// that the model never needs the round back: every id, every shape, every tag,
/// and an honest count when it does not all fit.
test("the brief is one line per photograph, carrying what a tool answer carried", () => {
  const brief = catalogBrief([
    reference({ analysis: { lighting: ["golden_hour"], subject: ["portrait"] } }),
  ]);
  const [head, line] = brief.split("\n");

  assert.equal(head, "The project holds 1 photograph:");
  assert.equal(line, "ref-1 · Hallway · 16:9 · Golden_hour, Portrait");
});

test("the brief says the total when it could not carry it all", () => {
  const references = Array.from({ length: CATALOG_LIMIT + 5 }, (_, index) =>
    reference({ id: `ref-${index}` }),
  );
  const brief = catalogBrief(references);

  assert.match(brief, new RegExp(`^The project holds ${CATALOG_LIMIT + 5} photographs\\. `));
  assert.equal(brief.split("\n").length, CATALOG_LIMIT + 1);
});

/// The one thing priming cannot carry, said as a count rather than as rows: it
/// is what tells the model whether list_references is worth a round, and a
/// project with no crops must never spend one finding out.
test("the brief counts the cuts it does not list, and stays quiet when there are none", () => {
  assert.match(catalogBrief([reference()], { crops: 3 }), /3 cuts have been made of them\./);
  assert.equal(catalogBrief([reference()], { crops: 0 }).includes("cut"), false);
});

test("an empty project is said plainly rather than as an empty list", () => {
  assert.match(catalogBrief([]), /^This project has no pictures in it yet/);
});

test("a photograph with no analysis and no shape is still a pointable line", () => {
  const brief = catalogBrief([reference({ width: null, height: null })]);
  assert.equal(brief.split("\n")[1], "ref-1 · Hallway · unknown");
});

/// The boards are primed for the same reason the photographs are, and for one
/// more: there is no tool that lists them, so an id the brief does not carry is
/// a board the orchestrator cannot rebuild.
test("the brief names each board by the id a rebuild is asked for by", () => {
  const brief = boardsBrief([{ id: "board-1", title: "Act two", width: 1920, height: 1080 }]);
  const [head, line] = brief.split("\n");

  assert.equal(head, "The project holds 1 board:");
  assert.equal(line, "board-1 · Act two · 1920×1080");
});

test("a board nobody has named is still a pointable line", () => {
  const brief = boardsBrief([{ id: "board-1", title: "  ", width: 2048, height: 2048 }]);
  assert.equal(brief.split("\n")[1], "board-1 · Untitled board · 2048×2048");
});

test("the boards brief says the total when it could not carry it all", () => {
  const boards = Array.from({ length: BOARDS_BRIEF_LIMIT + 2 }, (_, index) => ({
    id: `board-${index}`,
    title: `Board ${index}`,
    width: 1920,
    height: 1080,
  }));
  const brief = boardsBrief(boards);

  assert.match(brief, new RegExp(`^The project holds ${BOARDS_BRIEF_LIMIT + 2} boards\\. `));
  assert.equal(brief.split("\n").length, BOARDS_BRIEF_LIMIT + 1);
});

/// A project with no boards says nothing at all rather than a line about
/// nothing: the brief is appended to every message of every turn, and the empty
/// case is the common one.
test("a project with no boards adds nothing to the brief", () => {
  assert.equal(boardsBrief([]), "");
});

test("an attachment of a photograph opens that photograph", () => {
  const target = attachmentTarget(attachmentOf(reference()));
  assert.deepEqual(target, { view: "gallery", inspectId: "ref-1" });
});

test("an attachment of a cut opens the frame it was cut from, at that cut", () => {
  const attachment = attachmentOf(
    reference({
      id: "cut-1",
      title: "Hallway (crop 2)",
      editIntent: "the doorway",
      source: { id: "ref-1", title: "Hallway" },
    }),
  );

  assert.equal(attachment.caption, "Hallway — the doorway");
  assert.deepEqual(attachmentTarget(attachment), {
    view: "gallery",
    inspectId: "ref-1",
    versionId: "cut-1",
  });
});

test("a photograph is not sent to a version of itself", () => {
  const target = attachmentTarget(attachmentOf(reference()));
  assert.equal("versionId" in target, false);
});

test("an offer is not read as a cut that exists", () => {
  const target = attachmentTarget(cropAttachmentOf(reference(), offer()));
  assert.equal(target.view === "gallery" && target.versionId, undefined);
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

test("a board with nothing drawn of it yet falls back to its cover", () => {
  const board = boardAttachmentOf({
    id: "b1",
    title: "Act one",
    layout: "SPLIT",
    images: 1,
    thumbUrl: "/api/references/ref-1/image?variant=thumb",
  });

  assert.equal(board.preview, null);
  assert.equal(board.thumbUrl, "/api/references/ref-1/image?variant=thumb");
});

test("a board carries the arrangement it was composed into", () => {
  const board = boardAttachmentOf({
    id: "b1",
    title: "Act one",
    layout: "SPLIT",
    images: 1,
    thumbUrl: null,
    preview: {
      aspectRatio: 16 / 9,
      items: [{ kind: "image", left: 0, top: 0, width: 50, height: 100, thumbUrl: "/t.jpg" }],
    },
  });

  assert.equal(board.preview?.items.length, 1);
  assert.equal(attachmentKey(board), "board:b1");
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
    { view: "gallery", inspectId: "frame", versionId: "cut" },
  );
});

test("compose_moodboard only offers templates that exist, plus RANDOM", () => {
  assert.equal(COMPOSE_MOODBOARD.name, "compose_moodboard");

  const properties = COMPOSE_MOODBOARD.parameters.properties as Record<
    string,
    { enum?: string[] }
  >;
  assert.deepEqual(properties.layout?.enum, [...LAYOUT_REQUESTS]);
});

/// A rebuild's selection can come off the board itself, so demanding the ids
/// would make the model guess at what it is already holding. Only the intention
/// is genuinely required of both shapes of call.
test("compose_moodboard asks for the intention and takes a board to rebuild", () => {
  assert.deepEqual(COMPOSE_MOODBOARD.parameters.required, ["intention"]);

  const properties = COMPOSE_MOODBOARD.parameters.properties as Record<string, unknown>;
  assert.ok(properties.boardId, "a board can be named to rebuild");
  /// And the two ways of changing what is on it without naming the whole of it —
  /// which the model cannot do, since a board is primed by id and title only.
  assert.ok(properties.addReferenceIds, "a picture can be put on a board");
  assert.ok(properties.removeReferenceIds, "a picture can be taken off a board");
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

test("an offer carries the cut drawn out of the frame, not the frame", () => {
  const attachment = cropAttachmentOf(reference(), offer());

  /// Half of each edge kept, from a tenth in: twice the size, shifted by a fifth
  /// of itself — and shaped 16:9 like the pixels it keeps out of a 16:9 frame.
  assert.deepEqual(attachment.preview, {
    aspectRatio: 1.78,
    image: { width: 200, height: 200, left: -20, top: -20 },
  });
});

test("an offer off a frame with no recorded pixels shows the frame instead", () => {
  const attachment = cropAttachmentOf(reference({ width: null, height: null }), offer());

  assert.equal(attachment.preview, null);
  assert.equal(attachment.thumbUrl, reference().thumbUrl);
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

/// A board read off its own scene has no template — the layout is not stored,
/// and a board the director rearranged is no longer the shape it started as. The
/// page is what is still true about it.
test("a board with no template is captioned by its page", () => {
  const board = boardAttachmentOf({
    id: "b1",
    title: "Act one",
    page: { width: 1080, height: 1920 },
    images: 6,
    thumbUrl: null,
  });

  assert.equal(board.caption, "6 photographs · 1080×1920");
});

test("inspect_board takes a board and nothing else", () => {
  assert.equal(INSPECT_BOARD.name, "inspect_board");
  assert.deepEqual(INSPECT_BOARD.parameters.required, ["boardId"]);
  assert.deepEqual(Object.keys(INSPECT_BOARD.parameters.properties as object), ["boardId"]);
  /// The one tool whose description is about another tool: the call it exists to
  /// stop being made is a rebuild, and a ceiling written into a description is
  /// obeyed before the call rather than refused after it.
  assert.match(INSPECT_BOARD.description, /never rebuild a board/);
});
