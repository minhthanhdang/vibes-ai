import {
  CANVAS_STROKE_MAX,
  CANVAS_TEXT_MAX_FONT,
  FONT_NAMES,
} from "@/lib/canvas-objects/object-style";
import { CANVAS_BACKGROUND_DEFAULT } from "@/lib/boards/board-background";
import { PAGE_BACKGROUND_NONE } from "@/lib/pages/page-background";
import { LAYOUT_TEXT_MAX_FONT, LAYOUT_TEXT_MIN_FONT } from "@/lib/layout/moodboard-layouts";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";

/// The canvas dialect, and the one page tool written in it — the declarations
/// agent 6 and agent 8 hand their model as the same object rather than as two
/// wordings of one surface.
///
/// A fork here is two prompts describing the same handles, and a board is the
/// thing both agents are looking at: what `read_canvas` returns is what
/// `transform_on_canvas` takes, whichever of them asked.

/// The one page tool that is not forked for agent 8, because it points at the
/// read *both* agents have.
export const SET_PAGE_BACKGROUND: ToolDeclaration = {
  name: "set_page_background",
  description: `Paint one page of a board a colour, or take its colour off. This is how "make that page black", "give it a warm background", "put it back on white" are done, and it is the only way a page gets a ground: a page's colour is the page's own, so it is never a rectangle placed on top of one — a rectangle you draw is an object that can be moved, restacked and picked up by accident, and this is not. It costs nothing and makes no model call. Nothing on the page moves and nothing is taken off: the ground goes behind everything already standing there, which is worth thinking about before you paint, because near-black lettering on a page painted near-black is a page that looks emptied without anything having left it. Read the board with read_canvas first — pages are told apart by an id, the wrong page is somebody else's work, and each page there says the colour it already stands on. A page already that colour is left alone and said so, and painting a second colour repaints the page rather than stacking one ground on another.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board the page is on, by an id from read_canvas.",
      },
      pageId: {
        type: "STRING",
        description:
          "The page to paint, by an id from read_canvas. Required: there is no default page, and painting the wrong one is a change to somebody else's work that nothing on the page you meant will show.",
      },
      colour: {
        type: "STRING",
        description: `The colour, as a hex like #0c111c or #f4efe6 — or "${PAGE_BACKGROUND_NONE}" to take the page's ground off and leave it standing on whatever the board itself is. A word for a colour is not a colour here and is refused rather than guessed at.`,
      },
    },
    required: ["boardId", "pageId", "colour"],
  },
};

/// The board's own ground, and the one canvas tool of this set agent 8 does not
/// get.
export const SET_CANVAS_BACKGROUND: ToolDeclaration = {
  name: "set_canvas_background",
  description: `Paint a whole board — the canvas itself, the surface every page on it sits on — a colour, or put it back on plain white. This is how "make that board dark", "put the whole thing on charcoal", "back to white" are done when they mean the board rather than one page of it. It costs nothing and makes no model call, and it moves nothing and takes nothing off: the canvas is behind everything, so photographs, type and pages all stay exactly where they are. Use set_page_background instead when they mean one page — a page painted its own colour keeps it, and the canvas is then only what shows around and between the pages. Worth saying before you paint: this is what an unpainted page is drawn on, so a board put on near-black is every plain page on it going near-black too, and near-black lettering standing on one disappears without anything having been taken off it. A board already that colour is left alone and said so.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board to paint, by an id from your instructions or list_boards.",
      },
      colour: {
        type: "STRING",
        description: `The colour, as a hex like #0c111c or #f4efe6 — or "${CANVAS_BACKGROUND_DEFAULT}" to put the board back on the white it was made on. A word for a colour is not a colour here and is refused rather than guessed at.`,
      },
    },
    required: ["boardId", "colour"],
  },
};


/// How many objects one call may put on a canvas, on the same terms.
export const CANVAS_PUT_LIMIT = 10;

/// How many selectors one call may take off a canvas — the asks rather than the
/// elements, since one selector can sweep several.
export const CANVAS_REMOVE_LIMIT = 10;

/// How many changes one call may transform, on the same terms.
export const CANVAS_TRANSFORM_LIMIT = 10;

/// How many moves one call may reorder, on the same terms.
export const CANVAS_REORDER_LIMIT = 10;

/// How many objects one call may restyle, on the same terms again.
export const CANVAS_RESTYLE_LIMIT = 10;

export const READ_CANVAS: ToolDeclaration = {
  name: "read_canvas",
  description:
    "Read where everything on a board is: every picture, line of text (with the colour, size, family and alignment it is set in), shape (a rectangle, ellipse or line, with its own fill and stroke) and page as an object with the handle to grab it by (objectId), its box, its rotation in degrees, its stacking order (z, among its own company — a page's objects, loose objects, pages — 0 at the back), the page holding it, opacity on anything faded below whole, and locked and clipped marks. Anything else drawn on the board — an arrow, a diamond, a freehand stroke, an embed, a label bound to a shape — has no handle and is counted in unaddressable rather than left out silently. Boxes are [ymin, xmin, ymax, xmax], in thousandths of the holding page for an object on one and in scene pixels for pages and for objects loose on the canvas — each object says which in boxUnit. It costs nothing, changes nothing and shows nothing; it is not inspect_board, which answers what a board holds and how it stands as composed — this answers where each thing is and by what handle. Read it before transform_on_canvas, restyle_on_canvas, reorder_on_canvas or remove_from_canvas, the way inspect_board is read before a content edit: every objectId those tools take comes from here, and a referenceId is not a handle — the same photo placed twice is two objects.",
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
          "One page of that board, by an id from a pages list inspect_board gave you or a page object this tool read — leave it out to read the whole board. Naming a page reads the objects standing on that page alone.",
      },
    },
    required: ["boardId"],
  },
};

export const PUT_ON_CANVAS: ToolDeclaration = {
  name: "put_on_canvas",
  description:
    `Put objects onto a board one by one: a picture by its reference id, a line of text, a shape (a rectangle, an ellipse or a line), or an empty page, each at an optional box. This is the tool for when the place is already known — "put the stairwell in the top right", "a caption under that one", "an empty page after this" — because a box here lands exactly there and nothing else on the board is re-decided; when a whole page has to be arranged rather than one thing put somewhere, that is design_page's. A box is [ymin, xmin, ymax, xmax] as read_canvas speaks it: thousandths of the page when the object names a pageId, scene pixels when it does not. A picture keeps its own shape inside the box rather than stretching to it, and one the target page or board already carries is not doubled — it is answered back as alreadyOn. Left without a box, the object is placed into free room beside what is already there, and nothing already on the board moves either way — except a shape, which always names its box, since there is a house rule for where a photograph and a headline go and none for where a colour field goes. A shape is exactly its box and may be flat: a rule is a line with the same ymin and ymax. The style fields below land with the object; one asked of a kind it does not apply to — a fill on a line of text — is refused with the reason rather than dropped. At most ${CANVAS_PUT_LIMIT} objects a call — the surplus is reported back, so call again with them rather than telling the user they were placed.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      objects: {
        type: "ARRAY",
        description:
          "The objects to put on, in the order they should land. Each names its kind and the field that kind needs: an image needs referenceId, text needs text, a page takes an optional name.",
        items: {
          type: "OBJECT",
          properties: {
            kind: {
              type: "STRING",
              description: "What this object is: a picture, a line of text, a shape, or an empty page.",
              enum: ["image", "text", "shape", "page"],
            },
            referenceId: {
              type: "STRING",
              description:
                "For an image: the picture to put on, by an id from the list in your instructions or list_references.",
            },
            text: {
              type: "STRING",
              description: "For text: the words to set, as they should read on the board.",
            },
            name: {
              type: "STRING",
              description:
                "For a page: what to call it, when the user said. Left out it is called Page N past the pages the board already carries.",
            },
            pageId: {
              type: "STRING",
              description:
                "The page an image or a line goes on, by an id from read_canvas or inspect_board. With it the box is in thousandths of that page; without it the object goes loose on the canvas and the box is scene pixels. A page being put cannot itself name one.",
            },
            box: {
              type: "ARRAY",
              description:
                "Where exactly it goes: [ymin, xmin, ymax, xmax], thousandths of the named page or scene pixels without one. A box may go outside 0–1000, and a picture put past the page's edge is drawn cut off there — so a picture that has to cover a page it is not the shape of goes on at a box big enough to bleed off both edges. Leave it out to have a place found — free room beside what is there, never on top of it.",
              items: { type: "NUMBER" },
            },
            shape: {
              type: "STRING",
              description:
                "For a shape: which one. A rectangle or an ellipse is a colour field, a scrim over a photograph or a border; a line is a rule.",
              enum: ["rectangle", "ellipse", "line"],
            },
            fill: {
              type: "STRING",
              description:
                "A shape's inside, as a hex colour or transparent. A fill asked for with no stroke lands with no outline — a colour field rather than a box.",
            },
            stroke: {
              type: "STRING",
              description: "A shape's outline, as a hex colour or transparent.",
            },
            strokeWidth: {
              type: "NUMBER",
              description: `A shape's outline in scene units, over 0 and up to ${CANVAS_STROKE_MAX}. 1 is thin.`,
            },
            strokeStyle: {
              type: "STRING",
              description: "A shape's outline: solid, dashed or dotted.",
              enum: ["solid", "dashed", "dotted"],
            },
            rounded: {
              type: "BOOLEAN",
              description:
                "True for a shape or a picture with rounded corners; left out, they are square.",
            },
            colour: {
              type: "STRING",
              description:
                "For text: the ink, as a hex colour. Left out it is near-black, and near-black type over a dark photograph is type nobody can read.",
            },
            font: {
              type: "STRING",
              description:
                "For text: the family. hand is excalidraw's own hand-drawn one and is what a line lands in when this is left out; sans is neutral, mono is for data and captions, rounded is soft, display is heavy — for a headline that has to carry a page.",
              enum: FONT_NAMES,
            },
            align: {
              type: "STRING",
              description: "For text: where the words sit in their box — left, center or right.",
              enum: ["left", "center", "right"],
            },
            fontSize: {
              type: "NUMBER",
              description: `For text: the size in scene units, ${LAYOUT_TEXT_MIN_FONT} through ${CANVAS_TEXT_MAX_FONT}. Said, it is the size set. Left out, the size follows the box height and is capped at ${LAYOUT_TEXT_MAX_FONT} — so a headline meant to fill a page says the number.`,
            },
            opacity: {
              type: "NUMBER",
              description:
                "0 through 100, on a shape, a line of text or a picture; 100 is solid. A photograph at 40% is a scrim with nothing added to the page.",
            },
          },
          required: ["kind"],
        },
      },
    },
    required: ["boardId", "objects"],
  },
};

export const REMOVE_FROM_CANVAS: ToolDeclaration = {
  name: "remove_from_canvas",
  description:
    `Take objects off a board and leave everything else exactly where it is. Each selector is tried as an objectId from read_canvas first — the one sure handle, since the same photo placed twice is two objects — then as a referenceId, which takes every copy of that picture off the board, then as the words of a line of text as the board carries them. A page's id takes that page off with the arrangement standing on it, which is the same act discard_page offers with a button — so offer the discard when the user is deciding and use this only when they have already said out loud that it goes. Nothing leaves the project: a picture taken off a board is still in the gallery, and putting it back is one put_on_canvas call. Locked objects are refused rather than removed, and a selector that matches nothing on the board is named back as notOnBoard, never dropped silently. At most ${CANVAS_REMOVE_LIMIT} selectors a call — the surplus is reported back, so call again with them.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      objects: {
        type: "ARRAY",
        description:
          "What to take off: objectIds from read_canvas, or a referenceId to take every copy of a picture, or a line's words quoted as the board carries them, or a pageId to take a page and what is on it.",
        items: { type: "STRING" },
      },
    },
    required: ["boardId", "objects"],
  },
};

export const TRANSFORM_ON_CANVAS: ToolDeclaration = {
  name: "transform_on_canvas",
  description:
    `Move, rotate and resize objects on a board, several changes in one call, and leave everything you did not name exactly where it is. This is how "move it 200 left", "turn that a little", "make it bigger" are done — prefer it over design_page for any change that is pure geometry, because a design re-decides the whole page and gives back an arrangement nobody asked for. Read the board with read_canvas first: a change is written against the box that read reported, in the same dialect — thousandths of the holding page, scene pixels for pages and loose objects. The rules it keeps: a page cannot be rotated and its shape is resize_page's to change — both are refused with the reason, never silently skipped; a locked object, or any group with a locked member, is refused; a grouped object moves its whole group rigidly, so name one member and the group follows; a picture keeps its own proportions when resized unless the change says stretch, text resizes by its type size, and a shape takes the size asked exactly because a colour block has no proportions to keep; moving a page carries everything standing on it. A change asking for what is already true writes nothing. At most ${CANVAS_TRANSFORM_LIMIT} changes a call — the surplus is reported back, so call again with them.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      changes: {
        type: "ARRAY",
        description:
          "The changes to make, each naming one object and any of a new place, a new angle and a new size — one object once per call.",
        items: {
          type: "OBJECT",
          properties: {
            objectId: {
              type: "STRING",
              description: "The object to change, by its handle from read_canvas.",
            },
            to: {
              type: "ARRAY",
              description:
                "Where its top-left corner goes: [ymin, xmin] in the dialect its read box was in — thousandths of its page, scene pixels for a page or a loose object.",
              items: { type: "NUMBER" },
            },
            angle: {
              type: "NUMBER",
              description:
                "The absolute rotation to stand it at, in degrees clockwise as read_canvas reports it — not a delta. 0 stands it straight. Pages cannot rotate.",
            },
            size: {
              type: "ARRAY",
              description:
                "The extent to give it: [height, width] in the same dialect as to. A picture keeps its proportions inside it unless stretch is set; text scales its type size to fit; a shape takes it exactly.",
              items: { type: "NUMBER" },
            },
            stretch: {
              type: "BOOLEAN",
              description:
                "Stretch a lone picture to exactly size instead of keeping its proportions — only when the user asked for the distortion, since a photo forced to a shape is usually a crop_reference ask in disguise.",
            },
          },
          required: ["objectId"],
        },
      },
    },
    required: ["boardId", "changes"],
  },
};

export const RESTYLE_ON_CANVAS: ToolDeclaration = {
  name: "restyle_on_canvas",
  description:
    `Change how objects on a board look and move nothing: a shape's fill, outline and corners, a line of text's ink, family, alignment and size, a picture's corners, and the opacity of any of them. This is how "make that block navy", "set the names in the heavy face", "drop the photo back so the type reads" are done. Read the board with read_canvas first — every objectId comes from there, and it reports each shape's fill, stroke and opacity so you can see what you are changing. Each field belongs to a kind: fill, stroke, strokeWidth and strokeStyle are a shape's, rounded is a shape's or a picture's, colour, font, align and fontSize are a line of text's, and opacity is a shape's, a line's or a picture's. A field asked of the wrong kind is refused with the reason and the rest of that change is still made, so nothing is dropped silently. A page takes none of them, a locked object is refused, and a field already set to what you asked writes nothing. Prefer this over taking an object off and putting it back: the object keeps its place, its size and its stacking. At most ${CANVAS_RESTYLE_LIMIT} objects a call — the surplus is reported back, so call again with them.`,
  parameters: {
    type: "OBJECT",
    properties: {
      boardId: {
        type: "STRING",
        description: "The board, by an id from your instructions or list_boards.",
      },
      changes: {
        type: "ARRAY",
        description:
          "The objects to restyle, each naming one object and the fields to set on it — one object once per call.",
        items: {
          type: "OBJECT",
          properties: {
            objectId: {
              type: "STRING",
              description: "The object to restyle, by its handle from read_canvas.",
            },
            fill: {
              type: "STRING",
              description:
                "A shape's inside, as a hex colour or transparent — transparent leaves an outline with the page showing through it.",
            },
            stroke: {
              type: "STRING",
              description:
                "A shape's outline, as a hex colour or transparent — transparent on a filled shape leaves a colour field with no box drawn round it.",
            },
            strokeWidth: {
              type: "NUMBER",
              description: `A shape's outline in scene units, over 0 and up to ${CANVAS_STROKE_MAX}. 1 is thin.`,
            },
            strokeStyle: {
              type: "STRING",
              description: "A shape's outline: solid, dashed or dotted.",
              enum: ["solid", "dashed", "dotted"],
            },
            rounded: {
              type: "BOOLEAN",
              description:
                "True for a shape or a picture with rounded corners, false for square ones.",
            },
            colour: {
              type: "STRING",
              description:
                "For text: the ink, as a hex colour. Near-black type over a dark photograph is type nobody can read.",
            },
            font: {
              type: "STRING",
              description:
                "For text: the family. hand is excalidraw's own hand-drawn one and is what a line lands in unless it was placed with another; sans is neutral, mono is for data and captions, rounded is soft, display is heavy — for a headline that has to carry a page.",
              enum: FONT_NAMES,
            },
            align: {
              type: "STRING",
              description: "For text: where the words sit in their box — left, center or right.",
              enum: ["left", "center", "right"],
            },
            fontSize: {
              type: "NUMBER",
              description: `For text: the size in scene units, ${LAYOUT_TEXT_MIN_FONT} through ${CANVAS_TEXT_MAX_FONT}. The line's box follows the size, so this is how a headline is made to carry without moving it.`,
            },
            opacity: {
              type: "NUMBER",
              description:
                "0 through 100, on a shape, a line of text or a picture; 100 is solid. A photograph at 40% is a scrim with nothing added to the page.",
            },
          },
          required: ["objectId"],
        },
      },
    },
    required: ["boardId", "changes"],
  },
};

export const REORDER_ON_CANVAS: ToolDeclaration = {
  name: "reorder_on_canvas",
  description:
    `Change what draws in front of what on a board, and move nothing: each move sends one object to the front or the back of its own company, or to just above or just below another object. This is how "bring that forward", "put the caption on top", "tuck it behind the wide shot" are done — prefer it over design_page for stacking, because a design re-decides the whole page. Read the board with read_canvas first: the z it reports is stacking among the object's own company — a page's objects against that page's, loose objects against loose, 0 at the back — and front/back mean the front and back of that company, so an object on a page cannot be sent above one on another page; above/below take an objectId of the same company. Moves apply in the order given, each against the board the one before left. A grouped object moves its whole group as one block, a page cannot be reordered (pages do not stack — refused with the reason), locked is refused, and a move asking for what is already true writes nothing. At most ${CANVAS_REORDER_LIMIT} moves a call — the surplus is reported back, so call again with them.`,
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
          "One page of that board, by an id from read_canvas or inspect_board — with it every move is checked against that page's objects alone, and one standing elsewhere is refused rather than moved. Leave it out to address the whole board.",
      },
      moves: {
        type: "ARRAY",
        description:
          "The moves to make, in order. Each names one object and exactly one destination: to front, to back, above another object, or below one.",
        items: {
          type: "OBJECT",
          properties: {
            objectId: {
              type: "STRING",
              description: "The object to restack, by its handle from read_canvas.",
            },
            to: {
              type: "STRING",
              description:
                "front or back of the object's own company. Leave it out when naming above or below instead — each move takes exactly one of the three.",
              enum: ["front", "back"],
            },
            above: {
              type: "STRING",
              description:
                "Draw it just in front of this object, by its handle — an object of the same company.",
            },
            below: {
              type: "STRING",
              description: "Draw it just behind this object, by its handle — same company.",
            },
          },
          required: ["objectId"],
        },
      },
    },
    required: ["boardId", "moves"],
  },
};
