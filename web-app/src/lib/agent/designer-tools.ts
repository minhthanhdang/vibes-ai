import { ANALYSIS_DIMENSIONS, tagLabel, type TagDimension } from "@/lib/analysis/analysis";
import {
  CATALOG_LIMIT,
  UNREAD_CATALOG_NOTE,
  UNREAD_MARK,
  aspectLabel,
  digestTags,
  drawnFrom,
  referenceDigest,
  type ToolDeclaration,
  type ToolReference,
} from "@/lib/agent/agent-tools";
import { cropBoxColumns, cropBoxOf, CROP_BOX_SCALE } from "@/lib/references/reference-version";

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
