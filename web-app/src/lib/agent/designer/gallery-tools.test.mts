import { test } from "node:test";
import assert from "node:assert/strict";

import { ReferenceOrigin } from "@/generated/prisma/enums";
import { type ToolReference, UNREAD_CATALOG_NOTE } from "@/lib/agent/shared/reference";
import { DISCARD_IMAGE, DRAWN_FROM_NOTE, GALLERY_TOOLS, galleryDigest, galleryImage, galleryList, GET_IMAGE, GET_MODIFICATION, IMAGE_UNREAD_NOTE, imageAnswer, LIST_GALLERY, modificationAnswer, modificationLine, type ModificationReference, REGION_NOTE } from "@/lib/agent/designer/gallery-tools";
import { GET_PAGE } from "@/lib/agent/designer/page-tools";
import { IMAGE_TOOLS } from "@/lib/agent/designer/image-tools";

function picture(over: Partial<ToolReference> & { id: string }): ToolReference {
  return {
    title: "IMG_0042.jpg",
    width: 1600,
    height: 1200,
    thumbUrl: `https://example.test/${over.id}`,
    ...over,
  };
}

const READ = {
  title: "Stairwell in late light",
  colorPalette: ["#2b1f16", "#c8a06a"],
  lighting: ["golden-hour"],
  texture: ["film-grain"],
  composition: ["leading-lines"],
  subject: ["architecture"],
  contrastDepth: ["layered-depth"],
  rationale: "The rail carries the eye up and the window does the rest.",
};

function cut(over: Partial<ModificationReference> = {}): ModificationReference {
  return {
    ...picture({ id: "ref_2", width: 800, height: 800 }),
    source: { id: "ref_1", title: "Stairwell" },
    editIntent: "just the hands",
    editRationale: "The hands are the bottom-left of the frame and the rail crosses them.",
    cropBox: [500, 0, 1000, 500],
    ...over,
  };
}

test("the gallery set is the four gallery tools, in the order the designer meets them", () => {
  assert.deepEqual(
    GALLERY_TOOLS.map((tool) => tool.name),
    ["list_gallery", "get_image", "get_modification", "discard_image"],
  );
});

test("no declaration speaks agent 6's vocabulary — no reference, no crop_reference", () => {
  for (const tool of [...GALLERY_TOOLS, ...IMAGE_TOOLS, GET_PAGE]) {
    const said = JSON.stringify(tool);
    assert.ok(!/reference/i.test(said.replace(/property analyzer/gi, "")), `${tool.name} says reference`);
    assert.ok(!said.includes("list_references"), `${tool.name} names list_references`);
    assert.ok(!said.includes("discard_reference"), `${tool.name} names discard_reference`);
  }
});

test("every argument is named for a picture, never for a referenceId", () => {
  assert.deepEqual(GET_IMAGE.parameters.required, ["imageId"]);
  assert.deepEqual(GET_MODIFICATION.parameters.required, ["modificationId"]);
  assert.deepEqual(DISCARD_IMAGE.parameters.required, ["imageId"]);
  assert.equal(LIST_GALLERY.parameters.required, undefined);
});

test("list_gallery says it carries no pictures and points at the door that does", () => {
  assert.match(LIST_GALLERY.description, /carries no pictures/);
  assert.match(LIST_GALLERY.description, /get_image/);
  /// The whole project rather than a page of it, said in the declaration: a
  /// model told the list is capped goes looking for the rest.
  assert.match(LIST_GALLERY.description, /nothing is capped/);
});

test("get_image sends the model to the list for the look and keeps the pixels", () => {
  assert.match(GET_IMAGE.description, /list_gallery/);
  assert.match(GET_IMAGE.description, /One picture per call/);
  assert.match(GET_MODIFICATION.description, /One version per call/);
});

test("discard_image is an offer, and forbids the three words that would lie", () => {
  assert.match(DISCARD_IMAGE.description, /deletes nothing/);
  assert.match(DISCARD_IMAGE.description, /never that the picture is gone, deleted or removed/);
  /// The free act beside the irreversible one, so the model reaches for the
  /// right half of "take that off".
  assert.match(DISCARD_IMAGE.description, /remove_from_canvas/);
});

test("a digest is agent 8's nouns over agent 6's arithmetic", () => {
  const digest = galleryDigest(
    picture({
      id: "ref_1",
      favorite: true,
      origin: ReferenceOrigin.GENERATED,
      source: { id: "ref_0", title: "the frame" },
      editIntent: "just the hands",
      analysis: READ,
    }),
  );

  assert.equal(digest.id, "ref_1");
  assert.equal(digest.title, "Stairwell in late light");
  assert.equal(digest.starred, true);
  assert.equal(digest.made, true);
  assert.equal(digest.modificationOf, "ref_0");
  assert.equal(digest.keeps, "just the hands");
  assert.ok(!("favorite" in digest));
  assert.ok(!("croppedFrom" in digest));
  /// The flattened list is the palette's neighbour on the same line now, and
  /// two spellings of one set of tags is the model asked which to believe.
  assert.ok(!("tags" in digest));
});

test("an unread digest carries the mark as words, never as the enum value", () => {
  const digest = galleryDigest(picture({ id: "ref_2", unread: "pending" }));
  assert.equal(digest.unread, "not read yet");
});

test("every line carries the whole of what was read off that picture", () => {
  const image = galleryImage(picture({ id: "ref_1", analysis: READ }));

  assert.deepEqual(image.palette, ["#2b1f16", "#c8a06a"]);
  assert.equal(image.rationale, READ.rationale);
  assert.deepEqual(image.lighting, ["Golden hour"]);
  assert.deepEqual(image.composition, ["Leading lines"]);
  assert.equal(image.unread, undefined);
});

test("a line nobody has read is short rather than six empty dimensions", () => {
  const image = galleryImage(picture({ id: "ref_1", unread: "never" }));

  assert.equal(image.unread, "never read");
  assert.ok(!("palette" in image));
  assert.ok(!("rationale" in image));
  assert.ok(!("lighting" in image));
});

test("list_gallery lists the project whole, with no cap and nothing left out", () => {
  const many = Array.from({ length: 200 }, (_, index) =>
    picture({ id: `ref_${index}`, analysis: READ }),
  );
  const answer = galleryList(many);

  assert.equal(answer.total, 200);
  assert.equal(answer.images.length, 200);
  assert.ok(!("shown" in answer));
  assert.ok(!("notAllShown" in answer));
  assert.deepEqual(answer.images[199]!.palette, ["#2b1f16", "#c8a06a"]);
});

test("includeModifications false leaves the versions out of the total too", () => {
  const rows = [
    picture({ id: "ref_1" }),
    picture({ id: "ref_2", source: { id: "ref_1", title: "the frame" } }),
  ];

  assert.equal(galleryList(rows).total, 2);
  const photos = galleryList(rows, { includeModifications: false });
  assert.equal(photos.total, 1);
  assert.deepEqual(
    photos.images.map((image) => image.id),
    ["ref_1"],
  );
});

test("the unread legend rides only on an answer that has something marked", () => {
  assert.equal(galleryList([picture({ id: "ref_1", analysis: READ })]).unreadNote, undefined);
  assert.equal(
    galleryList([picture({ id: "ref_1", unread: "failed" })]).unreadNote,
    UNREAD_CATALOG_NOTE,
  );
});

test("a drawing says what it was drawn from, and the legend rides once under the list", () => {
  const drawn = galleryList([
    picture({
      id: "ref_1",
      origin: ReferenceOrigin.GENERATED,
      generationPrompt: "a pale linen backdrop, soft window light",
      unread: "pending",
    }),
  ]);

  assert.equal(drawn.images[0]!.drawnFrom, "a pale linen backdrop, soft window light");
  assert.equal(drawn.images[0]!.made, true);
  assert.equal(drawn.drawnFromNote, DRAWN_FROM_NOTE);
  assert.equal(galleryList([picture({ id: "ref_2", analysis: READ })]).drawnFromNote, undefined);
});

test("no answer in the gallery list carries a uri — the pictures are get_image's", () => {
  const said = JSON.stringify(galleryList([picture({ id: "ref_1", analysis: READ })]));
  assert.ok(!said.includes("example.test"));
  assert.ok(!/thumbUrl|gs:\/\//.test(said));
});

test("get_image says which picture the pixels are and nothing about the look", () => {
  const answer = imageAnswer(
    picture({
      id: "ref_1",
      analysis: READ,
      origin: ReferenceOrigin.GENERATED,
      generationPrompt: "a pale linen backdrop",
    }),
  );

  assert.deepEqual(answer, { id: "ref_1", title: "Stairwell in late light", shape: "4:3" });
  /// Every one of these is on this picture's line in list_gallery, and a second
  /// copy beside the pixels is the paragraph the model reads instead of looking.
  for (const field of ["palette", "rationale", "lighting", "tags", "drawnFrom", "unreadNote"]) {
    assert.ok(!(field in answer), `get_image still answers ${field}`);
  }
});

test("versions are one line each — id, what it was cut for, shape — and never a picture", () => {
  const answer = imageAnswer(picture({ id: "ref_1", analysis: READ }), [
    picture({ id: "ref_2", editIntent: "just the hands", width: 800, height: 800 }),
    picture({ id: "ref_3", width: 1600, height: 900 }),
  ]);

  assert.deepEqual(answer.modifications, [
    { id: "ref_2", cutFor: "just the hands", shape: "1:1" },
    { id: "ref_3", cutFor: "cut by hand, with no reason written", shape: "16:9" },
  ]);
  assert.ok(!JSON.stringify(answer).includes("example.test"));
});

test("a picture with no versions says nothing about them", () => {
  assert.equal(imageAnswer(picture({ id: "ref_1", analysis: READ })).modifications, undefined);
});

test("an unread picture is looked at without a word about what it is of", () => {
  const answer = imageAnswer(picture({ id: "ref_1", unread: "never" }));
  assert.deepEqual(answer, { id: "ref_1", title: "IMG_0042.jpg", shape: "4:3" });
});

test("modificationLine is the same line get_image lists and get_modification opens", () => {
  assert.deepEqual(modificationLine(picture({ id: "ref_2", editIntent: "the sign" })), {
    id: "ref_2",
    cutFor: "the sign",
    shape: "4:3",
  });
});

test("get_modification answers the region in the model's own y-first 0-1000 order", () => {
  const answer = modificationAnswer(cut(), { id: "ref_1", title: "Stairwell" });

  assert.deepEqual(answer.region, [500, 0, 1000, 500]);
  assert.equal(answer.regionNote, REGION_NOTE);
  assert.match(REGION_NOTE, /\[ymin, xmin, ymax, xmax\]/);
  assert.match(REGION_NOTE, /top-left quarter/);
});

test("a version whose box was never recorded has no region rather than four zeroes", () => {
  const answer = modificationAnswer(cut({ cropBox: [] }), { id: "ref_1", title: "Stairwell" });
  assert.ok(!("region" in answer));
  assert.ok(!("regionNote" in answer));
});

test("get_modification carries the reasoning, the shape asked for, and its own pixels", () => {
  const answer = modificationAnswer(cut({ editAspect: "1:1" }), {
    id: "ref_1",
    title: "Stairwell",
  });

  assert.equal(answer.cutFor, "just the hands");
  assert.match(answer.why!, /the rail crosses them/);
  assert.equal(answer.askedAt, "1:1");
  assert.equal(answer.pixelSize, "800×800");
  assert.equal(answer.shape, "1:1");
  assert.equal(answer.modificationOf, "ref_1");
  assert.equal(answer.sourceTitle, "Stairwell");
});

test("a version nobody reasoned about says nothing where the reasoning would be", () => {
  const answer = modificationAnswer(cut({ editRationale: "" }), {
    id: "ref_1",
    title: "Stairwell",
  });
  assert.ok(!("why" in answer));
  assert.ok(!("askedAt" in answer));
});

test("an unread version is marked like an unread picture, in the same words", () => {
  const answer = modificationAnswer(cut({ unread: "pending" }), {
    id: "ref_1",
    title: "Stairwell",
  });
  assert.equal(answer.unreadNote, IMAGE_UNREAD_NOTE);
  assert.ok(!("palette" in answer));
});

test("a version that has been read answers under the dimension names too", () => {
  const answer = modificationAnswer(cut({ analysis: READ }), { id: "ref_1", title: "Stairwell" });
  assert.deepEqual(answer.subject, ["Architecture"]);
  assert.equal(answer.rationale, READ.rationale);
  assert.equal(answer.title, "Stairwell in late light");
});
