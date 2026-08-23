import { analysisFields, type TagDimension } from "@/lib/analysis/analysis";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { aspectLabel, CATALOG_LIMIT, digestTags, drawnFrom, referenceDigest, type ToolReference, UNREAD_CATALOG_NOTE, UNREAD_MARK } from "@/lib/agent/shared/reference";
import { CROP_CALL_LIMIT, GENERATE_CALL_LIMIT } from "@/lib/agent/orchestrator/reference-tools";
import { MOVE_LIMIT } from "@/lib/agent/orchestrator/board-tools";
import { PAGE_PRESET_IDS } from "@/lib/layout/moodboard-layouts";
import {
  CROP_ASPECT_IDS,
  CROP_BOX_SCALE,
  LOOSE_SHAPE_IDS,
  cropBoxColumns,
  cropBoxOf,
} from "@/lib/references/reference-version";

/// Agent 8's gallery toolset — the read side of the project's pictures, in the
/// vocabulary the designer is handed. Agent 6's rows and arithmetic under
/// agent 8's wording, with three renames: a cut is a `modification`, a favorite
/// is `starred`, a reference is an `image`.
///
/// The declarations and the shapes of the answers only. What reads the
/// database, fetches bytes and counts the pictures against the ceiling sits
/// beside agent 8.

/// One picture on one line of `list_gallery`, which is `ReferenceDigest` with
/// the designer's nouns on it.
export type GalleryDigest = {
  id: string;
  title: string;
  shape: string;
  /// True or absent, never false, on `ReferenceDigest`'s own terms.
  starred?: true;
  made?: true;
  /// The picture this is a version of, named for where it came from rather than
  /// for needing different handling.
  modificationOf?: string;
  keeps?: string;
  tags?: string[];
  unread?: string;
};

/// The unread reason as the word the model reads rather than as the enum.
export function galleryDigest(reference: ToolReference): GalleryDigest {
  const { id, title, shape, favorite, croppedFrom, made, keeps, tags, unread } =
    referenceDigest(reference);
  return {
    id,
    title,
    shape,
    ...(favorite && { starred: true as const }),
    ...(made && { made: true as const }),
    ...(croppedFrom && { modificationOf: croppedFrom }),
    ...(keeps && { keeps }),
    ...(tags && { tags }),
    ...(unread && { unread: UNREAD_MARK[unread] }),
  };
}

/// What the catalog says about itself when it did not fit — what to do about it
/// rather than the two numbers, which say it already.
export const GALLERY_OVER_CAP_NOTE = `only the first ${CATALOG_LIMIT} are listed, starred first and then newest — there are more pictures in this project than these, so do not describe this list as all of them`;

/// `list_gallery`'s answer. **No pictures**.
export function galleryList(
  references: readonly ToolReference[],
  {
    /// Versions are in unless they are asked out, on `list_references`' own
    /// argument.
    includeModifications = true,
    limit = CATALOG_LIMIT,
  }: { includeModifications?: boolean; limit?: number } = {},
) {
  const listed = includeModifications
    ? references
    : references.filter((reference) => !reference.source);
  const images = listed.slice(0, Math.max(0, limit)).map(galleryDigest);

  return {
    total: listed.length,
    shown: images.length,
    images,
    ...(images.length < listed.length && { notAllShown: GALLERY_OVER_CAP_NOTE }),
    ...(images.some((image) => image.unread) && { unreadNote: UNREAD_CATALOG_NOTE }),
  };
}

/// One modification as `get_image` lists it: enough to choose which one is
/// worth a round of `get_modification`, and no more.
export type ModificationLine = { id: string; cutFor: string; shape: string };

export function modificationLine(version: ToolReference): ModificationLine {
  return {
    id: version.id,
    /// The words the cut was asked in, said as blank rather than left empty on
    /// a crop the user drew by hand.
    cutFor: (version.editIntent ?? "").trim() || "cut by hand, with no reason written",
    shape: aspectLabel(version.width, version.height),
  };
}

/// `get_image`'s answer for a picture agent 2 has read: every dimension under
/// its own name, and the two fields no digest anywhere carries — the only door
/// agent 8 has to the palette and the rationale.
export type ImageAnswer = Omit<GalleryDigest, "tags"> & {
  drawnFrom?: string;
  drawnFromNote?: string;
  modifications?: ModificationLine[];
  unreadNote?: string;
} & Partial<Record<TagDimension, string[]>> & {
    palette?: string[];
    rationale?: string;
  };

/// What a picture with no analysis is answered with, in place of six empty
/// dimensions.
export const IMAGE_UNREAD_NOTE =
  "nothing is stored about how this picture looks, so nothing in this answer says what it is of — the picture itself is above and it is the whole of what you know. Do not describe it as plain, flat or colourless. A “not read yet” arrives on its own; a “could not be read” or “never read” will not, and only the user can ask for a reading, from that picture's properties panel.";

/// The one thing a picture drawn this turn can say about itself before anyone
/// has read it.
export const DRAWN_FROM_NOTE =
  "a “drawn from” is the description this picture was drawn at — what was asked for rather than what a reader saw, so it is what to vary when another like it is wanted, and the only account of a drawing the property analyzer has not reached yet.";

export function imageAnswer(
  reference: ToolReference,
  versions: readonly ToolReference[] = [],
): ImageAnswer {
  /// The flattened list comes off the digest rather than being carried beside
  /// the dimensions, and is also the test for "has this been read".
  const { tags: read, ...digest } = galleryDigest(reference);
  const asked = drawnFrom(reference);
  const { analysis } = reference;

  return {
    ...digest,
    ...(read && {
      ...analysisFields(analysis),
    }),
    ...(!read && { unreadNote: IMAGE_UNREAD_NOTE }),
    ...(asked && { drawnFrom: asked, drawnFromNote: DRAWN_FROM_NOTE }),
    ...(versions.length && { modifications: versions.map(modificationLine) }),
  };
}

/// A reference row with the two columns only `get_modification` reads.
export type ModificationReference = ToolReference & {
  editRationale?: string | null;
  cropBox?: unknown;
};

/// Why the region is worth its line, in the model's own 0-1000 convention
/// rather than in the pixels the column stores.
export const REGION_NOTE = `[ymin, xmin, ymax, xmax], 0-${CROP_BOX_SCALE} of the picture it was cut out of, top-left origin — so [0, 0, ${CROP_BOX_SCALE / 2}, ${CROP_BOX_SCALE / 2}] is its top-left quarter.`;

export type ModificationAnswer = {
  id: string;
  title: string;
  shape: string;
  pixelSize: string;
  cutFor: string;
  why?: string;
  region?: number[];
  regionNote?: string;
  askedAt?: string;
  modificationOf: string;
  sourceTitle: string;
  starred?: true;
  unreadNote?: string;
} & Partial<Record<TagDimension, string[]>> & {
    palette?: string[];
    rationale?: string;
  };

export function modificationAnswer(
  version: ModificationReference,
  source: { id: string; title: string },
): ModificationAnswer {
  const box = cropBoxOf(version.cropBox);
  const read = digestTags(version.analysis);
  const { analysis } = version;
  const why = (version.editRationale ?? "").trim();
  const askedAt = (version.editAspect ?? "").trim();

  return {
    id: version.id,
    title: (analysis?.title ?? "").trim() || version.title.trim() || "Untitled",
    shape: aspectLabel(version.width, version.height),
    /// Its own pixels rather than the frame's.
    pixelSize: version.width && version.height ? `${version.width}×${version.height}` : "unknown",
    cutFor: modificationLine(version).cutFor,
    ...(why && { why }),
    /// Absent rather than zeroed on a version whose box was never recorded:
    /// four zeroes is a region, and it names the whole frame.
    ...(box && { region: cropBoxColumns(box), regionNote: REGION_NOTE }),
    /// The shape it was *asked* at, which is not recoverable from the region.
    ...(askedAt && { askedAt }),
    modificationOf: source.id,
    sourceTitle: source.title,
    ...(version.favorite && { starred: true as const }),
    ...(read && {
      ...analysisFields(analysis),
    }),
    ...(!read && { unreadNote: IMAGE_UNREAD_NOTE }),
  };
}

export const LIST_GALLERY: ToolDeclaration = {
  name: "list_gallery",
  description: `Every picture in this project — what the user uploaded, what has been drawn for them, and the modification versions cut out of those — one line each: id, title, shape, what a cut keeps, the tags the property analyzer read off it, and whether it has been read yet. This is the door to what exists; it carries no pictures, so call get_image on the ones that matter to see one. At most ${CATALOG_LIMIT} lines, starred first and then newest, with the count of the rest said.`,
  parameters: {
    type: "OBJECT",
    properties: {
      includeModifications: {
        type: "BOOLEAN",
        description:
          "The modification versions are listed with the pictures they were cut from. Pass false to leave them out and list the uploads and the drawings alone.",
      },
    },
  },
};

export const GET_IMAGE: ToolDeclaration = {
  name: "get_image",
  description:
    "Look at one picture and read the whole of what the property analyzer wrote about it: its colour palette as hex, its own reasoning about the look, and the tags under each of light, texture, composition, subject and depth. This is the only door to the palette and the reasoning — list_gallery carries the tags flattened and leaves both out — and the only way to see the picture itself. It also lists the modification versions cut out of it, one line each; get_modification is how you look at one of those. A picture nobody has read comes back with its shape, its versions and its picture, marked unread rather than described. One picture per call: the picture is the cost, and a call for four is four looks asked for on a hunch.",
  parameters: {
    type: "OBJECT",
    properties: {
      imageId: {
        type: "STRING",
        description: "The picture to look at, by an id from list_gallery.",
      },
    },
    required: ["imageId"],
  },
};

export const GET_MODIFICATION: ToolDeclaration = {
  name: "get_modification",
  description:
    "Look at one modification version and read its row: what it was cut for in the words it was asked in, why the cut is where it is, the region of the original it came from, the picture it was cut out of, its own shape and pixel size, and whatever the property analyzer read off it. The region is the point of the call — it is the difference between “a crop of the stairwell” and “the top-left third of the stairwell”, and the second is what says whether cutting again would buy anything. One version per call.",
  parameters: {
    type: "OBJECT",
    properties: {
      modificationId: {
        type: "STRING",
        description:
          "The version to look at, by an id from list_gallery or from the modifications get_image listed.",
      },
    },
    required: ["modificationId"],
  },
};

export const DISCARD_IMAGE: ToolDeclaration = {
  name: "discard_image",
  description:
    "Offer to take a picture out of the project altogether. This deletes nothing: the answer says what would go with it — deleting a picture deletes every modification version cut out of it, and any board showing the picture or one of those versions is left with a gap — and the user decides. Say all of that in your closing line and never that the picture is gone, deleted or removed. Taking a picture off a board while keeping it in the project is a different act and a free one: that is remove_from_canvas. Offer only the picture the user named, since this cannot be undone once they take it.",
  parameters: {
    type: "OBJECT",
    properties: {
      imageId: {
        type: "STRING",
        description: "The picture to offer for removal, by an id from list_gallery.",
      },
    },
    required: ["imageId"],
  },
};

/// The set, in the order the designer meets them: what exists, one picture, one
/// version, and the one that takes something away.
export const GALLERY_TOOLS: ToolDeclaration[] = [
  LIST_GALLERY,
  GET_IMAGE,
  GET_MODIFICATION,
  DISCARD_IMAGE,
];

/// Agent 8's page toolset — the one new tool in it. What comes back is
/// `PageAIRepresentation` plus the picture, drawn on the call at the revision
/// the blocks were read at.
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

/// `duplicate_page` for agent 8. The wire name and the executor are agent 6's —
/// one implementation in `@/server/pages/tool-pages` — and only the description
/// is written again.
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

/// `resize_page` for agent 8. One wire name, one executor, a description of its
/// own — forked both because agent 6's names tools this agent does not hold and
/// because its pixels were half of the taste risk.
///
/// Agent 6's declaration is untouched, which is the whole reason this is a fork
/// rather than an edit: the numbers are true of a page a template composed and
/// agent 4 still fills those templates.
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

/// `move_to_page` for agent 8. The wire name, the arguments and the executor
/// are agent 6's; the description is written again, and the argument for the
/// call is a different one — arithmetic rather than price.
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

/// `discard_page` for agent 8. Forked for a reason the other three are not:
/// agent 6's says the user presses a button, and there is no button here.
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

/// Agent 8's skill door — the one tool that reads nothing belonging to this
/// project.

/// Skills in one call. Two numbers rather than one because they bound two
/// different things.
export const SKILLS_PER_CALL = 8;

/// The whole of what one design may read, over any number of calls.
export const SKILLS_PER_DESIGN = 12;

/// The surplus, reported rather than dropped — and, unlike every other surplus
/// note in this file, with somewhere to go.
export function skillsOverCallSaid(remaining: number): string {
  return remaining > 0
    ? `only ${SKILLS_PER_CALL} skills are read in one call, so these were not read — ask for the ones still wanted in another call, ${remaining} more skills are allowed in this design`
    : `only ${SKILLS_PER_CALL} skills are read in one call, so these were not read, and this design's ${SKILLS_PER_DESIGN} skills are now spent — work from the ones above rather than naming these to the user`;
}

/// Names asked for a second time, answered with the fact rather than a second
/// copy.
export const SKILLS_ALREADY_READ_NOTE = `already read earlier in this design and still in front of you, so they were not sent again and did not count against the allowance — read them where they are`;

/// What a `get_skill` past the design's allowance is refused with. It names
/// what was read, because that is the refusal's real content.
export function skillCeilingSaid(read: readonly string[]): string {
  const named = read.join(", ");
  return `this design has read its ${SKILLS_PER_DESIGN} skills — ${named} — and that is the whole allowance. They are still above you and they stay there for the rest of the work, so read them again where they are and get on with the page.`;
}

/// `get_skill`, built off the registry it answers from.
export function getSkillFor({
  names,
  catalogue,
}: {
  names: readonly string[];
  catalogue: string;
}): ToolDeclaration {
  return {
    name: "get_skill",
    description: `Read written expertise before you lay anything out: how a trade actually works, what it makes, what conventions it keeps and where it usually goes wrong. Choose by the job — an occupation for the kind of thing being made, a foundation for the part of the craft the page turns on — and call this in your first round, because it is what the work is then judged against. At most ${SKILLS_PER_CALL} in one call and ${SKILLS_PER_DESIGN} in a design, over as many calls as wanted — so read what the page rests on now and come back for more when the work turns out to need them. What comes back stays in front of you for the rest of the design and is never dropped, so there is nothing to re-read and no reason to ask twice. A skill is general writing about design and knows nothing about this project: it will not name a picture, a board or a page you have, it asks nothing of you, and reading one changes nothing. The catalogue:\n${catalogue}`,
    parameters: {
      type: "OBJECT",
      properties: {
        skills: {
          type: "ARRAY",
          description: `Which to read, by name from the catalogue above, best first — anything past ${SKILLS_PER_CALL} is not read in this call and is named back, and a skill already read is not sent twice.`,
          items: { type: "STRING", enum: [...names] },
        },
      },
      required: ["skills"],
    },
  };
}
