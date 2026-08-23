import { test } from "node:test";
import assert from "node:assert/strict";

import { ReferenceOrigin } from "@/generated/prisma/enums";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { CATALOG_LIMIT, type ToolReference, UNREAD_CATALOG_NOTE } from "@/lib/agent/shared/reference";
import { CROP_CALL_LIMIT } from "@/lib/agent/orchestrator/reference-tools";
import { DISCARD_PAGE, DUPLICATE_PAGE, MOVE_LIMIT, MOVE_TO_PAGE, RESIZE_PAGE } from "@/lib/agent/orchestrator/board-tools";
import {
  CROP_IMAGE,
  DESIGNER_DISCARD_PAGE,
  DESIGNER_DUPLICATE_PAGE,
  DESIGNER_GENERATE_IMAGE,
  DESIGNER_MOVE_TO_PAGE,
  DESIGNER_RESIZE_PAGE,
  DISCARD_IMAGE,
  DRAWN_FROM_NOTE,
  GALLERY_TOOLS,
  GET_IMAGE,
  GET_MODIFICATION,
  GET_PAGE,
  IMAGE_TOOLS,
  IMAGE_UNREAD_NOTE,
  LIST_GALLERY,
  REGION_NOTE,
  galleryDigest,
  galleryList,
  imageAnswer,
  modificationAnswer,
  modificationLine,
  type ModificationReference,
} from "@/lib/agent/designer-tools";

function picture(over: Partial<ToolReference> & { id: string }): ToolReference {
  return {
    title: "IMG_0042.jpg",
    width: 1600,
    height: 1200,
    thumbUrl: `https://example.test/${over.id}`,
    ...over,
  };
}

function argument(tool: ToolDeclaration, name: string): string {
  const properties = tool.parameters.properties as Record<string, { description: string }>;
  return properties[name].description;
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
  assert.ok(LIST_GALLERY.description.includes(String(CATALOG_LIMIT)));
});

test("get_image and get_modification are one picture a call, and say why", () => {
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
});

test("an unread digest carries the mark as words, never as the enum value", () => {
  const digest = galleryDigest(picture({ id: "ref_2", unread: "pending" }));
  assert.equal(digest.unread, "not read yet");
  assert.equal(digest.tags, undefined);
});

test("list_gallery caps at CATALOG_LIMIT and says the rest are not shown", () => {
  const many = Array.from({ length: CATALOG_LIMIT + 3 }, (_, index) =>
    picture({ id: `ref_${index}` }),
  );
  const answer = galleryList(many);

  assert.equal(answer.total, CATALOG_LIMIT + 3);
  assert.equal(answer.shown, CATALOG_LIMIT);
  assert.equal(answer.images.length, CATALOG_LIMIT);
  assert.match(answer.notAllShown!, /do not describe this list as all of them/);
});

test("a gallery that fits says nothing about a cap it did not hit", () => {
  const answer = galleryList([picture({ id: "ref_1" }), picture({ id: "ref_2" })]);
  assert.equal(answer.total, 2);
  assert.equal(answer.notAllShown, undefined);
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

test("no answer in the gallery list carries a uri — the pictures are get_image's", () => {
  const said = JSON.stringify(galleryList([picture({ id: "ref_1", analysis: READ })]));
  assert.ok(!said.includes("example.test"));
  assert.ok(!/thumbUrl|gs:\/\//.test(said));
});

test("get_image answers each dimension under its own name, with the palette and the reasoning", () => {
  const answer = imageAnswer(picture({ id: "ref_1", analysis: READ }));

  assert.deepEqual(answer.lighting, ["Golden hour"]);
  assert.deepEqual(answer.composition, ["Leading lines"]);
  assert.deepEqual(answer.palette, ["#2b1f16", "#c8a06a"]);
  assert.equal(answer.rationale, READ.rationale);
  /// The flattened list is the catalog's shape and would be the same words a
  /// second time here.
  assert.ok(!("tags" in answer));
  assert.equal(answer.unreadNote, undefined);
});

test("a picture nobody has read gets a mark and a note, not six empty dimensions", () => {
  const answer = imageAnswer(picture({ id: "ref_1", unread: "never" }));

  assert.equal(answer.unread, "never read");
  assert.equal(answer.unreadNote, IMAGE_UNREAD_NOTE);
  assert.ok(!("palette" in answer));
  assert.ok(!("rationale" in answer));
  assert.ok(!("lighting" in answer));
});

test("an analysis row with nothing in it is unread, not five empty arrays", () => {
  const answer = imageAnswer(
    picture({ id: "ref_1", analysis: { title: "Untitled", colorPalette: [], rationale: "" } }),
  );
  assert.equal(answer.unreadNote, IMAGE_UNREAD_NOTE);
  assert.ok(!("palette" in answer));
});

test("a drawing says what it was drawn from whether or not anyone has read it", () => {
  const answer = imageAnswer(
    picture({
      id: "ref_1",
      origin: ReferenceOrigin.GENERATED,
      generationPrompt: "a pale linen backdrop, soft window light",
      unread: "pending",
    }),
  );

  assert.equal(answer.drawnFrom, "a pale linen backdrop, soft window light");
  assert.equal(answer.drawnFromNote, DRAWN_FROM_NOTE);
  assert.equal(answer.made, true);
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

test("modificationLine is the same line get_image lists and get_modification opens", () => {
  assert.deepEqual(modificationLine(picture({ id: "ref_2", editIntent: "the sign" })), {
    id: "ref_2",
    cutFor: "the sign",
    shape: "4:3",
  });
});

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

test("get_page takes both ids, since a duplicated board carries the same page ids", () => {
  assert.equal(GET_PAGE.name, "get_page");
  assert.deepEqual(GET_PAGE.parameters.required, ["boardId", "pageId"]);
  const { pageId } = GET_PAGE.parameters.properties as Record<string, { description: string }>;
  assert.match(pageId!.description, /never by this one alone/);
});

test("get_page says the picture is drawn on the call and what a box means", () => {
  /// The two things a model cannot work out for itself: that looking again after
  /// an edit shows the edit, and that 500 is halfway whatever the page's size is.
  assert.match(GET_PAGE.description, /after you change a page/);
  assert.match(GET_PAGE.description, /\[ymin, xmin, ymax, xmax\]/);
  assert.match(GET_PAGE.description, /thousandths of the page/);
  assert.match(GET_PAGE.description, /One page per call/);
});

test("get_page promises the words and the picture off one read, and says when there is none", () => {
  assert.match(GET_PAGE.description, /never describe different arrangements/);
  assert.match(GET_PAGE.description, /If the picture could not be drawn the answer says so/);
});

test("duplicate_page keeps agent 6's wire name and arguments", () => {
  /// One tool and one executor: the name and the arguments are the shared
  /// implementation's, and only the prose is agent 8's.
  assert.equal(DESIGNER_DUPLICATE_PAGE.name, DUPLICATE_PAGE.name);
  assert.deepEqual(
    DESIGNER_DUPLICATE_PAGE.parameters.required,
    DUPLICATE_PAGE.parameters.required,
  );
  const keys = (tool: ToolDeclaration) =>
    Object.keys(tool.parameters.properties as Record<string, unknown>);
  assert.deepEqual(keys(DESIGNER_DUPLICATE_PAGE), keys(DUPLICATE_PAGE));
});

test("duplicate_page names no tool agent 8 was not given", () => {
  /// The whole reason the description is written again. Agent 6's ends in five
  /// tools — three to change the copy with, two not to reach for — and agent 8
  /// holds none of them.
  for (const missing of [
    "swap_on_board",
    "reword_on_board",
    "compose_moodboard",
    "duplicate_board",
    "inspect_board",
  ]) {
    assert.doesNotMatch(DESIGNER_DUPLICATE_PAGE.description, new RegExp(missing));
    const { pageId } = DESIGNER_DUPLICATE_PAGE.parameters.properties as Record<
      string,
      { description: string }
    >;
    assert.doesNotMatch(pageId!.description, new RegExp(missing));
  }
});

test("duplicate_page sends agent 8 to the canvas tools it does hold, and to its own reads", () => {
  for (const held of [
    "put_on_canvas",
    "transform_on_canvas",
    "remove_from_canvas",
    "reorder_on_canvas",
  ]) {
    assert.match(DESIGNER_DUPLICATE_PAGE.description, new RegExp(held));
  }
  const { pageId } = DESIGNER_DUPLICATE_PAGE.parameters.properties as Record<
    string,
    { description: string }
  >;
  assert.match(pageId!.description, /read_canvas or get_page/);
});

test("duplicate_page says a copy is free and a copy by hand is not", () => {
  /// The argument for calling it at all. Agent 8 *can* place every picture of a
  /// page again itself, and the boxes it writes are the thing it is worst at —
  /// so the description says the copy lands where the pictures already were.
  assert.match(DESIGNER_DUPLICATE_PAGE.description, /lays nothing out again/);
  assert.match(DESIGNER_DUPLICATE_PAGE.description, /Copying by hand/);
  assert.match(DESIGNER_DUPLICATE_PAGE.description, /variation of a page/);
});

test("resize_page keeps agent 6's wire name, arguments and preset enum", () => {
  /// One tool and one executor. The enum is the part worth pinning beyond the
  /// keys: the three names are what `pagePresetSize` resolves, so a fork that
  /// dropped one would be a shape agent 8 could not ask for at all.
  assert.equal(DESIGNER_RESIZE_PAGE.name, RESIZE_PAGE.name);
  assert.deepEqual(DESIGNER_RESIZE_PAGE.parameters.required, RESIZE_PAGE.parameters.required);
  const props = (tool: ToolDeclaration) =>
    tool.parameters.properties as Record<string, { enum?: string[] }>;
  assert.deepEqual(Object.keys(props(DESIGNER_RESIZE_PAGE)), Object.keys(props(RESIZE_PAGE)));
  assert.deepEqual(props(DESIGNER_RESIZE_PAGE).preset!.enum, props(RESIZE_PAGE).preset!.enum);
});

test("resize_page names no tool agent 8 was not given", () => {
  /// The reason the other three page tools are forked, and it is true of this
  /// one twice over: agent 6's sends the model to `inspect_board` for the ids
  /// and warns it off `compose_moodboard` in a clause about templates it does
  /// not have.
  for (const missing of ["inspect_board", "compose_moodboard", "add_page", "duplicate_board"]) {
    assert.doesNotMatch(JSON.stringify(DESIGNER_RESIZE_PAGE), new RegExp(missing));
  }
});

test("resize_page gives the preset names and no page size in pixels", () => {
  /// The other half of the page-shape anchor. The instruction stopped
  /// printing the two shapes agent 8 kept making (`instruction.ts`, above
  /// `PAGES`); this declaration is the other place a design reads them on every
  /// round, and it is agent 6's, so the numbers come out of the copy rather
  /// than out of the original. The names stay: naming one is how the call is
  /// made.
  const written = JSON.stringify(DESIGNER_RESIZE_PAGE);
  for (const preset of ["LANDSCAPE_HD", "PORTRAIT_HD", "SQUARE"]) {
    assert.ok(written.includes(preset), `${preset} is missing or misspelled`);
  }
  assert.deepEqual(written.match(/\b\d{3,4} ?[x\u00d7] ?\d{3,4}\b/g) ?? [], []);
  assert.match(JSON.stringify(RESIZE_PAGE), /1920/);
});

test("resize_page sends the shape decision back to put_on_canvas", () => {
  /// What replaces the pixels rather than merely their absence: three shapes is
  /// a fixed menu and a page agent 8 is about to *make* is not on it, so the
  /// proportion is chosen at the box `put_on_canvas` takes. Both halves of the
  /// declaration say it, because a model that reads only the argument is the one
  /// choosing a shape.
  assert.match(DESIGNER_RESIZE_PAGE.description, /put_on_canvas takes a box of any proportion/);
  const { preset, pageId } = DESIGNER_RESIZE_PAGE.parameters.properties as Record<
    string,
    { description: string }
  >;
  assert.match(preset!.description, /These three and no others/);
  assert.match(preset!.description, /put with put_on_canvas at that box/);
  assert.match(pageId!.description, /read_canvas or get_page/);
});

test("resize_page keeps what agent 6's says about a reshape moving nothing", () => {
  /// The facts of the call, which the fork is not allowed to lose: one executor
  /// answers both agents and a description that promised a different act would
  /// be a second contract over one write.
  assert.match(DESIGNER_RESIZE_PAGE.description, /lay nothing out again/);
  assert.match(DESIGNER_RESIZE_PAGE.description, /a page made smaller leaves pictures beside it/);
  assert.match(
    DESIGNER_RESIZE_PAGE.description,
    /a page made larger takes in whatever it now covers/,
  );
  assert.match(DESIGNER_RESIZE_PAGE.description, /costs nothing and makes no model call/);
});

test("move_to_page keeps agent 6's wire name and arguments", () => {
  assert.equal(DESIGNER_MOVE_TO_PAGE.name, MOVE_TO_PAGE.name);
  assert.deepEqual(DESIGNER_MOVE_TO_PAGE.parameters.required, MOVE_TO_PAGE.parameters.required);
  const keys = (tool: ToolDeclaration) =>
    Object.keys(tool.parameters.properties as Record<string, unknown>);
  assert.deepEqual(keys(DESIGNER_MOVE_TO_PAGE), keys(MOVE_TO_PAGE));
});

test("move_to_page names no tool agent 8 was not given", () => {
  const said = [
    DESIGNER_MOVE_TO_PAGE.description,
    ...Object.values(
      DESIGNER_MOVE_TO_PAGE.parameters.properties as Record<string, { description: string }>,
    ).map(({ description }) => description),
  ].join("\n");
  for (const missing of ["compose_moodboard", "swap_on_board", "inspect_board", "add_page"]) {
    assert.doesNotMatch(said, new RegExp(missing));
  }
});

test("move_to_page argues against the arithmetic rather than against a rebuild", () => {
  /// Agent 6 is told to prefer this over `compose_moodboard`, because a rebuild
  /// is what it would otherwise reach for. Agent 8 would reach for
  /// `transform_on_canvas`, and there the objection is that a box is in
  /// thousandths of the page holding it — so a move across pages is a sum in two
  /// coordinate frames, which is what this agent gets wrong.
  assert.match(DESIGNER_MOVE_TO_PAGE.description, /Do not do it with transform_on_canvas/);
  assert.match(DESIGNER_MOVE_TO_PAGE.description, /thousandths of the page holding it/);
  /// And what it lands as: below what is there rather than composed into it, so
  /// the arranging afterwards is agent 8's own.
  assert.match(DESIGNER_MOVE_TO_PAGE.description, /get_page afterwards/);
  assert.match(
    DESIGNER_MOVE_TO_PAGE.description,
    new RegExp(`At most ${MOVE_LIMIT} pictures a call`),
  );
});

test("move_to_page takes its ids from the reads agent 8 has", () => {
  const { fromPageId, referenceIds } = DESIGNER_MOVE_TO_PAGE.parameters.properties as Record<
    string,
    { description: string }
  >;
  assert.match(fromPageId!.description, /read_canvas or get_page/);
  /// A photograph rather than a handle: the shared implementation moves every
  /// copy of a referenceId off the page, which is not what an objectId means.
  assert.match(referenceIds!.description, /by referenceId rather than by objectId/);
});

test("discard_page keeps agent 6's wire name and arguments", () => {
  assert.equal(DESIGNER_DISCARD_PAGE.name, DISCARD_PAGE.name);
  assert.deepEqual(DESIGNER_DISCARD_PAGE.parameters.required, DISCARD_PAGE.parameters.required);
  const keys = (tool: ToolDeclaration) =>
    Object.keys(tool.parameters.properties as Record<string, unknown>);
  assert.deepEqual(keys(DESIGNER_DISCARD_PAGE), keys(DISCARD_PAGE));
});

test("discard_page names no tool agent 8 was not given", () => {
  const said = [
    DESIGNER_DISCARD_PAGE.description,
    ...Object.values(
      DESIGNER_DISCARD_PAGE.parameters.properties as Record<string, { description: string }>,
    ).map(({ description }) => description),
  ].join("\n");
  /// `discard_board` twice and `inspect_board` once in agent 6's, and agent 8
  /// holds neither — a board is not something it can offer to lose at all.
  for (const missing of ["discard_board", "inspect_board", "add_page"]) {
    assert.doesNotMatch(said, new RegExp(missing));
  }
  assert.match(said, /read_canvas or get_page/);
});

test("discard_page tells agent 8 the answer is the whole of the offer, not half of it", () => {
  /// The one fork that is not about tool names. Agent 6's says the user presses
  /// a button; nothing agent 8 does reaches a user, so the offer is the words
  /// of its closing line — the same sentence `discard_image` carries.
  assert.match(DESIGNER_DISCARD_PAGE.description, /nothing you call ever will/i);
  assert.doesNotMatch(DESIGNER_DISCARD_PAGE.description, /button/i);
  assert.match(DESIGNER_DISCARD_PAGE.description, /closing line/);
  assert.match(DESIGNER_DISCARD_PAGE.description, /never say the page is gone, removed or deleted/);
});

test("discard_page sends the smaller acts to the tools that do them for free", () => {
  /// A page discarded because a few pictures on it are wrong is the loss the
  /// user did not ask for, and both cheaper acts are calls agent 8 holds.
  assert.match(DESIGNER_DISCARD_PAGE.description, /that is remove_from_canvas/);
  assert.match(DESIGNER_DISCARD_PAGE.description, /is move_to_page/);
});

test("the image set is the two image tools", () => {
  assert.deepEqual(
    IMAGE_TOOLS.map((tool) => tool.name),
    ["generate_image", "crop_image"],
  );
});

test("generate_image ends at a filed picture the next round can place", () => {
  const said = DESIGNER_GENERATE_IMAGE.description;
  assert.match(said, /file it in the gallery/);
  assert.match(said, /put_on_canvas/);
  assert.match(said, /at most 2 a turn/);
  /// The one thing the tool does *not* wait for, said as the reason there is
  /// nothing to wait for rather than left out.
  assert.match(said, /get_image answers with the description it was drawn at/);
  assert.match(said, /made rather than found/);
  assert.deepEqual(DESIGNER_GENERATE_IMAGE.parameters.required, ["description"]);
  assert.deepEqual(Object.keys(DESIGNER_GENERATE_IMAGE.parameters.properties as object), [
    "description",
    "aspect",
  ]);
});

test("generate_image says the drawing model sees nothing but the description", () => {
  const said = argument(DESIGNER_GENERATE_IMAGE, "description");
  assert.match(said, /cannot see the project, the board or the conversation/);
});

test("crop_image takes its four arguments and no board", () => {
  assert.deepEqual(CROP_IMAGE.parameters.required, ["imageId", "intention"]);
  assert.deepEqual(Object.keys(CROP_IMAGE.parameters.properties as object), [
    "imageId",
    "intention",
    "aspect",
    "toObjectId",
  ]);
  const said = JSON.stringify(CROP_IMAGE);
  assert.ok(!said.includes("boardId"), "crop_image still takes agent 6's boardId");
  assert.ok(!said.includes("pageId"), "crop_image still takes agent 6's pageId");
});

test("crop_image files rather than offers, and says the id is placeable next round", () => {
  const said = CROP_IMAGE.description;
  assert.match(said, /made in this call, not offered/);
  assert.match(said, /put_on_canvas takes that id on the next round/);
  assert.match(said, /discard_image/);
  assert.match(said, new RegExp(`at most ${CROP_CALL_LIMIT} a turn`));
});

test("crop_image says the board is not changed, since agent 8 has no swap", () => {
  assert.match(CROP_IMAGE.description, /Nothing on any board changes/);
  assert.match(CROP_IMAGE.description, /remove_from_canvas/);
  const said = argument(CROP_IMAGE, "toObjectId");
  assert.match(said, /the board is not changed by this call/);
  assert.match(said, /put the cut on with put_on_canvas/);
});

test("toObjectId is a read_canvas handle, and it is the shape that is read off it", () => {
  const said = argument(CROP_IMAGE, "toObjectId");
  assert.match(said, /objectId from read_canvas/);
  assert.match(said, /held to that box's own shape/);
  /// The rule the executor implements, said where the model chooses: a shape it
  /// names itself wins, so the two arguments are never in an argument.
  assert.match(said, /a shape named in aspect wins/);
});

test("crop_image keeps the nudge — a version's id moves that cut", () => {
  const said = argument(CROP_IMAGE, "imageId");
  assert.match(said, /modification/);
  assert.match(said, /moves that cut instead of taking a smaller piece out of it/);
});

test("both image declarations offer the same two shape vocabularies", () => {
  for (const tool of IMAGE_TOOLS) {
    const said = argument(tool, "aspect");
    assert.match(said, /width:height/);
    assert.match(said, /square/);
  }
});
