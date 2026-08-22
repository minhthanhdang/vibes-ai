import { ANALYSIS_DIMENSIONS, tagLabel, type TagDimension } from "@/lib/analysis/analysis";
import {
  CATALOG_LIMIT,
  CROP_CALL_LIMIT,
  GENERATE_CALL_LIMIT,
  UNREAD_CATALOG_NOTE,
  UNREAD_MARK,
  aspectLabel,
  digestTags,
  drawnFrom,
  referenceDigest,
  type ToolDeclaration,
  type ToolReference,
} from "@/lib/agent/agent-tools";
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
/// (`@/server/skills`) is the authority on both, and it imports thirteen files
/// of writing that have no business in a bundle a browser loads. So the shape is
/// here and the list is handed in, and there is exactly one caller passing it.

/// Skills in one call (§IV.5). More than three at once is a model hedging — and
/// with one call a design, three is also the whole of what a design may read.
export const SKILLS_PER_CALL = 3;

/// The surplus, reported rather than dropped (§VII), and with the one thing the
/// canvas tools' own surplus note cannot say: there is no calling again.
export const SKILLS_OVER_CALL_NOTE = `only ${SKILLS_PER_CALL} skills are read in one call and there is one call a design, so these were not read and there is no second call to read them in — work from the ones above rather than naming these to the user`;

/// What a second `get_skill` is refused with (§IV.5).
///
/// It names what was read, because the refusal's real content is that those
/// skills are still there: they are the one thing the transcript never windows
/// out (§III.1), so a model asking again is a model that has forgotten it can
/// see them rather than one that needs them re-sent.
export function skillCeilingSaid(read: readonly string[]): string {
  const named = read.join(", ");
  return `you have already read this design's skills — ${named} — and there is one get_skill call a design. They are still above you and they stay there for the rest of the work, so read them again where they are and get on with the page.`;
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
    description: `Read written expertise before you lay anything out: how a trade actually works, what it makes, what conventions it keeps and where it usually goes wrong. Choose by the job — an occupation for the kind of thing being made, a foundation for the part of the craft the page turns on — and call this in your first round, because it is what the work is then judged against. At most ${SKILLS_PER_CALL} in one call and one call a design, so name the ones the page really rests on. What comes back stays in front of you for the rest of the design and is never dropped, so there is nothing to re-read and no reason to ask twice. A skill is general writing about design and knows nothing about this project: it will not name a picture, a board or a page you have, it asks nothing of you, and reading one changes nothing. The catalogue:\n${catalogue}`,
    parameters: {
      type: "OBJECT",
      properties: {
        skills: {
          type: "ARRAY",
          description: `Which to read, by name from the catalogue above, best first — a fourth is not read and there is no second call.`,
          items: { type: "STRING", enum: [...names] },
        },
      },
      required: ["skills"],
    },
  };
}
