import { PAGE_PRESET_IDS } from "@/lib/layout/moodboard-layouts";
import { EVERYTHING } from "@/lib/agent/orchestrator/state";
import type { ProjectState, ToolDeclaration } from "@/lib/agent/shared/tool-declaration";

/// Agent 6's doors onto the boards: what it may list, read, add to, rearrange
/// and throw away — the edits code makes rather than the ones a model draws.

/// The door to every board that is not the one in front of the user, and cheap
/// enough to be the round it costs — it never reads a scene, which is what
/// separates it from `inspect_board`.
export const LIST_BOARDS: ToolDeclaration = {
  name: "list_boards",
  description:
    "Every board in this project, the one worked on most recently first: its id, what it is called, the size of its pages and how many pages it is laid out on. It reads nothing that is on a board, so it costs one query — this is the answer to which board is which, where inspect_board is the answer to what is on one. Your instructions name only the board the user has open, so this is where the id of every other board comes from: call it whenever they mean a board that is not the one in front of them (“the one from Tuesday”, “the square one”, “my first board”) and take the id off this answer rather than out of the conversation. Every board the project holds is listed, however many that is.",
  /// No arguments: the project is the argument, and it is the caller's rather
  /// than the model's. An empty object rather than no `parameters` key, because
  /// that is the shape the declaration is sent in.
  parameters: {
    type: "OBJECT",
    properties: {},
  },
};

/// One board's line, for a board the instruction did not carry — the pair to
/// `list_boards` and the cheaper half of it.
export const GET_BOARD_BRIEF: ToolDeclaration = {
  name: "get_board_brief",
  description:
    "What one board is: the same line your instructions carry for the board the user has open — its name, the size of its pages, how many pages it is and what they are called — for any other board of this project. It reads nothing that is on the board, so it costs one query. Call it when a board has been named by an id that was not in your instructions and you need to know what it is before acting on it, and call inspect_board instead when the question is what is on it. It changes nothing and shows the user nothing.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description:
          "The board, by an id from list_boards, from the board named in your instructions, or from a tool answer earlier in this turn. An id remembered out of the conversation is a guess.",
      },
    },
    required: ["boardId"],
  },
};

export const INSPECT_BOARD: ToolDeclaration = {
  name: "inspect_board",
  description:
    "Read a board the user already has: which pictures are on it, in the order they read, the lines set on it, the pages it is laid out on, and which pictures sit loosely in their place with page showing around them. Costs nothing and changes nothing, and it shows the board beside your reply. Call it before you change a board, whenever they ask what is on one, and when they ask how a board looks or whether it fits — never rebuild a board to find out what it holds. A board is one or more pages, each a fixed-size rectangle with its own name: read it without a pageId to see them all listed, then read it again naming one to see what is on that page alone.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      pageId: {
        type: "STRING",
        description:
          "One page of that board, by an id from a pages list this tool gave you — leave it out to read the whole board and have its pages listed. Naming a page reads that page alone: the pictures and lines on it in reading order, and which of them run over its edge and are drawn cut off. Read the page the user is talking about before you change it, since a picture on page 2 is not on the board's first page.",
      },
    },
    required: ["boardId"],
  },
};

/// The only tool in agent 6's set that makes a board, and the one that has to
/// exist before any of the others can be called: every declaration below takes
/// a boardId, and `duplicate_board` needs one to copy. It files the row and
/// draws its first page and stops there — what goes *on* that page is
/// `design_page`'s decision and nothing here anticipates it.
///
/// A function of the state for one clause only, and it is the clause most worth
/// having: on a project that already has a board, a second board is very often
/// the wrong answer to "another version of this" and `duplicate_board` is the
/// right one. A project with no boards cannot be told that — the tool it would
/// be sent to is not declared to it.
export function addBoardFor({ boards }: ProjectState): ToolDeclaration {
  return {
    name: "add_board",
    description: [
      "File a new board with one empty page on it. It makes no model call, chooses no picture and decides nothing about how the page should look — it is the rectangle and the tab, and that is all.",
      "This is where a board comes from: call it the moment the user asks for one (\"make me a moodboard of these\", \"start a board for the night work\", \"I need a poster\"), then call design_page with the boardId and pageId it gives back and the user's own words as the intention, which is the call that actually puts something on the page. Both in the same turn — a board filed and left blank is a tab they opened for nothing.",
      boards > 0
        ? "Use duplicate_board instead when they want another version of a board they already have: that copies the arrangement, where this starts from nothing. And a new board every time is a tab row they have to tidy up after you — when the ask is for another page rather than another board, design_page with newPage puts it on the board they are already looking at."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    parameters: {
      type: "OBJECT",
      properties: {
        title: {
          type: "STRING",
          description:
            "What to call it, in the user's own words about what the board is for — it is the name in their tab row, and the only name the board has until they rename it themselves. Pass it on every call: this tool never sees the intention you are about to design with, so a board filed without one is called \"Composed board\" in front of the user.",
        },
        preset: {
          type: "STRING",
          description:
            "The shape of its first page: LANDSCAPE_HD is 1920×1080, PORTRAIT_HD is 1080×1920, SQUARE is 2048×2048. Leave it out for LANDSCAPE_HD. Pass one whenever the user said what shape the thing is — a poster and an album spread are not the same rectangle — because resizing the page afterwards leaves everything designed onto it where it was.",
          enum: [...PAGE_PRESET_IDS],
        },
        pageName: {
          type: "STRING",
          description:
            "What to call that first page, when the user named it (\"a page for the exteriors\", \"act two\"). Leave it out and it is Page 1, which they can rename on the canvas.",
        },
      },
    },
  };
}

export const ADD_BOARD = addBoardFor(EVERYTHING);

export const ADD_PAGE: ToolDeclaration = {
  name: "add_page",
  description:
    "Give a board another page: an empty one, the size of the page it goes beside, drawn to the right of everything already on the board. It decides nothing and lays nothing out — no picture is chosen, nothing that is on the board moves, and no page it already has is touched — so it costs nothing and is safe to call the moment they ask for a page. Call it when they want somewhere new to put pictures (\"give me another page\", \"start a page for the night work\") and when a board they arranged by hand has no page at all: the first page on such a board is drawn around the pictures already there, which makes them that page's, so the board can then be read and composed a page at a time without being laid out again. When they want pictures *on* the new page and arranged there, call design_page with newPage instead — this tool leaves the page blank.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page the new one goes beside, by an id from a pages list inspect_board gave you — it takes that page's size and its top edge. Leave it out and it follows the board's last page, which is what \"another page\" means on a spread. It never replaces the page named: a page is only ever added.",
      },
      name: {
        type: "STRING",
        description:
          "What to call it, when the user said — \"the exteriors\", \"act two\". Leave it out and it is called Page N, counted past the pages the board already carries, which the user can rename on the canvas.",
      },
    },
    required: ["boardId"],
  },
};

export const DUPLICATE_PAGE: ToolDeclaration = {
  name: "duplicate_page",
  description:
    "Copy one page of a board onto a new page of the same board: the same pictures the same size in the same places, the same lines, inside a rectangle of its own drawn to the right of everything the board already has. The page it was copied from is untouched, and every other page of the board is untouched. It costs nothing, decides nothing and lays nothing out again. This is how a *variation of a page* is started — call it first whenever they want to try something on a page without losing the arrangement that works (\"try that page with the tall shot\", \"another version of the exteriors\"), then change the copy with swap_on_board, reword_on_board, put_on_canvas or design_page naming the new pageId. Do not use duplicate_board for this: that makes a second board holding every page, so the pages they were not talking about end up in two places. Do not use design_page with newPage either — that designs a page from nothing, so what comes back is not a copy.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page to copy, by an id from a pages list inspect_board gave you. Required: there is no default page to copy, and the wrong page is somebody else's work.",
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

export const DUPLICATE_BOARD: ToolDeclaration = {
  name: "duplicate_board",
  description:
    "Make a second board holding exactly what a board they already have holds — the same pictures in the same places, the same lines, every page of it — and leave the original untouched. It costs nothing, decides nothing and lays nothing out again. This is how a *variation* is started: call it first whenever they want to try something without losing the board that works (\"another version of this\", \"keep that one and try it with the tall shot\"), then change the copy with swap_on_board, reword_on_board, put_on_canvas or design_page. Every other board tool changes the board they are looking at, so a board worth keeping has to be copied before it is changed rather than after.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board to copy, by an id from your instructions or list_boards.",
      },
      title: {
        type: "STRING",
        description:
          "What to call the copy. Leave it out unless the user named it: the copy is otherwise named after the board it came from, which is what tells the two apart in the tab row.",
      },
    },
    required: ["boardId"],
  },
};

export const DISCARD_BOARD: ToolDeclaration = {
  name: "discard_board",
  description:
    "Offer to throw a board away. This deletes nothing: what it does is put that board in front of the user with a Discard button on it, and they decide. So say what is on the board they would be losing — every page of it, on a board of more than one — and leave the choice with them — never that the board is gone, deleted or removed. Call it when they ask for a board to go (\"bin that one\", \"delete the copy\", \"I don't need the first version\"). Offer only the board they named: a discard cannot be undone once they take it, so never offer to tidy up boards they did not mention, and never offer one after a duplicate or a rebuild unless they asked. Discarding a board takes none of its photographs out of the gallery.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description:
          "The board to offer for discarding, by an id from your instructions or list_boards.",
      },
    },
    required: ["boardId"],
  },
};

export const RESIZE_PAGE: ToolDeclaration = {
  name: "resize_page",
  description:
    "Change the shape of one page of a board and lay nothing out again: the page becomes the size you name and every picture and line on it keeps the exact place it has. This is how \"make that page portrait\", \"turn it on its side\", \"make it square\" and \"put it back to 16:9\" are done, and it is the only call that changes a page's shape without rearranging it — design_page would decide the whole page again on its way past, which is not what they asked for. It costs nothing and makes no model call. Read the board first: pages are told apart by an id and the wrong page is somebody else's work. Because nothing moves, a page made smaller leaves pictures beside it — they stay on the board where the user put them and stop being on that page — and a page made larger takes in whatever it now covers; both are reported back and both are worth saying out loud, and offering to design the page again at its new shape is usually the next thing to say.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page to reshape, by an id from a pages list inspect_board gave you. Required: there is no default page, and reshaping the wrong one moves nothing but describes a different page from then on.",
      },
      preset: {
        type: "STRING",
        description:
          "The shape to give it: LANDSCAPE_HD is 1920×1080, PORTRAIT_HD is 1080×1920, SQUARE is 2048×2048. These are the shapes the layout templates are cut for, so a page at one of them is a page a compose can fill — a rectangle of any other size is the user's own to drag on the canvas. A page already at the size you name is left alone and said so.",
        enum: [...PAGE_PRESET_IDS],
      },
    },
    required: ["boardId", "pageId", "preset"],
  },
};

export const DISCARD_PAGE: ToolDeclaration = {
  name: "discard_page",
  description:
    "Offer to take one page off a board and leave the rest of the board standing. Like discard_board this deletes nothing: it puts that page in front of the user with a Discard button on it, and they decide. What would go is the page and the arrangement on it — the photographs standing on that page come off the board with it, which is what \"drop that page\" means — so say which page and what is on it, and leave the choice with them; never that the page is gone, deleted or removed. Call it when they want a page gone and not the board (\"lose the second page\", \"I don't need the exteriors any more\", \"bin the page you just added\"). Use discard_board instead when they want the whole board. Offer only the page they named — a discard cannot be undone once taken — and read the board first, since a board's pages are told apart by an id and the wrong page is somebody else's work. Taking a page off takes none of its photographs out of the gallery, and a section the user drew inside the page keeps its own pictures.",
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page to offer for discarding, by an id from a pages list inspect_board gave you. Required: there is no default page to throw away.",
      },
    },
    required: ["boardId", "pageId"],
  },
};

/// How many pictures one call may exchange — a legibility ceiling, not a cost
/// one.
export const SWAP_LIMIT = 10;

export const SWAP_ON_BOARD: ToolDeclaration = {
  name: "swap_on_board",
  description:
    `Put one picture on a board in the place of another and leave the board otherwise exactly as it is — the replacement takes the place the old one had and nothing else moves. This is how a cut the user has taken goes onto a board in place of the frame it came from. Name a picture the board already holds as putOn and the two trade places instead, which is how "swap those two around" or "put that one where the wide shot is" is done. It costs nothing, it lays nothing out again, and it never touches a picture you did not name, so prefer it over design_page for any picture-for-picture replacement or for moving pictures around a board they are already on: a design re-decides the whole page and gives back an arrangement they did not ask for. At most ${SWAP_LIMIT} exchanges a call.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page the exchange is on, by an id from a pages list inspect_board gave you. Name it whenever the board has more than one page: the same photograph can be on two of them, and without a page the picture taken off is whichever copy the board carries first, which may be on a page the user is not talking about. Both ends are then looked for on that page alone — a picture that is on another page of the board joins this one in the place named rather than trading across the spread — and nothing on the board's other pages moves. Leave it out on a board of one page.",
      },
      swaps: {
        type: "ARRAY",
        description:
          "The exchanges to make. Each names the picture that is on the board now and the one to put in its place — call inspect_board first if you are not sure which pictures are on it. Both may be pictures the board already holds, and then they trade places.",
        items: {
          type: "OBJECT",
          properties: {
            takeOff: {
              type: "STRING",
              description: "The reference on the board now, by id.",
            },
            putOn: {
              type: "STRING",
              description:
                "The reference to put in its place, by id — usually a cut of the same photograph.",
            },
          },
          required: ["takeOff", "putOn"],
        },
      },
    },
    required: ["boardId", "swaps"],
  },
};

/// How many lines one call may rewrite, on the swap's terms.
export const REWORD_LIMIT = 10;

export const REWORD_ON_BOARD: ToolDeclaration = {
  name: "reword_on_board",
  description:
    `Change the words of a line of text on a board and leave the board otherwise exactly as it is — the line keeps its place and every picture stays exactly where it is. This is how a typo is fixed, a headline is rewritten or a caption is put in different words. It costs nothing and lays nothing out again, so prefer it over design_page for any change to the wording of a line that is already on the board: a design re-decides the whole page and gives back an arrangement they did not ask for. Use put_on_canvas to add a line the board does not carry and remove_from_canvas to take one off. At most ${REWORD_LIMIT} lines a call.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page the line is on, by an id from a pages list inspect_board gave you. Name it whenever the board has more than one page: pages of a spread carry the same words often — a heading in the same place on each — and without a page the line rewritten is whichever copy the board carries first. Nothing on the board's other pages is read or changed. Leave it out on a board of one page.",
      },
      rewordings: {
        type: "ARRAY",
        description:
          "The lines to rewrite. Each names the line as the board carries it now and the words to put in its place — read the board with inspect_board first and quote the line, since matching is on the words and a wording the board does not carry changes nothing.",
        items: {
          type: "OBJECT",
          properties: {
            from: {
              type: "STRING",
              description: "The line as it is on the board now, quoted as inspect_board reported it.",
            },
            to: {
              type: "STRING",
              description:
                "What it should say instead. To take the line off the board entirely, use remove_from_canvas rather than an empty string.",
            },
          },
          required: ["from", "to"],
        },
      },
    },
    required: ["boardId", "rewordings"],
  },
};

/// How many pictures one call may carry across, on the same terms.
export const MOVE_LIMIT = 10;

export const MOVE_TO_PAGE: ToolDeclaration = {
  name: "move_to_page",
  description:
    `Carry pictures from one page of a board to another page of the same board. They come off the page they were on and join the other one where there is room, at the size that page's own pictures are — so the board holds each of them once when it is done, on the page the user asked for. This is how "put the stairwell on the second page instead", "move the exteriors onto the night page" and "that one belongs on page 1" are done. It costs nothing, it makes no model call and it lays neither page out again, so prefer it over design_page for moving pictures between pages: a design re-decides a whole page and gives back an arrangement they did not ask for. Do not use swap_on_board for it — a swap puts a picture in the place of another one and leaves the copy on the page it came from, so the board ends up carrying it twice. Read the board with inspect_board first: both pages are named by id and the wrong page is somebody else's work. At most ${MOVE_LIMIT} pictures a call.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      fromPageId: {
        type: "STRING",
        description:
          "The page the pictures are on now, by an id from a pages list inspect_board gave you. Required: a picture is taken off a page, and a picture that is not on this one is not moved — it is named back to you so you can name the page it is really on instead.",
      },
      toPageId: {
        type: "STRING",
        description:
          "The page they are to go on, by an id from the same pages list. Required, and it must be a different page of the same board — to put a picture on a board it is not on at all use put_on_canvas, and to make the page it is going to first use add_page.",
      },
      referenceIds: {
        type: "ARRAY",
        description:
          "The pictures to carry across, by id, as inspect_board reported them on the page they are coming off. Nothing else on either page moves.",
        items: { type: "STRING" },
      },
    },
    required: ["boardId", "fromPageId", "toPageId", "referenceIds"],
  },
};
