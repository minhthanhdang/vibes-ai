import { analysisFields, type TagDimension } from "@/lib/analysis/analysis";
import {
  CROP_BOX_SCALE,
  cropBoxColumns,
  cropBoxOf,
} from "@/lib/references/reference-version";
import {
  CATALOG_LIMIT,
  UNREAD_CATALOG_NOTE,
  UNREAD_MARK,
  aspectLabel,
  digestTags,
  drawnFrom,
  referenceDigest,
  type ToolReference,
} from "@/lib/agent/shared/reference";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";

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
