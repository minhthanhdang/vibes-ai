import {
  CROP_ASPECT_IDS,
  LOOSE_SHAPE_IDS,
} from "@/lib/references/reference-version";
import { CROP_CALL_LIMIT, GENERATE_CALL_LIMIT } from "@/lib/agent/orchestrator/reference-tools";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";

/// Agent 8's image toolset — the two tools that make bytes rather than reading,
/// cutting or arranging what is already there. Both are agent 6's, re-described
/// rather than re-implemented.

/// `generate_image` for agent 8 — the wire name is agent 6's, and this one is
/// ungated.
export const DESIGNER_GENERATE_IMAGE: ToolDeclaration = {
  name: "generate_image",
  description: `Draw a picture that is not in this project and file it in the gallery. This is for the ask no upload answers — a paper texture, a wash or a colour field to stand behind a page, a dusk gradient, a plain backdrop, a shape nobody photographed. Prefer a picture the user already has: a photograph that fits is a photograph somebody chose, and a drawn one is only better when nothing in the gallery is what the page needs. What comes back is an ordinary gallery image with an id, and put_on_canvas places it on the next round of this same turn. The property analyzer reads it minutes behind, and until it does get_image answers with the description it was drawn at, so there is nothing to wait for. One picture per call and at most ${GENERATE_CALL_LIMIT} a turn — it is the most expensive call here. Say in your closing line that the picture was made rather than found.`,
  parameters: {
    type: "OBJECT",
    properties: {
      description: {
        type: "STRING",
        description:
          "What the picture should show, written out: the subject, the light, the colour, the mood and the style, carrying what the user asked for and what the page is for. Nothing else is sent — the model drawing this cannot see the project, the board or the conversation, so a line that only makes sense beside them makes no sense to it.",
      },
      aspect: {
        type: "STRING",
        description: `The shape to draw it at, said the two ways crop_image says one. A *format* is a ratio, width:height — ${CROP_ASPECT_IDS.join(", ")} are the usual ones, and any ratio is asked for as said. A *loose* shape is one of ${LOOSE_SHAPE_IDS.join(", ")}, for a shape described without a number. Pass the shape of the box the picture is being drawn for whenever it is being drawn for one, since a backdrop drawn square and stretched across a landscape page is a backdrop nobody can use. Leave it out only when the shape genuinely does not matter, since the drawing model then picks one.`,
      },
    },
    required: ["description"],
  },
};

/// `crop_image` — `crop_reference` under the designer's nouns, with `toObjectId`
/// in place of agent 6's `boardId` and `pageId`. It reads that object's box and
/// changes nothing on it: agent 8's canvas set is five writes and none of them
/// exchanges the picture an object points at, so a crop that swapped would
/// be a sixth canvas write through the back door.
export const CROP_IMAGE: ToolDeclaration = {
  name: "crop_image",
  description: `Cut the part of one gallery picture that is the shot you want, and file the cut. It is made in this call, not offered: what comes back is a modification version of the picture with its own id, and put_on_canvas takes that id on the next round of this same turn. The picture it came out of is untouched and stays in the gallery, and discard_image is how a cut nobody wanted goes. Nothing on any board changes — a cut is a new gallery picture rather than a replacement — so put it where you want it yourself, and take the old one off with remove_from_canvas if it is standing there. One picture per call and at most ${CROP_CALL_LIMIT} a turn: reading a photograph is the most expensive thing you can ask for, so crop when a cut is wanted and pick the one picture it is about.`,
  parameters: {
    type: "OBJECT",
    properties: {
      imageId: {
        type: "STRING",
        description:
          "The picture to cut, by an id from list_gallery. Give the id of a *modification* when a cut you already have wants changing — wider, tighter, more headroom: that is asked of the picture it came out of with its box attached, so the answer moves that cut instead of taking a smaller piece out of it, and it keeps the shape it was made at unless a new one is named.",
      },
      intention: {
        type: "STRING",
        description:
          "What the cut has to hold — the subject, the part of it, the shot. Not a description of the whole photograph.",
      },
      aspect: {
        type: "STRING",
        description: `The shape to hold the cut to, said one of two ways. A *format* is a ratio, width:height — ${CROP_ASPECT_IDS.join(", ")} are the usual ones, but any ratio is cut exactly as said, "5:4" for a print, "2.35:1" for that scope. A *loose* shape is one of ${LOOSE_SHAPE_IDS.join(", ")}, and it is what to pass for a shape said without a number — "make it square", "a tall one", "not so wide": the cut is framed that way around the subject instead of being held to a ratio nobody asked for. Leave it out to frame around the subject, which is the right answer for a picture that is not being fitted to anything.`,
      },
      toObjectId: {
        type: "STRING",
        description:
          "The box on a board this cut has to fill, by an objectId from read_canvas — the object standing in that place now, which is usually the picture being cut. The cut is held to that box's own shape, which is almost never one of the shapes above, since the boxes are ones you drew: held to it, the picture fills the box with no page showing around it and nothing has to be stretched. It reads the box and nothing else — the board is not changed by this call, so put the cut on with put_on_canvas afterwards. Pass this instead of aspect rather than beside it: a shape named in aspect wins, so naming one is how a cut is made to something other than the box it is for.",
      },
    },
    required: ["imageId", "intention"],
  },
};

/// The set, in the order the designer meets them: the one that makes a picture
/// from nothing, and the one that makes one out of a picture already here.
export const IMAGE_TOOLS: ToolDeclaration[] = [DESIGNER_GENERATE_IMAGE, CROP_IMAGE];
