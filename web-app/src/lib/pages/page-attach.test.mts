import { test } from "node:test";
import assert from "node:assert/strict";

import {
  attachedPageInput,
  pageChoiceKey,
  pageChoiceNote,
  pagesAfterPick,
  pagesStillOnBoard,
  type PageChoice,
} from "@/lib/pages/page-attach";
import type { PageDigest } from "@/lib/pages/page-contents";

function choice(pageId: string, over: Partial<PageChoice> = {}): PageChoice {
  return { boardId: "board_1", pageId, revision: 4, name: pageId, ...over };
}

function digest(over: Partial<PageDigest> = {}): PageDigest {
  return {
    pageId: "page_1",
    name: "Act one",
    position: 1,
    of: 2,
    width: 1920,
    height: 1080,
    preset: "LANDSCAPE_HD",
    pictures: 3,
    lines: 2,
    shapes: 0,
    clipped: 0,
    ...over,
  };
}

test("a page is addressed by its board as well as its id, so two boards can carry one page id", () => {
  assert.notEqual(
    pageChoiceKey({ boardId: "board_1", pageId: "page_1" }),
    pageChoiceKey({ boardId: "board_2", pageId: "page_1" }),
  );
});

test("picking a page attaches it", () => {
  assert.deepEqual(pagesAfterPick([], choice("page_1")), [choice("page_1")]);
});

test("picking the same page again takes it back off", () => {
  const picked = pagesAfterPick([choice("page_1"), choice("page_2")], choice("page_1"));
  assert.deepEqual(
    picked.map((page) => page.pageId),
    ["page_2"],
  );
});

test("the same page id on another board is a second page rather than a toggle", () => {
  const picked = pagesAfterPick(
    [choice("page_1")],
    choice("page_1", { boardId: "board_2", name: "Other" }),
  );
  assert.deepEqual(
    picked.map((page) => `${page.boardId}:${page.pageId}`),
    ["board_1:page_1", "board_2:page_1"],
  );
});

test("a pick past the cap drops the oldest rather than being ignored", () => {
  const picked = pagesAfterPick(
    [choice("page_1"), choice("page_2")],
    choice("page_3"),
    /// The message's own limit, passed rather than assumed so the rule is the
    /// thing under test and not the constant.
    2,
  );
  assert.deepEqual(
    picked.map((page) => page.pageId),
    ["page_2", "page_3"],
  );
});

test("a page the board no longer has is dropped from the selection", () => {
  const picked = pagesStillOnBoard([choice("page_1"), choice("page_2")], {
    boardId: "board_1",
    revision: 5,
    pages: [{ pageId: "page_2", name: "Act two" }],
  });
  assert.deepEqual(
    picked.map((page) => page.pageId),
    ["page_2"],
  );
});

test("a page still on the board takes the name and revision it now stands at", () => {
  const [page] = pagesStillOnBoard([choice("page_1", { name: "Page 1" })], {
    boardId: "board_1",
    revision: 9,
    pages: [{ pageId: "page_1", name: "Cold open" }],
  });
  assert.deepEqual(page, {
    boardId: "board_1",
    pageId: "page_1",
    revision: 9,
    name: "Cold open",
  });
});

test("a pick on another board is left alone by the board this list is of", () => {
  const picked = pagesStillOnBoard([choice("page_1", { boardId: "board_2" })], {
    boardId: "board_1",
    revision: 5,
    pages: [],
  });
  assert.deepEqual(picked, [choice("page_1", { boardId: "board_2" })]);
});

test("the chip's note is the size and the blocks on the page", () => {
  assert.equal(pageChoiceNote(digest()), "1920×1080 · 5 blocks");
});

test("a page holding one thing says block rather than blocks", () => {
  assert.equal(pageChoiceNote(digest({ pictures: 1, lines: 0 })), "1920×1080 · 1 block");
});

/// The chip and the brief are one description of one page (§XI.5): a page whose
/// ground is a colour block is described to the model as three blocks, so a chip
/// that said two would be the picker and the prompt disagreeing about the same
/// rectangle.
test("a shape on the page is one of the blocks the chip counts", () => {
  assert.equal(pageChoiceNote(digest({ pictures: 2, lines: 0, shapes: 1 })), "1920×1080 · 3 blocks");
});

test("a picture hanging over the page edge is said in the note", () => {
  assert.equal(
    pageChoiceNote(digest({ pictures: 2, lines: 0, clipped: 1 })),
    "1920×1080 · 2 blocks · 1 over the edge",
  );
});

test("what goes on the wire is the pointer, without the user's label for it", () => {
  assert.deepEqual(attachedPageInput([choice("page_1", { name: "Act one" })]), [
    { boardId: "board_1", pageId: "page_1", revision: 4 },
  ]);
});

test("a page that was drawn carries the picture and the revision the picture is of", () => {
  assert.deepEqual(
    attachedPageInput(
      [choice("page_1")],
      [
        {
          boardId: "board_1",
          pageId: "page_1",
          revision: 5,
          renderUri: "gs://bucket/projects/p/boards/board_1/pages/page_1@5.png",
        },
      ],
    ),
    [
      {
        boardId: "board_1",
        pageId: "page_1",
        revision: 5,
        renderUri: "gs://bucket/projects/p/boards/board_1/pages/page_1@5.png",
      },
    ],
  );
});

test("a page nothing drew keeps the revision it was picked at and carries no picture", () => {
  assert.deepEqual(
    attachedPageInput(
      [choice("page_1"), choice("page_2")],
      [{ boardId: "board_1", pageId: "page_1", revision: 5, renderUri: "gs://bucket/one.png" }],
    ),
    [
      { boardId: "board_1", pageId: "page_1", revision: 5, renderUri: "gs://bucket/one.png" },
      { boardId: "board_1", pageId: "page_2", revision: 4 },
    ],
  );
});

test("a picture of the same page id on another board is not handed to this one", () => {
  assert.deepEqual(
    attachedPageInput(
      [choice("page_1")],
      [{ boardId: "board_2", pageId: "page_1", revision: 5, renderUri: "gs://bucket/other.png" }],
    ),
    [{ boardId: "board_1", pageId: "page_1", revision: 4 }],
  );
});
