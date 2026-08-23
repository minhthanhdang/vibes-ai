import { ANALYSIS_DIMENSIONS, tagLabel, type TagDimension } from "@/lib/analysis/analysis";
import {
  CATALOG_LIMIT,
  CROP_CALL_LIMIT,
  GENERATE_CALL_LIMIT,
  MOVE_LIMIT,
  UNREAD_CATALOG_NOTE,
  UNREAD_MARK,
  aspectLabel,
  digestTags,
  drawnFrom,
  referenceDigest,
  type ToolDeclaration,
  type ToolReference,
} from "@/lib/agent/agent-tools";
import { PAGE_PRESET_IDS } from "@/lib/layout/moodboard-layouts";
import {
  CROP_ASPECT_IDS,
  CROP_BOX_SCALE,
  LOOSE_SHAPE_IDS,
  cropBoxColumns,
  cropBoxOf,
} from "@/lib/references/reference-version";

/// Agent 8's gallery toolset (compositor-v2.md §IV.3) — the read side of the
/// project's pictures, in the vocabulary §II.4 hands the designer.
///
/// The rows and the arithmetic are agent 6's: a digest here is
/// `referenceDigest`'s, a shape is `aspectLabel`'s, a region is the same
/// `cropBox` the panel draws its outline from. What is agent 8's is the
/// *wording* and what an answer is allowed to cost. Two vocabularies over one
/// set of rows would be two dialects in one product; two implementations of the
/// digest would be two answers to "what shape is this", so only the first is
/// taken.
///
/// Three renames, and each is a word §II.4 already uses. A *cut* is a
/// `modification`, because agent 8 places one exactly like an original and the
/// word is what tells it there is nothing special to do. `favorite` is
/// `starred`, which is the word on the tile the user clicked. And a reference is
/// an `image`, because agent 8's other surface is a canvas of objects and
/// "reference" there would name the thing an object points at rather than the
/// picture in the gallery.
///
/// This module is the declarations and the shapes of the answers. What reads the
/// database, fetches bytes and counts the pictures against §VII's ceiling sits
/// beside agent 8, on the same split `agent-tools.ts` and `tools.ts` already
/// have: the part worth a test is the part that has no bucket in it.

/// One picture on one line of `list_gallery`, which is `ReferenceDigest` with
/// §II.4's nouns on it.
export type GalleryDigest = {
  id: string;
  title: string;
  shape: string;
  /// True or absent, never false, on `ReferenceDigest`'s own terms: the star is
  /// the rare line and the user's own judgement of the set.
  starred?: true;
  made?: true;
  /// The picture this is a version of. Named `modificationOf` rather than
  /// `croppedFrom` because a version's id is placed like any other and the line
  /// is telling the model where it came from, not that it needs different
  /// handling.
  modificationOf?: string;
  keeps?: string;
  tags?: string[];
  unread?: string;
};

/// The unread reason as the word the model reads rather than as the enum.
///
/// Agent 6's digest carries `unread: "pending"` and leans on
/// `UNREAD_CATALOG_NOTE` to say what the three values mean. Agent 8 is handed
/// the mark itself — "not read yet" — because the same three words already
/// stand on a page's blocks (§V.4) and on `get_image`'s answer, and a value that
/// needs a legend in one of those places and not the others is the legend being
/// paid for twice.
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

/// What the catalog says about itself when it did not fit. The two numbers say
/// it already; this says what to do about it, because the alternative is a model
/// that reads twenty-four lines and tells agent 6 the project holds
/// twenty-four pictures.
export const GALLERY_OVER_CAP_NOTE = `only the first ${CATALOG_LIMIT} are listed, starred first and then newest — there are more pictures in this project than these, so do not describe this list as all of them`;

/// `list_gallery`'s answer. **No pictures**: twenty-four uris on every round is
/// the whole picture budget (§VII) spent on a list the model reads once, and
/// `get_image` is the door to looking at one of them.
export function galleryList(
  references: readonly ToolReference[],
  {
    /// Versions are in unless they are asked out, on `list_references`' own
    /// argument: this is the door to every picture, and a modification left out
    /// of an answer that says it lists the gallery reads as one that does not
    /// exist.
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

/// One modification as `get_image` lists it: enough to choose which one is worth
/// a round of `get_modification`, and no more.
///
/// A frame with nine cuts under it would otherwise be nine paragraphs and nine
/// pictures for a question about one photograph, which is the whole picture
/// budget spent by a tool the model called to look at the original.
export type ModificationLine = { id: string; cutFor: string; shape: string };

export function modificationLine(version: ToolReference): ModificationLine {
  return {
    id: version.id,
    /// The words the cut was asked in. Blank on a crop the user drew by hand,
    /// and said as that rather than left empty — an unlabelled line beside three
    /// labelled ones reads as a cut whose reason was lost rather than as one
    /// nobody wrote a reason for.
    cutFor: (version.editIntent ?? "").trim() || "cut by hand, with no reason written",
    shape: aspectLabel(version.width, version.height),
  };
}

/// `get_image`'s answer for a picture agent 2 has read: every dimension under
/// its own name, and the two fields no digest anywhere carries.
///
/// `digestTags` flattens the five dimensions into one list and drops the palette
/// and the rationale outright, for a reason that is about a *catalog* — six hex
/// codes on twenty-four lines is a quarter of it spent on something a model
/// cannot see. That argument does not hold for the one picture the model has
/// stopped to look at, and this is the only door to those two fields agent 8
/// has.
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
/// dimensions. An empty palette beside an empty rationale reads as a photograph
/// with no colour in it, which is the blank the unread marks exist to stop being
/// read as a fact.
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
  /// the dimensions: it is the same words a second time, and a field called
  /// `tags` meaning one thing on a `list_gallery` line and another here is two
  /// dialects in one prompt. It is also the test for "has this been read" — an
  /// `Analysis` row whose every dimension came back empty is a picture agent 2
  /// found nothing in, and answering that with five empty arrays is the same
  /// blank said five times.
  const { tags: read, ...digest } = galleryDigest(reference);
  const asked = drawnFrom(reference);
  const { analysis } = reference;

  return {
    ...digest,
    ...(read && {
      ...(Object.fromEntries(
        ANALYSIS_DIMENSIONS.map(({ key }) => [key, (analysis?.[key] ?? []).map(tagLabel)]),
      ) as Record<TagDimension, string[]>),
      palette: analysis?.colorPalette ?? [],
      rationale: (analysis?.rationale ?? "").trim(),
    }),
    ...(!read && { unreadNote: IMAGE_UNREAD_NOTE }),
    ...(asked && { drawnFrom: asked, drawnFromNote: DRAWN_FROM_NOTE }),
    ...(versions.length && { modifications: versions.map(modificationLine) }),
  };
}

/// A reference row with the two columns only `get_modification` reads. Agent 6's
/// `ToolReference` stops at `editIntent` because no tool of its own answers with
/// the reasoning or the box; both are on the row the whole time.
export type ModificationReference = ToolReference & {
  editRationale?: string | null;
  cropBox?: unknown;
};

/// Why the region is worth its line.
///
/// It is the difference between "a crop of the stairwell" and "the top-left
/// third of the stairwell", and the second is what says whether cutting again
/// would buy anything. Said in the model's own 0-1000 convention rather than in
/// pixels of the source, which is how the column stores it — a box in pixels
/// would name the same part of the frame only until somebody re-encoded it.
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
    /// Its own pixels rather than the frame's. A cut small enough to be soft at
    /// the size it would be placed at is the one thing about it that decides
    /// whether it can be used big, and no other field here says it.
    pixelSize: version.width && version.height ? `${version.width}×${version.height}` : "unknown",
    cutFor: modificationLine(version).cutFor,
    ...(why && { why }),
    /// Absent on a version whose box was never recorded — a hand-drawn crop from
    /// before the column, or a version that is not a crop at all. Absent rather
    /// than zeroed: four zeroes is a region, and it names the whole frame.
    ...(box && { region: cropBoxColumns(box), regionNote: REGION_NOTE }),
    /// The shape it was *asked* at, which is not recoverable from the region:
    /// the box is a share of each edge of a frame that is not square, so a cut
    /// that measures 1.78 and one asked for at 16:9 are indistinguishable in the
    /// numbers. It matters when the cut is moved.
    ...(askedAt && { askedAt }),
    modificationOf: source.id,
    sourceTitle: source.title,
    ...(version.favorite && { starred: true as const }),
    ...(read && {
      ...(Object.fromEntries(
        ANALYSIS_DIMENSIONS.map(({ key }) => [key, (analysis?.[key] ?? []).map(tagLabel)]),
      ) as Record<TagDimension, string[]>),
      palette: analysis?.colorPalette ?? [],
      rationale: (analysis?.rationale ?? "").trim(),
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

/// The set, in the order §II.4 introduces them: what exists, one picture, one
/// version, and the one that takes something away.
export const GALLERY_TOOLS: ToolDeclaration[] = [
  LIST_GALLERY,
  GET_IMAGE,
  GET_MODIFICATION,
  DISCARD_IMAGE,
];

/// Agent 8's page toolset (compositor-v2.md §IV.2) — the one new tool in it.
///
/// The rest of the set is agent 6's page tools unchanged, and `add_page` is
/// deliberately not in either: `put_on_canvas` with `kind: "page"` already makes
/// one and takes a box, and two doors to one act is two prose descriptions to
/// keep in step.
///
/// What comes back is `PageAIRepresentation` (tech-spec §V.4) — the same text a
/// user-attached page carries, asked for by the model instead of chosen by the
/// user — plus the picture, drawn on the call at the revision the blocks were
/// read at (§III.3). The description says so: a model that does not know the
/// picture is of the page *including its own last two rounds of edits* will call
/// this once and then reason from memory.
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
/// is written again, on `DESIGNER_GENERATE_IMAGE`'s terms.
///
/// It is written again because agent 6's is three quarters advice about what to
/// call next, and every tool it names is one agent 8 does not hold: the copy is
/// changed there with `swap_on_board`, `reword_on_board` or `compose_moodboard`,
/// and the two calls it warns against are `duplicate_board` and a `newPage`
/// compose. Handing that description over unchanged is a model told to reach for
/// five tools it was never given, which costs a round each time it believes it.
/// What agent 8 does with a copy is arrange it by hand, so this one ends at the
/// canvas tools it actually has.
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
/// own — and this one was the last of §IV.2's four inherited page tools still
/// handing agent 6's words over unchanged. Two reasons it is forked now, and the
/// second is the larger.
///
/// The first is the reason the other three were: agent 6's names tools this
/// agent does not hold. It sends the model to `inspect_board` for the page ids,
/// warns it off `compose_moodboard` in a clause about templates, and closes on
/// offering to lay the page out again — which is a compose, and agent 8 has no
/// compositor.
///
/// The second is `compositor-v2.md` §VIII's taste risk. Every page agent 8 had
/// ever made came out at one of two shapes, and iteration 36 found half the
/// reason in the instruction's own page paragraph: it printed the presets in
/// pixels two lines above "the proportion is yours". Taking the numbers out
/// moved the banner ask onto a 1920x600 page of its own writing. The other half
/// was here — this declaration gives the same three sizes in pixels, calls them
/// "the shapes the layout templates are cut for", and is read on every round of
/// every design. Agent 8 has no templates and `put_on_canvas` takes a box of any
/// proportion, so both clauses were false for this reader as well as expensive.
/// The names stay, because naming one is how the call is made and three is a
/// real constraint on it; the pixels and the templates go, and what replaces
/// them says where a rectangle that is not one of the three comes from.
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

/// `move_to_page` for agent 8. The wire name, the arguments and the executor are
/// agent 6's; the description is written again for the same reason
/// `duplicate_page`'s is — agent 6's ends at `compose_moodboard`, `swap_on_board`
/// and `inspect_board`, and this agent holds none of the three.
///
/// The argument for the call is also a different one. Agent 6 is told to prefer
/// this over a rebuild, because a rebuild is what it would otherwise reach for.
/// Agent 8 would reach for `transform_on_canvas`, and there the objection is not
/// price but arithmetic: a box on a page is in thousandths of *that* page, so
/// carrying a picture to another page by hand means reading the target page's
/// rectangle in scene pixels, working the picture's share of the old page into a
/// share of the new one, and writing a `to` outside 0-1000 that lands where the
/// geometry says. It is the one class of number this agent gets wrong, and this
/// call does it exactly.
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

/// `discard_page` for agent 8. One wire name, one executor, a description of its
/// own — and this one is forked for a reason the other three are not: agent 6's
/// says the user presses a button, and there is no button here.
///
/// Agent 8 is never shown to a user (§III), so the offer it makes travels out as
/// the words of its closing line, which agent 6 says again in fewer (§VI). The
/// description therefore tells it that the answer *is* the whole offer, the same
/// sentence `discard_image` carries for the same reason. Agent 6's also sends the
/// model to `discard_board` for a whole board and to `inspect_board` for the page
/// ids, and agent 8 holds neither: it reads pages with `read_canvas` and
/// `get_page`, and a board is not something it can offer to lose at all.
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

/// Agent 8's image toolset (compositor-v2.md §IV.4) — the two tools that make
/// bytes rather than reading, cutting or arranging what is already there.
///
/// Both are agent 6's, and both are re-described rather than re-implemented.
/// `generate_image` keeps its name and its arguments: what changed for agent 8
/// is nothing at all in the executor — `makePicture` already ends where §IV.4
/// asks it to, with the bytes in the bucket and the row filed before the call
/// answers, so the id in the answer is one `put_on_canvas` takes on the very
/// next round. `crop_image` is `crop_reference` renamed into §II.4's vocabulary
/// with one argument changed.
///
/// What the two descriptions here carry that agent 6's do not is where the id
/// goes next. Agent 6 hands an id to `compose_moodboard` and a template puts it
/// somewhere; agent 8 places it itself, in a box it wrote, so both descriptions
/// end at `put_on_canvas` and neither mentions a slot.

/// `generate_image` for agent 8. The wire name is agent 6's — one tool, one
/// executor, two descriptions — so the constant is spelled apart to keep a file
/// that imports both from having to alias one of them.
///
/// Ungated, unlike `generateImageFor`: agent 8 is only ever opened on a project
/// with a board (§VI), so the three counts that decide agent 6's wording are
/// answered before the door is opened and a gate here would measure a condition
/// the call already met.
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

/// `crop_image` — `crop_reference` in §II.4's nouns, with `toObjectId` in place
/// of agent 6's `boardId` and `pageId`.
///
/// The old pair assumed the opening came from a template: agent 6 names a board
/// and the executor looks up which *slot* the picture is sitting in. Agent 8 has
/// no templates. Its openings are boxes it wrote itself with `put_on_canvas`,
/// so the only account of the shape is the object standing in one, and
/// `objectShape` reads it off the same box `read_canvas` answered with.
///
/// It reads that box and changes nothing on it, which is where this parts
/// company with agent 6's `boardId`. There the crop cut *and* swapped in one
/// call, because a swap was a tool agent 6 had; agent 8's canvas set is the five
/// of canvas.md §XI and none of them exchanges the picture an object points at.
/// A crop that quietly did would be a sixth canvas write arriving through the
/// image toolset's back door, which is the wiring Stage 6 says to distrust. So
/// the cut is filed and placed on the next round like any other picture, and the
/// description says so rather than leaving the model to report a board change
/// that never came.
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

/// The set, in the order §IV.4 introduces them: the one that makes a picture
/// from nothing, and the one that makes one out of a picture already here.
export const IMAGE_TOOLS: ToolDeclaration[] = [DESIGNER_GENERATE_IMAGE, CROP_IMAGE];

/// Agent 8's skill door (compositor-v2.md §IV.5).
///
/// The one tool here that reads nothing belonging to this project. A skill is
/// text — no model call, no retrieval, no row — so what is left to decide is
/// only how much of it a round may buy and how the model chooses, and both are
/// settled in the declaration rather than in the executor.
///
/// The catalogue rides in the description and the names ride in the enum, which
/// is why the declaration is built rather than written out: the registry
/// (`@/server/skills`) is the authority on both, and it imports forty-seven files
/// of writing that have no business in a bundle a browser loads. So the shape is
/// here and the list is handed in, and there is exactly one caller passing it.

/// Skills in one call (§IV.5), and skills in a design.
///
/// Two numbers rather than one, because they bound two different things. The
/// per-call cap is what one *answer* may carry: skills are the one thing the
/// transcript never windows out (§III.1), so an answer is text that then rides
/// every subsequent request of the design, and an answer of a dozen pages of
/// writing is a round the model spends reading rather than working.
/// `SKILLS_PER_DESIGN` is the total, spent over as many calls as it takes —
/// which is what makes reading a skill a decision that can be made twice: once
/// in round 1 off the brief, and again in round 4 when the page turns out to be
/// a colour problem after all.
///
/// `SKILL_CHAR_BUDGET` is the third side of this and the one that makes the
/// arithmetic real: the design's whole allowance is at most
/// `SKILLS_PER_DESIGN * SKILL_CHAR_BUDGET` characters of writing carried to the
/// end of the work.
export const SKILLS_PER_CALL = 8;

/// The whole of what one design may read, over any number of calls (§IV.5).
export const SKILLS_PER_DESIGN = 12;

/// The surplus, reported rather than dropped (§VII) — and, unlike every other
/// surplus note in this file, with somewhere to go: the names over the per-call
/// cap can be asked for again while the design has allowance left.
export function skillsOverCallSaid(remaining: number): string {
  return remaining > 0
    ? `only ${SKILLS_PER_CALL} skills are read in one call, so these were not read — ask for the ones still wanted in another call, ${remaining} more skills are allowed in this design`
    : `only ${SKILLS_PER_CALL} skills are read in one call, so these were not read, and this design's ${SKILLS_PER_DESIGN} skills are now spent — work from the ones above rather than naming these to the user`;
}

/// Names asked for a second time, answered with the fact rather than a second
/// copy. Re-sending a skill would spend the design's allowance on text that is
/// already in the transcript.
export const SKILLS_ALREADY_READ_NOTE = `already read earlier in this design and still in front of you, so they were not sent again and did not count against the allowance — read them where they are`;

/// What a `get_skill` past the design's allowance is refused with (§IV.5).
///
/// It names what was read, because the refusal's real content is that those
/// skills are still there: they are the one thing the transcript never windows
/// out (§III.1), so a model asking again is a model that has forgotten it can
/// see them rather than one that needs them re-sent.
export function skillCeilingSaid(read: readonly string[]): string {
  const named = read.join(", ");
  return `this design has read its ${SKILLS_PER_DESIGN} skills — ${named} — and that is the whole allowance. They are still above you and they stay there for the rest of the work, so read them again where they are and get on with the page.`;
}

/// `get_skill`, built off the registry it answers from.
///
/// The enum is the whole of why the answer's `notFound` should never happen: the
/// model is shown every name it may ask for and cannot write one that is not on
/// the list. Reported anyway, because a declaration and an executor are two
/// files and only one of them was built from the registry on the round that
/// matters.
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
