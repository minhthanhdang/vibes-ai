import { COMPOSE_BLOCK_LIMIT } from "@/lib/layout/moodboard-compose";
import {
  LAYOUT_MAX_BLOCKS,
  LAYOUT_MAX_TEXT_BLOCKS,
  LAYOUT_MIN_BLOCKS,
  LAYOUT_REQUESTS,
  LAYOUTS_WITH_TEXT,
} from "@/lib/layout/moodboard-layouts";
import { EVERYTHING, idsFrom } from "@/lib/agent/orchestrator/state";
import type { ProjectState, ToolDeclaration } from "@/lib/agent/shared/tool-declaration";

/// The two tools that are not work agent 6 does — they hand a page to another
/// agent. `compose_moodboard` calls agent 4, `design_page` calls agent 8, and
/// the whole of tech-spec §III.6 is that the orchestrator routes rather than
/// arranging anything itself.

/// The largest declaration in the layer, and eight of its thirteen parameters
/// are about rebuilding a board — the ones gated.
export function composeMoodboardFor({ crops, boards }: ProjectState): ToolDeclaration {
  const rebuild = boards > 0;
  return {
    name: "compose_moodboard",
    description: `Lay the project's pictures out as a moodboard the user can open and keep working on${
      rebuild ? " — a new board, or a rebuild of one they already have if you pass boardId" : ""
    }. This is the one tool that makes something rather than reads something, so call it when a board is asked for and not to illustrate a point — show_references is for that. Offer between ${LAYOUT_MIN_BLOCKS} and ${COMPOSE_BLOCK_LIMIT} references and expect a selection: past ${LAYOUT_MAX_BLOCKS} the surplus is left off the board.`,
    parameters: {
      type: "OBJECT",
      properties: {
        intention: {
          type: "STRING",
          description:
            "What this board is for, in the user's own words — the look it argues for. Used to compose it and, unless you give a title, to name it.",
        },
        ...(rebuild
          ? {
              boardId: {
                type: "STRING",
                description:
                  "A board to rebuild, by an id from your instructions or list_boards. Leave it out to file a new one. A rebuild replaces what is on that board: leave referenceIds out to lay the pictures it already holds out again, use addReferenceIds/removeReferenceIds to change which of them are on it, and give referenceIds only to replace the selection outright. The lines it carries work the same way: addCaptions/removeCaptions to change them, captions only to replace them.",
              },
              pageId: {
                type: "STRING",
                description:
                  "Which page of that board to lay out, by an id from an inspect_board pages list. A board is one or more pages and this composes one of them: the pictures and lines already on that page are what a rebuild keeps, and the board's other pages are not touched. Leave it out on a board of one page. On a board of several, read it with inspect_board first and name the page the user is talking about — left out there, the first page is the one that gets laid out again. A page the user resized keeps the size they made it — the template is fitted into their rectangle rather than the page being reset to the template's — so a page reported as Custom does not change shape when you name a different template for it. With newPage it means something else: the page the new one goes beside.",
              },
              newPage: {
                type: "BOOLEAN",
                description:
                  "Put this arrangement on a page of its own, added to that board — for “put those on another page”, “a second page for the exteriors”, anything that asks for more board rather than a different one. Nothing already on the board is read, moved or written over: the new page lands clear to the right of it, so referenceIds is the whole of what goes on it and there is nothing to add to or keep. Leave it out to lay out a page the board already has, which is what a rebuild is.",
              },
              pageName: {
                type: "STRING",
                description:
                  "What to call a page. Pages are otherwise called Page 1, Page 2 — pass this whenever the user gave one a name of their own (“a page for the exteriors”, “call that one act two”), because the name is what they and you both say the page by afterwards. With newPage it names the page being added; with pageId it renames that page, and passing boardId, pageId and pageName alone renames it and changes nothing else — nothing on the page moves, it is not laid out again and no other page is touched. A board with no pages has nothing to name: call add_page for that.",
              },
            }
          : {}),
        referenceIds: {
          type: "ARRAY",
          description: [
            `Reference ids from ${idsFrom(crops)}, best first.`,
            crops > 0
              ? "Crops count: a cut framed for a shape is often the one that belongs on a board."
              : "",
            rebuild
              ? "Required for a new board; on a rebuild, leave it out to keep the pictures the board already has."
              : "",
          ]
            .filter(Boolean)
            .join(" "),
          items: { type: "STRING" },
        },
        ...(rebuild
          ? {
              addReferenceIds: {
                type: "ARRAY",
                description:
                  "On a rebuild: references to put on the board *as well as* the ones it already holds. Use this when the user wants a picture added — you cannot see what is on a board, so naming the whole set instead would drop the pictures you did not name. Nothing already on the board moves: the picture goes into a free place, and only a board with no room left for it is laid out again.",
                items: { type: "STRING" },
              },
              removeReferenceIds: {
                type: "ARRAY",
                description:
                  "On a rebuild: references to take off the board. Only that picture goes — everything else keeps its place, and taking one off costs no compose at all.",
                items: { type: "STRING" },
              },
            }
          : {}),
        captions: {
          type: "ARRAY",
          description: [
            `Lines to set on the board — a title, a note. Several layouts have a text block and leave it empty without one, and no template carries more than ${LAYOUT_MAX_TEXT_BLOCKS}, so a line per photograph is not a board this makes: name the ${LAYOUT_MAX_TEXT_BLOCKS} that carry the idea.`,
            rebuild
              ? "On a rebuild, leave it out to keep the lines the board already carries; give it only to replace them all."
              : "",
          ]
            .filter(Boolean)
            .join(" "),
          items: { type: "STRING" },
        },
        ...(rebuild
          ? {
              addCaptions: {
                type: "ARRAY",
                description:
                  "On a rebuild: lines to set on the board *as well as* the ones it already carries. Use this to add a line — you cannot see a board's text unless you read it, so listing captions instead would delete the lines you did not repeat. Nothing already on the board moves: the line is set in a free text block, or above the arrangement on a board the user made themselves.",
                items: { type: "STRING" },
              },
              removeCaptions: {
                type: "ARRAY",
                description:
                  "On a rebuild: lines to take off the board, quoted as inspect_board reported them. Matched on the words, so wording it differently takes nothing off and is reported back. Like addCaptions, only that line goes and nothing else moves.",
                items: { type: "STRING" },
              },
            }
          : {}),
        layout: {
          type: "STRING",
          description: [
            "A template by name, or RANDOM to have one chosen by how many blocks are on offer.",
            /// The one thing about a template the model picks blind. RANDOM
            /// seats by kind and cannot get this wrong; a name can, and a
            /// headline asked for and left off is not visible in the answer it
            /// gets back unless it reads `unplaced` as a fault rather than a
            /// choice.
            `Only ${LAYOUTS_WITH_TEXT.join(", ")} carry a line of text — with captions in hand, naming any other template leaves the line off the board, so leave this out and let RANDOM seat them.`,
            rebuild
              ? "Leave it out unless the user asked for a particular shape of board: a rebuild with no template keeps the one the board is already on, and RANDOM would change the shape of a board they only asked you to add a picture to."
              : "Leave it out unless the user asked for a particular shape of board.",
          ].join(" "),
          enum: [...LAYOUT_REQUESTS],
        },
        layoutImageId: {
          type: "STRING",
          description: [
            /// The one argument on this tool whose value is a picture that does
            /// *not* go on the board, so the description leads with what the
            /// picture has to be. A photograph passed here reads as a page of one
            /// enormous placeholder and lays the board out as a single slot.
            "A reference id of a picture of the page itself — placeholder boxes drawn where photographs go and ruled areas where text goes, not a photograph.",
            "The page in that picture becomes the layout: pass it when the user handed in a sketch or a scan of the arrangement they want.",
            "It replaces layout, and naming both is refused — say which of the two they asked for.",
            "The picture is the ask rather than a block, so leave its id out of referenceIds: it is not put on the board.",
          ].join(" "),
        },
        title: {
          type: "STRING",
          description: [
            "What to call the board. A new board defaults to the intention;",
            rebuild
              ? "a rebuilt one keeps the name it already has unless you give one. To rename a board and change nothing else, pass boardId and title alone — that renames it and leaves the arrangement exactly as it is."
              : "give one when the user named it.",
          ].join(" "),
        },
      },
      /// `referenceIds` is no longer required, because a rebuild's selection can
      /// come off the board itself — but a *new* board still needs one, and the
      /// executor says so rather than filing an empty board. That refusal costs a
      /// round; requiring the field would cost every rebuild the model's guess at
      /// which pictures the board already holds, which is worse and silent.
      required: ["intention"],
    },
  };
}

export const COMPOSE_MOODBOARD = composeMoodboardFor(EVERYTHING);

/// Agent 8's door: one page of one board, laid out by judgement rather than by
/// a template. The routing rule is in the description rather than here because
/// it is the decision the whole design rests on.
export function designPageFor({ photographs, crops }: ProjectState): ToolDeclaration {
  const pictures = photographs + crops;
  return {
    name: "design_page",
    description: [
      "Hand one page of a board to the designer and get a page back that was arranged by judgement rather than fitted to a template. It reads the board, chooses from the project's pictures, draws and crops what it needs, and puts everything where it decides — any size, any position, no slots.",
      "It is the most expensive tool you have by an order of magnitude — its own model, looking at the page it is making, over several rounds — so call it for the page they actually asked for. It answers with a closing line of its own, which is yours to say to the user in fewer words rather than to quote.",
      "Call it rather than compose_moodboard when the user named a kind of thing that is not a moodboard — a sign, a banner, an album spread, a poster, a cover; or when the ask is about arrangement in words a template cannot answer (“make the headline sit over the top third”, “give it room to breathe”, “the two portraits should face each other”); or when a page that is already laid out needs judgement rather than reassignment.",
      "compose_moodboard stays the answer for “make me a moodboard of these”, and it stays the cheaper, faster and more predictable one. A grid of nine is not a design problem.",
    ].join(" "),
    parameters: {
      type: "OBJECT",
      properties: {
        boardId: {
          type: "STRING",
          description: "The board to design on, by an id from your instructions or list_boards.",
        },
        intention: {
          type: "STRING",
          description:
            "What the page is for, in the user's own words — the thing they asked for and the look they asked for it in. It is the only part of this call the designer cannot read off the board, so pass what they said rather than a summary of it.",
        },
        pageId: {
          type: "STRING",
          description:
            "Which page of that board to design, by an id from an inspect_board pages list. Leave it out on a board of one page. On a board of several, read it with inspect_board first and name the page the user is talking about — the designer reads the board either way, but a page nobody named is a page it has to choose. With newPage it means something else: the page the new one goes beside.",
        },
        newPage: {
          type: "BOOLEAN",
          description:
            "Design onto a fresh page added to that board instead of onto one it already has — for “try another version”, “a poster for the exteriors as well”, anything that asks for more board rather than a different page. Nothing already on the board is moved or written over, so a page that works costs nothing to keep.",
        },
        ...(pictures > 0
          ? {
              imageIds: {
                type: "ARRAY",
                description: `Pictures the user named, by ids from ${idsFrom(crops)}. Pass only the ones they actually pointed at: the designer can see the whole gallery and chooses for itself, and a list you assembled for it is a decision taken away from the one tool here that is paid to make it. Ids this project has not got are reported back rather than refused.`,
                items: { type: "STRING" },
              },
            }
          : {}),
      },
      required: ["boardId", "intention"],
    },
  };
}

export const DESIGN_PAGE = designPageFor(EVERYTHING);
