import { analysisFields, type TagDimension } from "@/lib/analysis/analysis";
import {
  CROP_BOX_SCALE,
  cropBoxColumns,
  cropBoxOf,
} from "@/lib/references/reference-version";
import {
  UNREAD_CATALOG_NOTE,
  UNREAD_MARK,
  aspectLabel,
  digestTags,
  drawnFrom,
  referenceDigest,
  type ToolReference,
} from "@/lib/agent/shared/reference";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";

export type GalleryDigest = {
  id: string;
  title: string;
  shape: string;
  starred?: true;
  made?: true;
  modificationOf?: string;
  keeps?: string;
  unread?: string;
};

export function galleryDigest(reference: ToolReference): GalleryDigest {
  const { id, title, shape, favorite, croppedFrom, made, keeps, unread } =
    referenceDigest(reference);
  return {
    id,
    title,
    shape,
    ...(favorite && { starred: true as const }),
    ...(made && { made: true as const }),
    ...(croppedFrom && { modificationOf: croppedFrom }),
    ...(keeps && { keeps }),
    ...(unread && { unread: UNREAD_MARK[unread] }),
  };
}

export const DRAWN_FROM_NOTE =
  "a “drawn from” is the description that picture was drawn at — what was asked for rather than what a reader saw, so it is what to vary when another like it is wanted, and the only account of a drawing the property analyzer has not reached yet.";

export type GalleryImage = GalleryDigest & {
  drawnFrom?: string;
} & Partial<Record<TagDimension, string[]>> & {
    palette?: string[];
    rationale?: string;
  };

export function galleryImage(reference: ToolReference): GalleryImage {
  const { analysis } = reference;
  const asked = drawnFrom(reference);
  return {
    ...galleryDigest(reference),
    ...(digestTags(analysis) && analysisFields(analysis)),
    ...(asked && { drawnFrom: asked }),
  };
}

export function galleryList(
  references: readonly ToolReference[],
  {
    includeModifications = true,
  }: { includeModifications?: boolean } = {},
) {
  const listed = includeModifications
    ? references
    : references.filter((reference) => !reference.source);
  const images = listed.map(galleryImage);

  return {
    total: images.length,
    images,
    ...(images.some((image) => image.unread) && { unreadNote: UNREAD_CATALOG_NOTE }),
    ...(images.some((image) => image.drawnFrom) && { drawnFromNote: DRAWN_FROM_NOTE }),
  };
}

export type ModificationLine = { id: string; cutFor: string; shape: string };

export function modificationLine(version: ToolReference): ModificationLine {
  return {
    id: version.id,
    cutFor: (version.editIntent ?? "").trim() || "cut by hand, with no reason written",
    shape: aspectLabel(version.width, version.height),
  };
}

export type ImageAnswer = {
  id: string;
  title: string;
  shape: string;
  modifications?: ModificationLine[];
};

export function imageAnswer(
  reference: ToolReference,
  versions: readonly ToolReference[] = [],
): ImageAnswer {
  const { id, title, shape } = galleryDigest(reference);
  return {
    id,
    title,
    shape,
    ...(versions.length && { modifications: versions.map(modificationLine) }),
  };
}

export type ModificationReference = ToolReference & {
  editRationale?: string | null;
  cropBox?: unknown;
};

export const IMAGE_UNREAD_NOTE =
  "nothing is stored about how this picture looks, so nothing in this answer says what it is of — the picture itself is above and it is the whole of what you know. Do not describe it as plain, flat or colourless. A “not read yet” arrives on its own; a “could not be read” or “never read” will not, and only the user can ask for a reading, from that picture's properties panel.";

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
    pixelSize: version.width && version.height ? `${version.width}×${version.height}` : "unknown",
    cutFor: modificationLine(version).cutFor,
    ...(why && { why }),
    ...(box && { region: cropBoxColumns(box), regionNote: REGION_NOTE }),
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
  description:
    "Every picture in this project — what the user uploaded, what has been drawn for them, and the modification versions cut out of those — with the whole of what the property analyzer read off each one: id, title, shape, what a cut keeps, the colour palette as hex, the analyzer's own reasoning about the look, and the tags under each of light, texture, composition, subject and depth. Nothing is left out and nothing is capped, so this one call is the whole of what is known about the gallery in words, and picking between pictures is done here rather than by looking at them one at a time. It carries no pictures: get_image is how you see one.",
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
    "Look at one picture — this is the only way to see the pixels themselves. The answer beside it is short on purpose: which picture it is, its shape, and the modification versions cut out of it one line each, with get_modification the door to one of those. What the property analyzer read off it — the palette, the reasoning, the tags — is already on this picture's line in list_gallery, so call this when your own eyes are what the question needs and read the line when they are not. One picture per call: the picture is the cost, and a call for four is four looks asked for on a hunch.",
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

export const GALLERY_TOOLS: ToolDeclaration[] = [
  LIST_GALLERY,
  GET_IMAGE,
  GET_MODIFICATION,
  DISCARD_IMAGE,
];
