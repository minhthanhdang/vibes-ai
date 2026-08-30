import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { DISCARD_IMAGE, GALLERY_TOOLS, galleryDigest, galleryList, GET_IMAGE, GET_MODIFICATION, imageAnswer, LIST_GALLERY, modificationAnswer, type ModificationReference } from "@/lib/agent/designer/gallery-tools";
import { contentTypeOfUri } from "@/lib/intake/image-types";
import { pictureNoun } from "@/lib/references/reference-discard";
import {
  boardReferenceUsage,
  referenceUsageIndex,
  removalUsage,
} from "@/lib/references/reference-usage";
import { versionDescendants } from "@/lib/references/reference-version";
import type { DesignerCall, DesignerOutcome } from "@/server/agents/designer/loop";
import {
  designerReferences,
  type DesignerReferenceRow,
  type DesignerReferences,
} from "@/server/agents/designer/references";
import type { GeneratePart } from "@/server/google/vertex";

export const NOT_SHOWN_NOTE =
  "the picture itself could not be put in front of you — its bytes are not a type that can be shown here, so everything above is words about a picture you have not seen. Say so in your closing line rather than describing what it looks like.";

export const DISCARD_STATUS =
  "offered, not done — nothing has been deleted and that picture is still in the project. Nothing you call puts a button in front of the user: this answer is the whole of the offer, so say in your closing line what would go with it, that it cannot be undone, and that the choice is theirs. Never say the picture is gone, deleted or removed.";

export const DISCARD_GAP_NOTE =
  "removing it leaves a hole in those boards — an object pointing at nothing — so say so, and offer to take that object off with remove_from_canvas and put another picture where it was with put_on_canvas.";

export const DISCARD_PAGES_NOTE =
  "a board listed with pages is one laid out in pages, and the pages named under it are the ones the picture is on — say which page the user would lose it from rather than naming the board alone.";

const titleOf = (reference: Parameters<typeof galleryDigest>[0]) => galleryDigest(reference).title;

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export type GalleryToolset = {
  declarations: ToolDeclaration[];
  execute: (call: DesignerCall) => Promise<DesignerOutcome | null>;
};

export function galleryToolset({
  db,
  projectId,
  references = designerReferences({ db, projectId }),
}: {
  db: PrismaClient;
  projectId: string;
  references?: DesignerReferences;
}): GalleryToolset {
  let boardRows: Promise<{ id: string; title: string; elements: unknown }[]> | null = null;

  function boards() {
    boardRows ??= db.moodboard.findMany({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, elements: true },
    });
    return boardRows;
  }

  function pictureOf(row: DesignerReferenceRow): GeneratePart | null {
    const mimeType = contentTypeOfUri(row.gcsUri);
    return mimeType ? { fileData: { fileUri: row.gcsUri, mimeType } } : null;
  }

  function withPicture(result: Record<string, unknown>, row: DesignerReferenceRow): DesignerOutcome {
    const picture = pictureOf(row);
    return picture
      ? { result, pictures: [picture] }
      : { result: { ...result, pictureNote: NOT_SHOWN_NOTE } };
  }

  async function listGallery(args: Record<string, unknown>): Promise<DesignerOutcome> {
    const { all } = await references();
    const includeModifications = args.includeModifications !== false;
    return { result: galleryList(all, { includeModifications }) };
  }

  async function getImage(args: Record<string, unknown>): Promise<DesignerOutcome> {
    const imageId = asString(args.imageId);
    const { all, rows } = await references();
    const reference = all.find((entry) => entry.id === imageId);
    const row = rows.get(imageId);
    if (!reference || !row) {
      return { result: { error: `no picture called ${imageId} in this project` } };
    }

    const versions = all.filter((entry) => entry.source?.id === reference.id);
    return withPicture(imageAnswer(reference, versions), row);
  }

  async function getModification(args: Record<string, unknown>): Promise<DesignerOutcome> {
    const modificationId = asString(args.modificationId);
    const { all, rows } = await references();
    const reference = all.find((entry) => entry.id === modificationId);
    const row = rows.get(modificationId);
    if (!reference || !row) {
      return { result: { error: `no picture called ${modificationId} in this project` } };
    }
    if (!reference.source) {
      return {
        result: {
          error: `${modificationId} is a picture in its own right rather than a modification of one — call get_image for it`,
        },
      };
    }

    const frame = all.find((entry) => entry.id === reference.source!.id);
    const version: ModificationReference = {
      ...reference,
      editRationale: row.editRationale,
      cropBox: row.cropBox,
    };

    return withPicture(
      modificationAnswer(version, {
        id: reference.source.id,
        title: frame ? titleOf(frame) : reference.source.title,
      }),
      row,
    );
  }

  async function offerDiscard(args: Record<string, unknown>): Promise<DesignerOutcome> {
    const imageId = asString(args.imageId);
    const { all } = await references();
    const named = all.find((entry) => entry.id === imageId);
    if (!named) return { result: { error: `no picture called ${imageId} in this project` } };

    const versions = versionDescendants(
      all
        .filter((entry) => entry.source)
        .map((entry) => ({ id: entry.id, sourceReferenceId: entry.source!.id })),
      named.id,
    );
    const standing = removalUsage(
      referenceUsageIndex(boardReferenceUsage(await boards())),
      named.id,
      versions,
    );
    const byId = new Map(all.map((entry) => [entry.id, entry]));
    const gapBoards = [...standing.own, ...standing.viaVersions];

    return {
      result: {
        imageId: named.id,
        title: titleOf(named),
        ...(named.source && {
          modificationOf: `${named.source.id} — this is a modification, and the ${pictureNoun(named.origin)} it was cut from stays in the project`,
        }),
        ...(versions.length && {
          modificationsThatWouldGoWithIt: versions.map((id) => {
            const version = byId.get(id);
            return { id, title: version ? titleOf(version) : "" };
          }),
        }),
        ...(standing.own.length && { onBoards: standing.own }),
        ...(standing.viaVersions.length && { boardsShowingItsModifications: standing.viaVersions }),
        ...(gapBoards.length && { gap: DISCARD_GAP_NOTE }),
        ...(gapBoards.some((board) => board.pages) && { pages: DISCARD_PAGES_NOTE }),
        status: DISCARD_STATUS,
      },
    };
  }

  return {
    declarations: GALLERY_TOOLS,

    async execute({ name, args }) {
      switch (name) {
        case LIST_GALLERY.name:
          return listGallery(args);

        case GET_IMAGE.name:
          return getImage(args);

        case GET_MODIFICATION.name:
          return getModification(args);

        case DISCARD_IMAGE.name:
          return offerDiscard(args);

        default:
          return null;
      }
    },
  };
}
