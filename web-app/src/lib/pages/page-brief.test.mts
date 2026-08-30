import { test } from "node:test";
import assert from "node:assert/strict";

import { PAGES_PER_MESSAGE, pageBriefText, type PageBrief } from "@/lib/pages/page-brief";
import { PAGE_BLOCK_CAP, type PageBlock } from "@/lib/pages/page-blocks";
import type { ToolReference } from "@/lib/agent/shared/reference";

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

test("a page at a preset says nothing about its size beyond the numbers", () => {
  assert.doesNotMatch(pageBriefText(brief(), []), /the user's own/);
});

test("a page sent without its picture says so rather than pointing at one", () => {
  const said = pageBriefText(brief({ blocks: [image("r1")], rendered: false }), [photograph("r1")]);

  assert.match(said, /There is no picture of it/);
  assert.doesNotMatch(said, /The image above/);
});

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

test("blocks meeting at an edge are not called a stack", () => {
  const said = pageBriefText(
    brief({
      blocks: [image("r1", { box: [0, 0, 500, 501] }), image("r2", { box: [0, 500, 500, 1000], z: 1 })],
    }),
    [photograph("r1"), photograph("r2")],
  );

  assert.doesNotMatch(said, /· z /);
});

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

test("a picture the project does not hold keeps its place and gets no properties", () => {
  const said = pageBriefText(
    brief({ blocks: [image("gone"), image(null, { box: [0, 600, 500, 1000], z: 1 })] }),
    [],
  );
  const [, first, second] = said.split("\n");

  assert.equal(first, "gone · not one of this project's pictures · [0,0,500,500]");
  assert.equal(second, "not one of this project's pictures · [0,600,500,1000]");
});

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

test("a message carries at most two pages", () => {
  assert.equal(PAGES_PER_MESSAGE, 2);
});

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

test("a page of long lines keeps a line for every block the cap allows", () => {
  const blocks = Array.from({ length: PAGE_BLOCK_CAP }, (_, at) => image(`r${at}`));
  const references = blocks.map((_, at) => wordy(`r${at}`));

  const said = pageBriefText(brief({ blocks }), references).split("\n");

  assert.equal(said.length, 1 + blocks.length);
  assert.match(said[0]!, new RegExp(`${PAGE_BLOCK_CAP} blocks on it, in reading order:$`));
  assert.match(said.at(-1)!, /^r23 · /);
});

test("what the cap left out is counted in a sentence of its own", () => {
  const blocks = Array.from({ length: PAGE_BLOCK_CAP }, (_, at) => image(`r${at}`));
  const references = blocks.map((_, at) => wordy(`r${at}`));

  const said = pageBriefText(brief({ blocks, omitted: 3 }), references).split("\n");

  assert.match(said[0]!, new RegExp(`${PAGE_BLOCK_CAP} blocks on it, in reading order:$`));
  assert.equal(
    said.at(-1),
    "3 more blocks are on this page and are not described — the smallest things on it.",
  );
});

test("every block the caller was given keeps its line", () => {
  const blocks = Array.from({ length: 8 }, (_, at) => image(`r${at}`));
  const said = pageBriefText(
    brief({ blocks }),
    blocks.map((_, at) => photograph(`r${at}`)),
  ).split("\n");

  assert.equal(said.length, 1 + blocks.length);
  assert.match(said[0]!, /8 blocks on it, in reading order:$/);
});

test("the door the model opens says who is looking without changing the rest", () => {
  const attached = pageBriefText(brief({ blocks: [image("r1")] }), [photograph("r1")]);
  const asked = pageBriefText(brief({ blocks: [image("r1")], door: "asked" }), [
    photograph("r1"),
  ]);

  assert.match(asked, /^This is “Act one” — page 2 of 4 of the board “Cold open”, 1920×1080, /);
  assert.doesNotMatch(asked, /attached/);
  assert.doesNotMatch(asked, /The image above/);
  assert.match(asked, /The picture that came back with this answer is that page/);
  assert.equal(asked.split("\n").slice(1).join("\n"), attached.split("\n").slice(1).join("\n"));
});

test("an unnamed page asked for by the model still opens on the board it is on", () => {
  const said = pageBriefText(brief({ page: { ...PAGE, name: "" }, door: "asked" }), []);
  assert.match(said, /^This is page 2 of 4 of the board “Cold open”/);
});

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
  assert.equal(lines[2], "line · #1e1e1e · [500,100,500,900]");
});

test("a faded photograph and a faded line of type say so as well", () => {
  const lines = pageBriefText(
    brief({
      blocks: [
        { kind: "text", text: "under it", opacity: 30, box: [0, 0, 100, 900], z: 0 },
        { kind: "image", referenceId: "ref-a", opacity: 40, box: [100, 0, 1000, 1000], z: 1 },
      ],
    }),
    [photograph("ref-a")],
  ).split("\n");

  assert.equal(lines[1], "text · “under it” · 30% opaque · [0,0,100,900]");
  assert.match(lines[2]!, /40% opaque/);
});
