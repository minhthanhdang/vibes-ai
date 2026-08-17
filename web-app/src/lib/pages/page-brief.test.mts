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
    "The director attached “Act one” — page 2 of 4 of the board “Cold open”, 1920×1080, " +
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
    "The director attached page 1 of 1 of the board “Cold open”, 1920×1080. " +
      "The tools reach it as boardId board-7, pageId page-1. " +
      "The image above is that page. There is nothing on it.",
  );
});

/// §V.1: the frame's rectangle is authoritative and resizing a page changes
/// nothing else, so a page the director dragged off every preset keeps that
/// rectangle when it is laid out again. The numbers alone cannot say that — the
/// model reads 3840×2160 the same way it reads 1920×1080 — so the label is the
/// only thing standing between the director and being told their page is about
/// to be reset to the template's size.
test("a page the director sized themselves says the compose keeps their rectangle", () => {
  const [opening] = pageBriefText(
    brief({ page: { ...PAGE, width: 3840, height: 2160, preset: "Custom", layout: null } }),
    [],
  ).split("\n");

  assert.equal(
    opening,
    "The director attached “Act one” — page 2 of 4 of the board “Cold open”, 3840×2160. " +
      "The tools reach it as boardId board-7, pageId page-2. " +
      "That size is the director's own rather than a page preset, so laying it out again " +
      "fits the template into their rectangle instead of resizing the page. " +
      "The image above is that page. There is nothing on it.",
  );
});

/// A page still at one of the presets is reshaped by the template it is composed
/// at, which is every board in the app — so there is nothing to warn about and
/// the line is not spent.
test("a page at a preset says nothing about its size beyond the numbers", () => {
  assert.doesNotMatch(pageBriefText(brief(), []), /the director's own/);
});

/// §V.5: a revision that moved between picking and sending means the picture is
/// of a page that no longer exists, and the page goes up as text only. Said,
/// because a model told nothing would answer about an image it was never shown.
test("a page sent without its picture says so rather than pointing at one", () => {
  const said = pageBriefText(brief({ blocks: [image("r1")], rendered: false }), [photograph("r1")]);

  assert.match(said, /There is no picture of it/);
  assert.doesNotMatch(said, /The image above/);
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

/// The server never resolves an id it cannot see in the project. The block stays
/// — it is taking up that room on the page — but it is described as what it is
/// rather than given properties from nowhere.
test("a picture the project does not hold keeps its place and gets no properties", () => {
  const said = pageBriefText(brief({ blocks: [image("gone"), image(null)] }), []);
  const [, first, second] = said.split("\n");

  assert.equal(first, "gone · not one of this project's pictures · [0,0,500,500]");
  assert.equal(second, "not one of this project's pictures · [0,0,500,500]");
});

/// A cap that does not say what it dropped reads as coverage.
test("blocks past the cap are counted in a sentence of their own", () => {
  const said = pageBriefText(brief({ blocks: [image("r1")], omitted: 2 }), [photograph("r1")]);

  assert.equal(said.split("\n").at(-1), "2 more blocks are on this page and are not described.");
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
  assert.equal(said.at(-1), `${24 - described + 3} more blocks are on this page and are not described.`);
});

/// A page answered with no blocks at all is a page the model cannot say anything
/// about — the first line is kept whatever it costs.
test("one block is described even when the budget cannot afford it", () => {
  const said = pageBriefText(brief({ blocks: [image("r1"), image("r2")] }), [wordy("r1"), wordy("r2")], {
    budget: 1,
  }).split("\n");

  assert.equal(said.length, 3);
  assert.match(said[1]!, /^r1 · /);
  assert.equal(said.at(-1), "1 more block is on this page and is not described.");
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
