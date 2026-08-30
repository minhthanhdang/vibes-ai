import { REWORD_LIMIT, SWAP_LIMIT } from "@/lib/agent/orchestrator/board-tools";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";

export const DESIGNER_SWAP_ON_BOARD: ToolDeclaration = {
  name: "swap_on_board",
  description:
    `Put one picture in the place of another and leave the page otherwise exactly as it is — the replacement takes the box the old one had, at the size and in the stacking order it had, and nothing else moves. Name a picture the page already holds as putOn and the two trade places instead, which is how "those two should swap" is done. Prefer it to remove_from_canvas and put_on_canvas for any picture-for-picture replacement: those two are a box you have to work out again from a read, and this one keeps the box that was already right. It costs nothing and makes no model call. At most ${SWAP_LIMIT} exchanges a call.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board the pictures are on.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page the exchange is on, by an id from read_canvas or get_page. Name it whenever the board has more than one page: the same photograph can be on two of them, and without a page the picture taken off is whichever copy the board carries first. Both ends are then looked for on that page alone, and nothing on the board's other pages moves.",
      },
      swaps: {
        type: "ARRAY",
        description:
          "The exchanges to make. Each names the picture that is on the page now and the one to put in its place, both by imageId — read the page first if you are not sure which pictures are on it. Both may be pictures the page already holds, and then they trade places.",
        items: {
          type: "OBJECT",
          properties: {
            takeOff: {
              type: "STRING",
              description: "The picture on the page now, by imageId.",
            },
            putOn: {
              type: "STRING",
              description: "The picture to put in its place, by imageId.",
            },
          },
          required: ["takeOff", "putOn"],
        },
      },
    },
    required: ["boardId", "swaps"],
  },
};

export const DESIGNER_REWORD_ON_BOARD: ToolDeclaration = {
  name: "reword_on_board",
  description:
    `Change the words of a line already on a page and leave everything else exactly as it is — the block keeps its box, its size, its colour and its place in the stacking order. This is how a typo is fixed, a headline is rewritten or a caption is put in different words. It is the only call that changes what a line says: restyle_on_canvas changes how a line looks and not what it reads, and taking the block off and placing it again loses the stacking it had and re-wraps it at whatever box you give the replacement. Use put_on_canvas for a line the page does not carry and remove_from_canvas to take one off. Read the page first and quote the line exactly as it came back — matching is on the words, so a wording the page does not carry changes nothing. It costs nothing and makes no model call. At most ${REWORD_LIMIT} lines a call.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board the line is on.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page the line is on, by an id from read_canvas or get_page. Name it whenever the board has more than one page: pages of a spread carry the same words often — a heading in the same place on each — and without a page the line rewritten is whichever copy the board carries first. Nothing on the board's other pages is read or changed.",
      },
      rewordings: {
        type: "ARRAY",
        description:
          "The lines to rewrite. Each names the line as the page carries it now and the words to put in its place.",
        items: {
          type: "OBJECT",
          properties: {
            from: {
              type: "STRING",
              description: "The line as it is on the page now, quoted as the read reported it.",
            },
            to: {
              type: "STRING",
              description:
                "What it should say instead. To take the line off entirely, use remove_from_canvas rather than an empty string.",
            },
          },
          required: ["from", "to"],
        },
      },
    },
    required: ["boardId", "rewordings"],
  },
};
