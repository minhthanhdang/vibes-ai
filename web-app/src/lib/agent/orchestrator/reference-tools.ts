import { COMPOSE_BLOCK_LIMIT } from "@/lib/layout/moodboard-compose";
import {
  CROP_ASPECT_IDS,
  LOOSE_SHAPE_IDS,
} from "@/lib/references/reference-version";
import { EVERYTHING, idsFrom } from "@/lib/agent/orchestrator/state";
import type { ProjectState, ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import type { ToolReference } from "@/lib/agent/shared/reference";

export const SHOWN_LIMIT = 8;


export const LIST_REFERENCES: ToolDeclaration = {
  name: "list_references",
  description:
    "The pictures in this project — the photographs and the cuts made of them — each with its id, title, shape, what a cut keeps and the properties agent 2 read off it. This is the door to every picture and what is known about it. The photographs are also primed into your instructions and read fresh for this message; the cuts are only ever here.",
  parameters: {
    type: "OBJECT",
    properties: {
      includeCrops: {
        type: "BOOLEAN",
        description:
          "The cuts are listed with the photographs. Pass false to leave them out and answer with the uploads alone.",
      },
    },
  },
};

export function showReferencesFor({ crops }: ProjectState): ToolDeclaration {
  return {
    name: "show_references",
    description: `Put pictures in front of the user, in the chat, beside your reply. Use it whenever you talk about specific references — a name in prose is not a picture. At most ${SHOWN_LIMIT} at a time, in the order they should be read.`,
    parameters: {
      type: "OBJECT",
      properties: {
        referenceIds: {
          type: "ARRAY",
          description: `Reference ids from ${idsFrom(crops)}, in reading order.`,
          items: { type: "STRING" },
        },
      },
      required: ["referenceIds"],
    },
  };
}

export const SHOW_REFERENCES = showReferencesFor(EVERYTHING);

export const READ_LIMIT = 8;

export const READ_REFERENCES: ToolDeclaration = {
  name: "read_references",
  description:
    `Read the whole of what the property analyzer wrote about pictures you already have the ids of: its colour palette as hex, its own reasoning about the look, and the tags under each of light, texture, composition, subject and depth. This is the only door to the palette and the reasoning — the lines above and list_references carry the tags flattened into one list and leave both of those out — so call it when the look of a particular picture is what the user is asking about, and not to find out which pictures exist. Nothing is read afresh: a picture carrying an unread mark comes back named rather than described, and having it read is the user's own from its properties panel. The exception is a picture you drew with generate_image — that one comes back with the description it was drawn from whether or not it has been read, which is what to call this for before asking for another like it. At most ${READ_LIMIT} pictures a call.`,
  parameters: {
    type: "OBJECT",
    properties: {
      referenceIds: {
        type: "ARRAY",
        description:
          "The pictures whose properties you want, by the ids they are listed under.",
        items: { type: "STRING" },
      },
    },
    required: ["referenceIds"],
  },
};

export function discardReferenceFor({ crops, boards }: ProjectState): ToolDeclaration {
  return {
    name: "discard_reference",
    description: [
      "Offer to take a picture out of the project altogether. This deletes nothing: what it does is put that picture in front of the user with a Remove button on it, and they decide.",
      `Call it when they ask for a picture to go ("bin that one", "I don't want the blurry frame"${crops > 0 ? ', "delete that old crop"' : ""}).`,
      `The answer says what would go with it${
        crops > 0 ? " — deleting a photograph deletes every cut made of it" : ""
      }${
        boards > 0
          ? `${crops > 0 ? ", and any board showing it or one of its cuts" : " — any board showing it"} is left with a gap`
          : ""
      } — so say that and leave the choice with them; never that the picture is gone, deleted or removed.`,
      "Offer only the picture they named, since this cannot be undone once they take it.",
      boards > 0
        ? "Taking a picture off a board while keeping it in the project is a different act, and design_page is the call for it."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    parameters: {
      type: "OBJECT",
      properties: {
        referenceId: {
          type: "STRING",
          description: `The picture to offer for removal${
            crops > 0 ? " — a photograph or a cut —" : ""
          } by an id from ${idsFrom(crops)}.`,
        },
      },
      required: ["referenceId"],
    },
  };
}

export const DISCARD_REFERENCE = discardReferenceFor(EVERYTHING);

export const EDIT_CALL_LIMIT = COMPOSE_BLOCK_LIMIT;

export function editCeilingSaid(asked: number, filed: number) {
  const attempts = `${asked} ${asked === 1 ? "edit" : "edits"}`;
  if (filed <= 0)
    return `you have asked for ${attempts} this turn and none of them could be made — tell the user what went wrong rather than asking for another`;
  if (filed < asked)
    return `you have asked for ${attempts} this turn and ${filed} of them ${filed === 1 ? "was" : "were"} filed — that is this turn's last edit, so tell the user which pictures they have and stop editing`;
  return `you have already filed ${attempts} this turn, which is all this turn may edit — tell the user what you did and stop editing`;
}

export function editReferenceFor({ crops, boards }: ProjectState): ToolDeclaration {
  return {
    name: "edit_reference",
    description: `Ask the image editor for a changed version of one reference and file it. It cuts out the part of the frame the user described, turns a photograph that was shot on its side, mirrors it, and grades its colour — brighter, more contrast, warmer, less colour — in any combination, in the one call. It does not draw anything, take anything out of a picture, or put two pictures together. The version is made and filed as a new reference of this project, shown to the user beside your reply; the picture it came out of is untouched and stays where it is, and discard_reference is how a version nobody wanted goes. The id it answers with can be given to another tool on the next round of this same turn. One reference per call and at most ${EDIT_CALL_LIMIT} a turn: edit when a change to a picture is asked for, and pick the one picture it is about.`,
    parameters: {
      type: "OBJECT",
      properties: {
        referenceId: {
          type: "STRING",
          description: [
            `The reference to edit, by an id from ${idsFrom(crops)}.`,
            crops > 0
              ? "Give the id of a *cut* when the user wants a cut they already have changed — wider, tighter, more headroom: that is asked of the frame it came out of with its box attached, so the answer moves their cut instead of taking a smaller piece out of it, and it keeps the shape that cut was made at unless a new one is named."
              : "",
          ]
            .filter(Boolean)
            .join(" "),
        },
        intention: {
          type: "STRING",
          description:
            "The whole of what the user wants done to this picture, in their own words — “just the sign, and warmer”, “it's on its side”, “tighter on her hands”, “too blue”. Say the framing and the look and the way up together in the one line, since this is all the editor is given; it reads the picture itself and decides what to do to it. Not a description of the whole photograph, and not your own numbers.",
        },
        aspect: {
          type: "STRING",
          description: `The shape to hold the *cut* to, when the user asked for one — this is about framing and says nothing about the rest of the edit. Said one of two ways. A *format* is a ratio, width:height — ${CROP_ASPECT_IDS.join(", ")} are the usual ones, but any ratio they name is cut exactly as said, "5:4" for a print, "2.35:1" for that scope. A *loose* shape is one of ${LOOSE_SHAPE_IDS.join(", ")}, and it is what to pass when they described a shape without naming a number — "make it square", "a tall one", "not so wide": the cut is framed that way around the subject instead of being cut to a ratio they did not ask for. Pass what they asked for rather than the nearest of the usual formats. Leave it out to frame around the subject, which is the right answer for a reference nobody is composing to a shape.`,
        },
        ...(boards > 0
          ? {
              boardId: {
                type: "STRING",
                description:
                  "The board this cut is for, when it is being made to fill a slot — the picture it would replace, the frame or the cut you are changing, must already be on that board. Pass it whenever the cut is for a board: it holds the cut to that slot's own shape, which is often not one of the shapes above, so the picture fills the opening exactly. The cut takes that picture's place there in this same call, so nothing else is owed for it — the exchange is already made.",
              },
              pageId: {
                type: "STRING",
                description:
                  "One page of that board, by an id from inspect_board — pass it with boardId on a board of more than one page. The same picture can stand on two pages in two differently shaped slots, so without it the cut is held to the shape of whichever page reads first and is swapped in there. Leave it out on a board of one page.",
              },
            }
          : {}),
      },
      required: ["referenceId", "intention"],
    },
  };
}

export const EDIT_REFERENCE = editReferenceFor(EVERYTHING);

export const GENERATE_CALL_LIMIT = 2;

export function generationCeilingSaid(asked: number, filed: number) {
  const attempts = `${asked} ${asked === 1 ? "picture" : "pictures"}`;
  if (filed <= 0)
    return `you have asked for ${attempts} this turn and none of them could be drawn — tell the user what went wrong rather than asking for another`;
  if (filed < asked)
    return `you have asked for ${attempts} this turn and ${filed} of them ${filed === 1 ? "was" : "were"} drawn — show the user what you did draw and ask whether it is right, rather than drawing another`;
  return `you have already made ${attempts} this turn — show the user what you drew and ask whether it is right, rather than drawing another`;
}

export function generateImageFor({
  photographs,
  crops,
  boards,
  generated = 0,
}: ProjectState): ToolDeclaration {
  const pictures = photographs + crops;
  const theirs = pictures - generated;
  return {
    name: "generate_image",
    description: [
      "Make a picture that is not in the project and file it as a reference. This is for the ask no upload answers — a paper texture, a dusk gradient, a wash or a colour field to stand behind a composed page, a plain backdrop — and it is the only tool here that makes a picture rather than reading, cutting or arranging one.",
      pictures > 0
        ? theirs > 0
          ? "Prefer a picture the user actually has: a photograph that fits is a photograph somebody chose, and a generated one is only better when nothing in the project is what they asked for."
          : "Look at what you have already drawn first: every picture in this project came from this tool, and asking for the same thing again comes back a different picture."
        : "",
      "What comes back is an ordinary reference with an id, and the analyzer reads it like any upload.",
      boards > 0
        ? "design_page puts it where the user said, or arranges a whole page around it, on the next round of this same turn."
        : pictures > 0
          ? "add_board makes a board to put it on, on the next round of this same turn."
          : "The tools that list and arrange pictures arrive with it, on the next round of this same turn.",
      `One picture per call and at most ${GENERATE_CALL_LIMIT} a turn.`,
      "Say in your reply that the picture was made rather than found.",
    ]
      .filter(Boolean)
      .join(" "),
    parameters: {
      type: "OBJECT",
      properties: {
        description: {
          type: "STRING",
          description:
            "What the picture should show, written out: the subject, the light, the colour, the mood and the style, carrying what the user asked for and what the brief says the project looks like. Nothing else is sent — the model drawing this cannot see the project, the board or the conversation, so a line that only makes sense beside them makes no sense to it.",
        },
        aspect: {
          type: "STRING",
          description: [
            `The shape to draw it at${pictures > 0 ? ", said the two ways edit_reference says one" : ""}. A *format* is a ratio, width:height — ${CROP_ASPECT_IDS.join(", ")} are the usual ones, and any ratio the user names is asked for as said. A *loose* shape is one of ${LOOSE_SHAPE_IDS.join(", ")}, for when they described a shape without naming a number.`,
            boards > 0
              ? "Pass the shape of the page or the slot the picture is for whenever it is being made for one, since a background drawn square and stretched across a landscape page is a background nobody can use."
              : "Pass the shape the picture has to fill whenever it is being made for one, since the shape is the one thing about a background that cannot be fixed afterwards.",
            "Leave it out only when the shape genuinely does not matter, since the drawing model then picks one.",
          ].join(" "),
        },
      },
      required: ["description"],
    },
  };
}

export const GENERATE_IMAGE = generateImageFor(EVERYTHING);

export function pickReferences(
  references: readonly ToolReference[],
  ids: readonly string[],
  limit = SHOWN_LIMIT,
) {
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  const seen = new Set<string>();
  const found: ToolReference[] = [];
  const missing: string[] = [];

  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const reference = byId.get(id);
    if (reference) found.push(reference);
    else missing.push(id);
  }

  const kept = found.slice(0, Math.max(0, limit));
  return {
    found: kept,
    missing,
    overLimit: found.slice(kept.length).map((reference) => reference.id),
  };
}
