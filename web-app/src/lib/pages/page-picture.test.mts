import { test } from "node:test";
import assert from "node:assert/strict";

import {
  boardMovedUnderPicture,
  pageExportElements,
  pagePicture,
  pagesToPicture,
  pictureIsOfStoredScene,
  sceneStillMoving,
  PICTURE_ATTEMPTS,
} from "@/lib/pages/page-picture";
import type { PagePicture } from "@/lib/pages/page-picture";
import type { AutosaveStatus } from "@/lib/scene/moodboard-autosave";
import type { BoardPage } from "@/lib/pages/board-pages";

function choice(boardId: string, pageId: string) {
  return { boardId, pageId, revision: 4, name: pageId };
}

function page(over: Partial<BoardPage> = {}): BoardPage {
  return {
    id: "page_2",
    name: "Act two",
    x: 2000,
    y: 0,
    width: 1920,
    height: 1080,
    preset: "LANDSCAPE_HD",
    createdAs: "LANDSCAPE_HD",
    ...over,
  };
}

function photo(x: number, over: Partial<{ frameId: string | null }> = {}) {
  return { id: `image_${x}`, x, y: 100, width: 400, height: 300, frameId: null, ...over };
}

test("the pages of the board the tab is showing are the ones it can draw", () => {
  const picked = [choice("board_1", "page_1"), choice("board_2", "page_9")];
  assert.deepEqual(
    pagesToPicture(picked, "board_1").map((page) => page.pageId),
    ["page_1"],
  );
});

test("a page of a board nothing has open is not drawn, so it goes up as text alone", () => {
  assert.deepEqual(pagesToPicture([choice("board_2", "page_9")], "board_1"), []);
});

test("no board open at all is no picture rather than a picture of the wrong board", () => {
  assert.deepEqual(pagesToPicture([choice("board_1", "page_1")], null), []);
});

test("the picks keep the order they were picked in", () => {
  const picked = [choice("board_1", "page_2"), choice("board_1", "page_1")];
  assert.deepEqual(
    pagesToPicture(picked, "board_1").map((page) => page.pageId),
    ["page_2", "page_1"],
  );
});

test("a saved board is drawn", () => {
  assert.equal(pictureIsOfStoredScene("idle"), true);
});

test("a board with a save on its way is not drawn — its revision is about to move", () => {
  assert.equal(pictureIsOfStoredScene("pending"), false);
  assert.equal(pictureIsOfStoredScene("saving"), false);
});

test("a board whose save failed is not drawn: the revision has stopped while the canvas has not", () => {
  assert.equal(pictureIsOfStoredScene("error"), false);
  assert.equal(pictureIsOfStoredScene("conflict"), false);
});

test("a board still saving behind the flush is drawn again — the user edited while it was going up", () => {
  assert.equal(sceneStillMoving("pending"), true);
  assert.equal(sceneStillMoving("saving"), true);
});

test("a board whose save failed is not drawn again: the second attempt misses the same way", () => {
  assert.equal(sceneStillMoving("error"), false);
  assert.equal(sceneStillMoving("conflict"), false);
  assert.equal(sceneStillMoving("idle"), false);
});

test("the signer refusing the revision is the board moving under the picture, so it is taken again", () => {
  assert.equal(boardMovedUnderPicture({ data: { code: "CONFLICT" } }), true);
});

test("every other refusal is a miss taking the picture again cannot fix", () => {
  assert.equal(boardMovedUnderPicture({ data: { code: "NOT_FOUND" } }), false);
  assert.equal(boardMovedUnderPicture(new Error("page render upload failed: 503")), false);
  assert.equal(boardMovedUnderPicture({ data: null }), false);
  assert.equal(boardMovedUnderPicture("CONFLICT"), false);
  assert.equal(boardMovedUnderPicture(null), false);
});

test("§V.5 re-renders once and never twice", () => {
  assert.equal(PICTURE_ATTEMPTS, 2);
});

const CONFLICT = { data: { code: "CONFLICT" } };

function drawn(revision: number): PagePicture {
  return {
    boardId: "board_1",
    pageId: "page_2",
    revision,
    renderUri: `gs://boards/board_1/pages/page_2@${revision}.png`,
  };
}

function tab({
  landings,
  draws = [],
}: {
  landings: readonly { status: AutosaveStatus; revision: number }[];
  draws?: readonly ((revision: number) => Promise<PagePicture | null>)[];
}) {
  const counted = { flushes: 0, draws: 0 };
  return {
    counted,
    flush: async () => {
      counted.flushes += 1;
    },
    saved: () => landings[Math.min(counted.flushes, landings.length) - 1]!,
    draw: (revision: number) => {
      const drawing = draws[counted.draws] ?? (async () => drawn(revision));
      counted.draws += 1;
      return drawing(revision);
    },
  };
}

test("a board settled by the flush is drawn once, at the revision it settled on", async () => {
  const canvas = tab({ landings: [{ status: "idle", revision: 5 }] });
  assert.deepEqual(await pagePicture(canvas), drawn(5));
  assert.deepEqual(canvas.counted, { flushes: 1, draws: 1 });
});

test("the signer refusing the revision has the page drawn again at the one the board landed on", async () => {
  const canvas = tab({
    landings: [
      { status: "idle", revision: 5 },
      { status: "idle", revision: 6 },
    ],
    draws: [
      async () => {
        throw CONFLICT;
      },
    ],
  });
  assert.deepEqual(await pagePicture(canvas), drawn(6));
  assert.deepEqual(canvas.counted, { flushes: 2, draws: 2 });
});

test("a board that has moved again under the second attempt goes up as text, not as an error", async () => {
  const canvas = tab({
    landings: [
      { status: "idle", revision: 5 },
      { status: "idle", revision: 6 },
    ],
    draws: [
      async () => {
        throw CONFLICT;
      },
      async () => {
        throw CONFLICT;
      },
    ],
  });
  assert.equal(await pagePicture(canvas), null);
  assert.deepEqual(canvas.counted, { flushes: 2, draws: 2 });
});

test("an edit landing behind the flush is flushed again before anything is drawn", async () => {
  const canvas = tab({
    landings: [
      { status: "pending", revision: 5 },
      { status: "idle", revision: 6 },
    ],
  });
  assert.deepEqual(await pagePicture(canvas), drawn(6));
  assert.deepEqual(canvas.counted, { flushes: 2, draws: 1 });
});

test("a board still moving after the second flush is never drawn at all", async () => {
  const canvas = tab({
    landings: [
      { status: "pending", revision: 5 },
      { status: "saving", revision: 5 },
    ],
  });
  assert.equal(await pagePicture(canvas), null);
  assert.deepEqual(canvas.counted, { flushes: 2, draws: 0 });
});

test("a board whose save failed is text only without a second flush: the revision has stopped", async () => {
  const canvas = tab({ landings: [{ status: "conflict", revision: 5 }] });
  assert.equal(await pagePicture(canvas), null);
  assert.deepEqual(canvas.counted, { flushes: 1, draws: 0 });
});

test("an upload that did not land is the caller's to log rather than a page drawn twice", async () => {
  const canvas = tab({
    landings: [{ status: "idle", revision: 5 }],
    draws: [
      async () => {
        throw new Error("page render upload failed: 503");
      },
    ],
  });
  await assert.rejects(pagePicture(canvas), /503/);
  assert.deepEqual(canvas.counted, { flushes: 1, draws: 1 });
});

test("a page deleted between picking and sending is text only and is not looked for twice", async () => {
  const canvas = tab({
    landings: [{ status: "idle", revision: 5 }],
    draws: [async () => null],
  });
  assert.equal(await pagePicture(canvas), null);
  assert.deepEqual(canvas.counted, { flushes: 1, draws: 1 });
});

test("a photograph on the page whose frameId still names another page is drawn with it", () => {
  const drawn = pageExportElements([photo(2100, { frameId: "page_1" })], page());
  assert.deepEqual(
    drawn.map((element) => element.frameId),
    ["page_2"],
  );
});

test("nothing is written back — the scene keeps the frameId the user's board has", () => {
  const scene = [photo(2100, { frameId: "page_1" })];
  pageExportElements(scene, page());
  assert.equal(scene[0]!.frameId, "page_1");
});

test("an element the page already owns is handed to the exporter as itself", () => {
  const scene = [photo(2100, { frameId: "page_2" })];
  assert.equal(pageExportElements(scene, page())[0], scene[0]);
});

test("an element on no page but sitting on this one is adopted for the export", () => {
  const drawn = pageExportElements([photo(2100)], page());
  assert.equal(drawn[0]!.frameId, "page_2");
});

test("an element off the page is left alone, whatever it says it belongs to", () => {
  const scene = [photo(100, { frameId: "page_1" }), photo(200)];
  assert.deepEqual(
    pageExportElements(scene, page()).map((element) => element.frameId),
    ["page_1", null],
  );
});

test("an element the page owns but that has been dragged off it keeps the page", () => {
  const scene = [photo(100, { frameId: "page_2" })];
  assert.equal(pageExportElements(scene, page())[0], scene[0]);
});

test("the page frame itself is handed to the exporter as itself, never as its own child", () => {
  const frame = { id: "page_2", type: "frame", x: 2000, y: 0, width: 1920, height: 1080 };
  assert.equal(pageExportElements([frame], page())[0], frame);
});

test("a section the page was drawn over is not adopted for the export, but its pictures are", () => {
  const scene = [
    { id: "section_1", type: "frame", x: 2100, y: 100, width: 800, height: 600, frameId: null },
    { ...photo(2200), frameId: "section_1" },
  ];
  assert.deepEqual(
    pageExportElements(scene, page()).map((element) => element.frameId),
    [null, "page_2"],
  );
});

test("membership is by centre, so a photograph mostly off the page is not adopted", () => {
  const drawn = pageExportElements([photo(1750)], page());
  assert.equal(drawn[0]!.frameId, null);
});
