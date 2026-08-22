import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PAGES_PER_MESSAGE,
  PAGE_BRIEF_CHAR_BUDGET,
  pageBriefText,
  type PageBrief,
} from "@/lib/pages/page-brief";
import { HISTORY_CHAR_BUDGET } from "@/lib/agent/chat-history";
import type { PageBlock } from "@/lib/pages/page-blocks";
import type { ToolReference } from "@/lib/agent/agent-tools";

/// The page as the model reads it (§V.4): one line about the page and one line
/// per block on it. What is asserted here is the *wording*, because the wording
/// is the whole interface — the model is not given a struct, it is given this
/// text, and a field that does not make it into a line was never sent.

const PAGE: PageBrief["page"] = {
  boardId: "board-7",
  pageId: "page-2",
  boardTitle: "Cold open",
  name: "Act one",
  position: 2,
  of: 4,
  width: 1920,
  height: 1080,
  preset: "LANDSCAPE_HD",
  layout: "HERO_LEFT",
};

function photograph(id: string, over: Partial<ToolReference> = {}): ToolReference {
  return {
    id,
    title: "rooftop dusk",
    width: 4000,
    height: 3000,
    thumbUrl: `https://example.test/${id}.jpg`,
    analysis: { lighting: ["golden_hour"], composition: ["wide_shot"] },
    ...over,
  };
}

function image(referenceId: string | null, over: Partial<PageBlock> = {}): PageBlock {
  return { kind: "image", referenceId, box: [0, 0, 500, 500], z: 0, ...over } as PageBlock;
}

function brief(over: Partial<PageBrief> = {}): PageBrief {
  return { page: PAGE, blocks: [], omitted: 0, rendered: true, ...over };
}

test("the opening line says which page of which board, at what size and template", () => {
  const [opening] = pageBriefText(brief({ blocks: [image("r1")] }), [photograph("r1")]).split("\n");

  assert.equal(
    opening,
    "The user attached “Act one” — page 2 of 4 of the board “Cold open”, 1920×1080, " +
      "composed at HERO_LEFT. The tools reach it as boardId board-7, pageId page-2. " +
      "The image above is that page. 1 block on it:",
  );
});

/// A board dragged together by hand has no template, and a page nobody renamed
/// has no name of its own. Neither is worth a word that says so.
test("a hand-arranged board's page names no template and an unnamed page names no name", () => {
  const [opening] = pageBriefText(
    brief({ page: { ...PAGE, pageId: "page-1", name: "", layout: null, position: 1, of: 1 } }),
    [],
  ).split("\n");

  assert.equal(
    opening,
    "The user attached page 1 of 1 of the board “Cold open”, 1920×1080. " +
      "The tools reach it as boardId board-7, pageId page-1. " +
      "The image above is that page. There is nothing on it.",
  );
});

/// §V.1: the frame's rectangle is authoritative and resizing a page changes
/// nothing else, so a page the user dragged off every preset keeps that
/// rectangle when it is laid out again. The numbers alone cannot say that — the
/// model reads 3840×2160 the same way it reads 1920×1080 — so the label is the
/// only thing standing between the user and being told their page is about
/// to be reset to the template's size.
test("a page the user sized themselves says the compose keeps their rectangle", () => {
  const [opening] = pageBriefText(
    brief({ page: { ...PAGE, width: 3840, height: 2160, preset: "Custom", layout: null } }),
    [],
  ).split("\n");

  assert.equal(
    opening,
    "The user attached “Act one” — page 2 of 4 of the board “Cold open”, 3840×2160. " +
      "The tools reach it as boardId board-7, pageId page-2. " +
      "That size is the user's own rather than a page preset, so laying it out again " +
      "fits the template into their rectangle instead of resizing the page. " +
      "The image above is that page. There is nothing on it.",
  );
});

/// A page still at one of the presets is reshaped by the template it is composed
/// at, which is every board in the app — so there is nothing to warn about and
/// the line is not spent.
test("a page at a preset says nothing about its size beyond the numbers", () => {
  assert.doesNotMatch(pageBriefText(brief(), []), /the user's own/);
});

/// §V.5: a revision that moved between picking and sending means the picture is
/// of a page that no longer exists, and the page goes up as text only. Said,
/// because a model told nothing would answer about an image it was never shown.
test("a page sent without its picture says so rather than pointing at one", () => {
  const said = pageBriefText(brief({ blocks: [image("r1")], rendered: false }), [photograph("r1")]);

  assert.match(said, /There is no picture of it/);
  assert.doesNotMatch(said, /The image above/);
});

/// Between the picture and the block count, because it is a fact about the
/// whole arrangement rather than about any one block — and the blocks below say
/// where each thing sits without ever adding up to what the frame came to.
test("how the page is standing is said on the head line, after the picture", () => {
  const [opening] = pageBriefText(
    brief({ blocks: [image("r1")], standingNote: "Something stands on 12% of this page." }),
    [photograph("r1")],
  ).split("\n");

  assert.match(
    opening,
    /The image above is that page\. Something stands on 12% of this page\. 1 block on it:$/,
  );
});

/// Nobody measured it at the door the chat opens: that page is drawn in the
/// browser and there is no plan on this side of it. An absent note is silence
/// rather than an empty sentence.
test("a page nobody measured says nothing about how it is standing", () => {
  const said = pageBriefText(brief({ blocks: [image("r1")] }), [photograph("r1")]);

  assert.doesNotMatch(said, /stands on/);
  assert.doesNotMatch(said, /  /);
});

test("a picture's line carries what the catalog says about it, with the box in the middle", () => {
  const [, line] = pageBriefText(brief({ blocks: [image("r1", { box: [0, 0, 540, 610] })] }), [
    photograph("r1"),
  ]).split("\n");

  assert.equal(line, "r1 · rooftop dusk · 4:3 · [0,0,540,610] · Golden_hour, Wide_shot");
});

/// Why a picture is the shape it is. Both blocks are on the page and the model
/// has to be able to tell the tight one from the frame it was taken out of.
test("a cut names the frame it came from and what it keeps", () => {
  const [, line] = pageBriefText(brief({ blocks: [image("c1")] }), [
    photograph("c1", {
      title: "the sign",
      editIntent: "just the sign",
      source: { id: "r1", title: "rooftop dusk" },
      analysis: null,
      unread: null,
    }),
  ]).split("\n");

  assert.equal(line, "c1 · the sign · 4:3 · cut of r1, keeps “just the sign” · [0,0,500,500]");
});

test("a picture nobody has read yet is marked in the catalog's own words", () => {
  const [, line] = pageBriefText(brief({ blocks: [image("r1")] }), [
    photograph("r1", { analysis: null, unread: "pending" }),
  ]).split("\n");

  assert.match(line!, /· not read yet$/);
});

/// Excalidraw draws a child cut off at its frame's border, so the render shows a
/// cut-off picture. The model has to read that as an overflow rather than as a
/// crop — and the mark sits beside the box it is about.
test("a picture over the page edge is called clipped rather than left to the box", () => {
  const [, line] = pageBriefText(
    brief({ blocks: [image("r1", { clipped: true, box: [550, 0, 1000, 300] })] }),
    [photograph("r1", { analysis: null, unread: "pending" })],
  ).split("\n");

  assert.equal(
    line,
    "r1 · rooftop dusk · 4:3 · [550,0,1000,300] · clipped at the page edge · not read yet",
  );
});

test("a line of text on the page is said in its own words", () => {
  const [, line] = pageBriefText(
    brief({
      blocks: [
        { kind: "text", text: "WHAT THE CITY KEEPS", box: [310, 620, 390, 1000], z: 1 },
      ],
    }),
    [],
  ).split("\n");

  assert.equal(line, "text · “WHAT THE CITY KEEPS” · [310,620,390,1000]");
});

/// §V.4 carries `z` on every block "because a collage's overlap is the thing
/// array order was carrying", and the boxes alone cannot say it: two blocks
/// covering the same corner of the page are the same two numbers whichever of
/// them the render shows whole. POLAROID_SCATTER is five tilted photographs
/// lying on each other, so this is a page the compositor draws rather than an
/// edge case the user has to build.
test("two blocks lying on each other say which of them is on top", () => {
  const [, first, second] = pageBriefText(
    brief({
      blocks: [
        image("r1", { box: [100, 100, 600, 600], z: 2 }),
        image("r2", { box: [400, 400, 900, 900], z: 5 }),
      ],
    }),
    [photograph("r1", { analysis: null, unread: null }), photograph("r2", { analysis: null, unread: null })],
  ).split("\n");

  assert.equal(first, "r1 · rooftop dusk · 4:3 · [100,100,600,600] · z 2");
  assert.equal(second, "r2 · rooftop dusk · 4:3 · [400,400,900,900] · z 5");
});

/// Said once in the head rather than per line, and only on a page that has an
/// overlap to read — a model given a number with no rule for it reads the
/// stacking order as another coordinate.
test("the head says what z means, on the pages that carry it and no others", () => {
  const stacked = pageBriefText(
    brief({
      blocks: [image("r1", { box: [0, 0, 500, 500] }), image("r2", { box: [200, 200, 700, 700], z: 1 })],
    }),
    [photograph("r1"), photograph("r2")],
  );

  assert.match(stacked, /Some blocks on it overlap: those lines carry z, the stacking order with 0 at the back/);
  assert.doesNotMatch(pageBriefText(brief({ blocks: [image("r1")] }), [photograph("r1")]), /carry z/);
});

/// The blocks of a grid sit apart, and a page whose blocks sit apart is fully
/// said by its boxes. Iteration 7's rule: the field is spent where it
/// disambiguates and nowhere else, so an ordinary composed page's lines are
/// exactly what they were.
test("blocks that sit clear of each other carry no stacking order", () => {
  const said = pageBriefText(
    brief({
      blocks: [
        image("r1", { box: [0, 0, 500, 490] }),
        image("r2", { box: [0, 510, 500, 1000], z: 1 }),
        { kind: "text", text: "WHAT THE CITY KEEPS", box: [520, 0, 600, 1000], z: 2 },
      ],
    }),
    [photograph("r1"), photograph("r2")],
  );

  assert.doesNotMatch(said, /· z /);
});

/// Two blocks laid edge to edge share a thousandth once the boxes are rounded,
/// which is a seam rather than a stack — a whole grid would otherwise be
/// reported as a collage.
test("blocks meeting at an edge are not called a stack", () => {
  const said = pageBriefText(
    brief({
      blocks: [image("r1", { box: [0, 0, 500, 501] }), image("r2", { box: [0, 500, 500, 1000], z: 1 })],
    }),
    [photograph("r1"), photograph("r2")],
  );

  assert.doesNotMatch(said, /· z /);
});

/// The overlap is a fact about the pair, so the block underneath has to carry it
/// too: read on its own, its line is the only place the model learns that part
/// of that picture is not visible.
test("the block underneath says its stacking order as well as the one on top", () => {
  const said = pageBriefText(
    brief({
      blocks: [
        { kind: "text", text: "WHAT THE CITY KEEPS", box: [300, 100, 400, 900], z: 4 },
        image("r1", { box: [0, 0, 1000, 1000], z: 0 }),
      ],
    }),
    [photograph("r1", { analysis: null, unread: null })],
  ).split("\n");

  assert.equal(said[1], "text · “WHAT THE CITY KEEPS” · [300,100,400,900] · z 4");
  assert.equal(said[2], "r1 · rooftop dusk · 4:3 · [0,0,1000,1000] · z 0");
});

/// The mark for a picture running over the page edge and the stacking order are
/// two different facts about one block, and both are read off the box beside
/// them.
test("a clipped block on a stack says both", () => {
  const [, line] = pageBriefText(
    brief({
      blocks: [
        image("r1", { box: [550, 0, 1000, 300], clipped: true, z: 3 }),
        image("r2", { box: [600, 100, 1000, 400], z: 1 }),
      ],
    }),
    [photograph("r1", { analysis: null, unread: null }), photograph("r2", { analysis: null, unread: null })],
  ).split("\n");

  assert.equal(line, "r1 · rooftop dusk · 4:3 · [550,0,1000,300] · z 3 · clipped at the page edge");
});

/// The server never resolves an id it cannot see in the project. The block stays
/// — it is taking up that room on the page — but it is described as what it is
/// rather than given properties from nowhere.
test("a picture the project does not hold keeps its place and gets no properties", () => {
  const said = pageBriefText(
    brief({ blocks: [image("gone"), image(null, { box: [0, 600, 500, 1000], z: 1 })] }),
    [],
  );
  const [, first, second] = said.split("\n");

  assert.equal(first, "gone · not one of this project's pictures · [0,0,500,500]");
  assert.equal(second, "not one of this project's pictures · [0,600,500,1000]");
});

/// A cap that does not say what it dropped reads as coverage.
test("blocks past the cap are counted in a sentence of their own", () => {
  const said = pageBriefText(brief({ blocks: [image("r1")], omitted: 2 }), [photograph("r1")]);

  assert.equal(said.split("\n").at(-1), "2 more blocks are on this page and are not described — the smallest things on it.");
  assert.match(pageBriefText(brief({ omitted: 1 }), []), /1 more block is on this page/);
});

test("a page with nothing on it says so instead of promising a list", () => {
  const said = pageBriefText(brief(), []);

  assert.match(said, /There is nothing on it\.$/);
  assert.equal(said.split("\n").length, 1);
});

/// Two, because each page is an image part plus a text block riding on every
/// tool round of the turn.
test("a message carries at most two pages", () => {
  assert.equal(PAGES_PER_MESSAGE, 2);
});

/// §V.4's third cap. The block cap bounds how many things are described and not
/// how long a description is: a page of two dozen tagged references with a cut
/// line each is several times the text of two dozen bare boxes, and all of it
/// rides on every tool round of the turn.
const wordy = (id: string) =>
  photograph(id, {
    title: "the rooftop at the end of the long dusk, wider",
    editIntent: "just the sign above the door",
    source: { id: "r0", title: "rooftop dusk" },
    analysis: {
      lighting: ["golden_hour", "backlit"],
      composition: ["wide_shot", "low_angle"],
      contrastDepth: ["warm_shadows", "deep_blacks"],
    },
  });

test("a page of long lines is cut to the character budget", () => {
  const blocks = Array.from({ length: 24 }, (_, at) => image(`r${at}`));
  const references = blocks.map((_, at) => wordy(`r${at}`));

  const said = pageBriefText(brief({ blocks }), references);

  assert.ok(said.length <= PAGE_BRIEF_CHAR_BUDGET, `${said.length} characters`);
  assert.ok(said.split("\n").length < 1 + blocks.length, "nothing was dropped");
});

/// The head says how many blocks are described and the tail says how many are
/// not; between them they have to account for the page, or the model reads a
/// cut list as the whole of it.
test("the lines dropped for the budget are counted in the same sentence the cap's are", () => {
  const blocks = Array.from({ length: 24 }, (_, at) => image(`r${at}`));
  const references = blocks.map((_, at) => wordy(`r${at}`));

  const said = pageBriefText(brief({ blocks, omitted: 3 }), references).split("\n");
  const described = said.length - 2;

  assert.ok(described < blocks.length, "the budget dropped nothing to count");
  assert.match(said[0]!, new RegExp(`${described} blocks on it, in reading order:$`));
  assert.equal(said.at(-1), `${24 - described + 3} more blocks are on this page and are not described — the smallest things on it.`);
});

/// The budget cuts the same way the block cap does (`byReach`), and for the same
/// reason: reading order runs top to bottom, so a budget spent in it buys the
/// top of the page and leaves the foot of it undescribed.
test("the budget is spent on what reaches furthest across the page", () => {
  const blocks = Array.from({ length: 24 }, (_, at) =>
    image(`r${at}`, { box: at === 23 ? [900, 0, 1000, 1000] : [at * 40, 0, at * 40 + 60, 60] }),
  );
  const references = blocks.map((_, at) => wordy(`r${at}`));

  const said = pageBriefText(brief({ blocks }), references).split("\n");

  assert.ok(said.length - 2 < blocks.length, "the budget dropped nothing to count");
  assert.ok(
    said.some((line) => line.startsWith("r23 · ")),
    "the widest block on the page was the one the budget dropped",
  );
  /// Still said in reading order: the widest is at the foot and is last.
  assert.match(said.at(-2)!, /^r23 · /);
});

/// A page answered with no blocks at all is a page the model cannot say anything
/// about — the first line is kept whatever it costs.
test("one block is described even when the budget cannot afford it", () => {
  const said = pageBriefText(brief({ blocks: [image("r1"), image("r2")] }), [wordy("r1"), wordy("r2")], {
    budget: 1,
  }).split("\n");

  assert.equal(said.length, 3);
  assert.match(said[1]!, /^r1 · /);
  assert.equal(said.at(-1), "1 more block is on this page and is not described — the smallest thing on it.");
});

/// The ordinary page — a composed board's half-dozen photographs — is nowhere
/// near the budget, and is described exactly as it was before there was one.
test("a page the budget does not reach keeps every one of its lines", () => {
  const blocks = Array.from({ length: 8 }, (_, at) => image(`r${at}`));
  const said = pageBriefText(
    brief({ blocks }),
    blocks.map((_, at) => photograph(`r${at}`)),
  ).split("\n");

  assert.equal(said.length, 1 + blocks.length);
  assert.match(said[0]!, /8 blocks on it, in reading order:$/);
});

/// Both pages of a message together cost what the whole conversation behind them
/// does, which is the order §V.4 asks for rather than a number picked here.
test("the two pages a message may carry are the history window's own budget", () => {
  assert.equal(PAGE_BRIEF_CHAR_BUDGET * PAGES_PER_MESSAGE, HISTORY_CHAR_BUDGET);
});

/// §IV.2's door: the same representation, asked for by the model rather than
/// picked by the user. Only the first clause differs, and it has to — a model
/// thanked the user for a page it fetched itself is a model reading an event
/// that did not happen.
test("the door the model opens says who is looking without changing the rest", () => {
  const attached = pageBriefText(brief({ blocks: [image("r1")] }), [photograph("r1")]);
  const asked = pageBriefText(brief({ blocks: [image("r1")], door: "asked" }), [
    photograph("r1"),
  ]);

  assert.match(asked, /^This is “Act one” — page 2 of 4 of the board “Cold open”, 1920×1080, /);
  assert.doesNotMatch(asked, /attached/);
  assert.doesNotMatch(asked, /The image above/);
  assert.match(asked, /The picture that came back with this answer is that page/);
  /// Everything below the head is one text, and this is what says so.
  assert.equal(asked.split("\n").slice(1).join("\n"), attached.split("\n").slice(1).join("\n"));
});

test("an unnamed page asked for by the model still opens on the board it is on", () => {
  const said = pageBriefText(brief({ page: { ...PAGE, name: "" }, door: "asked" }), []);
  assert.match(said, /^This is page 2 of 4 of the board “Cold open”/);
});

/// §IV.2: at this door a missing picture is an *error* rather than the ordinary
/// case, so the renderer's own sentence is carried rather than the attachment's
/// account of a page that moved while it was being sent.
test("a page the renderer could not draw says why, in the renderer's own words", () => {
  const said = pageBriefText(
    brief({
      blocks: [image("r1")],
      rendered: false,
      door: "asked",
      renderFailure: "the renderer did not finish drawing that page within 8 seconds",
    }),
    [photograph("r1")],
  );

  assert.match(said, /There is no picture of it — the renderer did not finish drawing that page/);
  assert.doesNotMatch(said, /while it was being sent/);
});

test("a renderer that failed and said nothing still says there is no picture", () => {
  const said = pageBriefText(brief({ rendered: false, door: "asked" }), []);
  assert.match(said, /There is no picture of it — the renderer failed/);
});

test("what the renderer drew as an outline is said beside the picture, not instead of it", () => {
  const said = pageBriefText(
    brief({
      blocks: [image("r1")],
      door: "asked",
      undrawnNote: "Drawn as empty outlines because this renderer cannot draw them: 1 freedraw.",
    }),
    [photograph("r1")],
  );

  assert.match(
    said,
    /is that page as it stands now\. Drawn as empty outlines .*: 1 freedraw\. 1 block on it:/,
  );
});

test("the undrawn note is spent out of the same budget the blocks are", () => {
  const note = "Drawn as empty outlines because this renderer cannot draw them: 3 freedraw.";
  const blocks = Array.from({ length: 8 }, (_, at) => image(`r${at}`));
  const references = blocks.map((_, at) => photograph(`r${at}`));
  const budget = 700;

  const without = pageBriefText(brief({ blocks, door: "asked" }), references, { budget });
  const with_ = pageBriefText(brief({ blocks, door: "asked", undrawnNote: note }), references, {
    budget,
  });

  assert.ok(with_.split("\n").length < without.split("\n").length);
});

/// §XI.5: what the picture above shows and what the lines below say have to be
/// the same page. Agent 8 draws scrims and rules now, and a colour field the
/// text is silent about is the model reading room where the ground is.
test("a shape says what it is and what colour it is standing there in", () => {
  const lines = pageBriefText(
    brief({
      blocks: [
        {
          kind: "shape",
          shape: "rectangle",
          fill: "#0c111c",
          stroke: "#1e1e1e",
          box: [0, 0, 1000, 1000],
          z: 0,
        },
      ],
    }),
    [],
  ).split("\n");

  assert.equal(lines[1], "rectangle · #0c111c · [0,0,1000,1000]");
});

/// A border and a colour field are the same element wearing two different
/// fills, and a model that cannot tell them apart puts its headline behind one
/// of them.
test("a shape with nothing behind it is said as an outline, in the colour of its stroke", () => {
  const lines = pageBriefText(
    brief({
      blocks: [
        {
          kind: "shape",
          shape: "rectangle",
          fill: "transparent",
          stroke: "#f4efe6",
          box: [40, 40, 960, 960],
          z: 0,
        },
      ],
    }),
    [],
  ).split("\n");

  assert.equal(lines[1], "rectangle · outline in #f4efe6, nothing behind it · [40,40,960,960]");
});

test("a shape at less than full opacity says so, and one at full says nothing", () => {
  const lines = pageBriefText(
    brief({
      blocks: [
        {
          kind: "shape",
          shape: "rectangle",
          fill: "#000000",
          stroke: "#1e1e1e",
          opacity: 45,
          box: [0, 0, 1000, 1000],
          z: 0,
        },
        {
          kind: "shape",
          shape: "line",
          fill: "transparent",
          stroke: "#1e1e1e",
          box: [500, 100, 500, 900],
          z: 1,
        },
      ],
    }),
    [],
  ).split("\n");

  assert.equal(lines[1], "rectangle · #000000 · 45% opaque · [0,0,1000,1000]");
  /// A rule is drawn in its stroke — there is nothing behind a line to fill.
  assert.equal(lines[2], "line · #1e1e1e · [500,100,500,900]");
});
