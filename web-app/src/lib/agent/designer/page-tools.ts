import { PAGE_PRESET_IDS } from "@/lib/layout/moodboard-layouts";
import { MOVE_LIMIT } from "@/lib/agent/orchestrator/board-tools";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";

export const GET_PAGE: ToolDeclaration = {
  name: "get_page",
  description:
    "Look at one page: a picture of it as it stands right now, and the same page in words — which board it is on, which page of how many, its rectangle, and everything on it as a box in reading order. A box is [ymin, xmin, ymax, xmax] in thousandths of the page, y-first, so 500 is halfway down or across whatever size the page is; a block that runs over the edge is marked, and where blocks overlap each one carries the stacking order with 0 at the back. Both halves come off one read of the board, so the words and the picture can never describe different arrangements. Call it after you change a page as well as before: the picture is drawn on the call and shows the change you just made. One page per call. If the picture could not be drawn the answer says so in the text — believe that sentence rather than describing a page you were not shown.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board the page is on.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page to look at. Duplicating a board copies its page ids, so a page is addressed by both ids and never by this one alone.",
      },
    },
    required: ["boardId", "pageId"],
  },
};

export const DESIGNER_DUPLICATE_PAGE: ToolDeclaration = {
  name: "duplicate_page",
  description:
    "Copy one page of a board onto a new page of the same board: the same pictures the same size in the same places, the same lines, inside a rectangle of its own drawn to the right of everything the board already has. The page it was copied from is untouched, and every other page of the board is untouched. It costs nothing, decides nothing and lays nothing out again. This is how a *variation of a page* is started — call it first whenever an arrangement that works is about to be changed into one that might not (\"try that page with the tall shot\", \"another version of the exteriors\", a second layout to put beside the first), then work on the copy with put_on_canvas, transform_on_canvas, remove_from_canvas and reorder_on_canvas naming the new pageId. Copying by hand is the alternative and it is not one: a page of nine pictures is nine put_on_canvas calls that land in the wrong places, and this is one call that lands in the right ones.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board the page is on.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page to copy, by an id from read_canvas or get_page. Required: there is no default page to copy, and the wrong page is somebody else's work.",
      },
      name: {
        type: "STRING",
        description:
          "What to call the copy, when the user said. Leave it out and it is called Page N, counted past the pages the board already carries — the copy is never named after the page it came from, because two pages whose names differ by a bracket are two pages they cannot tell apart out loud.",
      },
    },
    required: ["boardId", "pageId"],
  },
};

export const DESIGNER_RESIZE_PAGE: ToolDeclaration = {
  name: "resize_page",
  description:
    "Change the shape of one page of a board and lay nothing out again: the page becomes the shape you name and every picture and line on it keeps the exact place it has. This is the only call that changes a page's rectangle — transform_on_canvas refuses a page's box and says so — and it is for a page that already exists: \"make that page portrait\", \"turn it on its side\", \"put it back to 16:9\". A page you are about to make is a different act and a freer one, because put_on_canvas takes a box of any proportion at all: decide the shape there, at the rectangle the work is really made at, rather than making a page and reaching for one of the three shapes here. It costs nothing and makes no model call. Read the board with read_canvas or get_page first: pages are told apart by an id and the wrong page is somebody else's work. Because nothing moves, a page made smaller leaves pictures beside it — they stay on the board where they were put and stop being on that page — and a page made larger takes in whatever it now covers; both are reported back, and both are yours to put right with transform_on_canvas. Look at what the new rectangle did with get_page before you say the page is done: an arrangement composed for the old shape rarely stands in the new one.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board the page is on.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page to reshape, by an id from read_canvas or get_page. Required: there is no default page, and reshaping the wrong one moves nothing but describes a different page from then on.",
      },
      preset: {
        type: "STRING",
        description:
          "The shape to give it: LANDSCAPE_HD, PORTRAIT_HD or SQUARE. These three and no others, which is what makes this call the wrong place to settle a proportion — a page that belongs at any other rectangle is one you put with put_on_canvas at that box. A page already at the shape you name is left alone and said so.",
        enum: [...PAGE_PRESET_IDS],
      },
    },
    required: ["boardId", "pageId", "preset"],
  },
};

export const DESIGNER_MOVE_TO_PAGE: ToolDeclaration = {
  name: "move_to_page",
  description:
    `Carry pictures from one page of a board onto another page of the same board. They come off the page they were on and join the other one where there is room, at the size that page's own pictures are — so the board holds each of them once when it is done, and nothing else on either page moves. This is the call for "that shot belongs on the second page" and for emptying a page you are about to reuse. Do not do it with transform_on_canvas: a picture's box is in thousandths of the page holding it, so moving one across means recomputing its box against a rectangle of another size, and a number that is slightly wrong drops it over what is already there or off the page altogether. It costs nothing and makes no model call. What lands is placed below what the page already holds rather than composed into it, so look at the page with get_page afterwards and arrange it with transform_on_canvas and reorder_on_canvas — that is your work, not this call's. At most ${MOVE_LIMIT} pictures a call.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board both pages are on.",
      },
      fromPageId: {
        type: "STRING",
        description:
          "The page the pictures are on now, by an id from read_canvas or get_page. Required: a picture is taken off a page, and one that is not on this page is not moved — it is named back to you so you can name the page it is really on instead.",
      },
      toPageId: {
        type: "STRING",
        description:
          "The page they are to go on, by an id from the same read. Required, and it must be a different page of the same board — to put a picture on a board it is not on at all use put_on_canvas, and to make the page it is going to first use put_on_canvas with kind \"page\".",
      },
      referenceIds: {
        type: "ARRAY",
        description:
          "The pictures to carry across, by referenceId rather than by objectId — a photograph is moved as a photograph, and a page carrying two copies of one loses both and gains one. Read them off the page they are coming off.",
        items: { type: "STRING" },
      },
    },
    required: ["boardId", "fromPageId", "toPageId", "referenceIds"],
  },
};

export const DESIGNER_DISCARD_PAGE: ToolDeclaration = {
  name: "discard_page",
  description:
    "Offer to take one page off a board and leave the rest of the board standing. This deletes nothing and nothing you call ever will: the answer comes back with what is on that page — the photographs standing on it and the lines written on it, which all come off the board with the page — and putting that to the user is your closing line's job. Say which page it is and what they would lose by name, that the photographs stay in the gallery, that the board's other pages are untouched, and that it cannot be undone once taken; never say the page is gone, removed or deleted. Call it when the user wants a page gone (\"lose the second page\", \"bin the one you just made\"), and only for the page they named. Taking a few pictures off a page while keeping the page is a different act and a free one: that is remove_from_canvas. Emptying a page you mean to reuse is move_to_page.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board the page is on.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page to offer for discarding, by an id from read_canvas or get_page. Required: there is no default page to throw away, and the wrong page is somebody else's work.",
      },
    },
    required: ["boardId", "pageId"],
  },
};
