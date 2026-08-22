import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolDeclaration } from "@/lib/agent/agent-tools";
import {
  DISCARD_IMAGE,
  GALLERY_TOOLS,
  GET_IMAGE,
  GET_MODIFICATION,
  LIST_GALLERY,
  galleryDigest,
  galleryList,
  imageAnswer,
  modificationAnswer,
  type ModificationReference,
} from "@/lib/agent/designer-tools";
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

/// Agent 8's gallery toolset, executed (compositor-v2.md §IV.3).
///
/// The half of stage 3 with a database in it. The answers themselves are in
/// `@/lib/agent/designer-tools` and are pure — this reads the project's rows,
/// resolves the ids the model wrote against them, and turns the two `get_` calls
/// into the one thing the loop really pays for: an image part.
///
/// A toolset of its own rather than a branch of agent 6's, and the split is not
/// arbitrary. What the two share is the *rows* — one select, one order, one
/// account of why a picture has no tags, all of them now in
/// `@/server/references/tool-references`, and one read of them per call in
/// `references.ts`, which agent 8's other toolsets take too. What they do not
/// share is the vocabulary and what an answer is allowed to carry: agent 6's
/// answers end in thumbnails a person looks at, and these end in file parts a
/// model looks at.

/// What a `get_` call says when it could not put the picture up.
///
/// Every stored picture's bytes are one of the types the intake accepts, so this
/// is the answer to a row that should not exist. Said all the same, and said in
/// the answer rather than logged: a model that asked to look, was handed a
/// paragraph and was not told the picture is missing is a model describing a
/// photograph it never saw, which is the failure the picture budget is spent to
/// avoid.
export const NOT_SHOWN_NOTE =
  "the picture itself could not be put in front of you — its bytes are not a type that can be shown here, so everything above is words about a picture you have not seen. Say so in your closing line rather than describing what it looks like.";

/// What the offer says about itself.
///
/// Agent 6's `discard_reference` ends in a tile with a Remove button on it.
/// Nothing agent 8 does is ever shown to a user (§III), so that button has no
/// door here and the offer travels out as words — agent 8's closing line, said
/// again by agent 6 in fewer (§VI). The sentence therefore tells the model it is
/// holding the whole of the offer rather than half of it.
export const DISCARD_STATUS =
  "offered, not done — nothing has been deleted and that picture is still in the project. Nothing you call puts a button in front of the user: this answer is the whole of the offer, so say in your closing line what would go with it, that it cannot be undone, and that the choice is theirs. Never say the picture is gone, deleted or removed.";

export const DISCARD_GAP_NOTE =
  "removing it leaves a hole in those boards — an object pointing at nothing — so say so, and offer to take that object off with remove_from_canvas and put another picture where it was with put_on_canvas.";

export const DISCARD_PAGES_NOTE =
  "a board listed with pages is one laid out in pages, and the pages named under it are the ones the picture is on — say which page the user would lose it from rather than naming the board alone.";

/// Which of a picture's names the model is answered with: agent 2's title where
/// there is one, which is what the digest already prefers over the filename it
/// was uploaded under.
const titleOf = (reference: Parameters<typeof galleryDigest>[0]) => galleryDigest(reference).title;

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export type GalleryToolset = {
  declarations: ToolDeclaration[];
  /// Null for a name this toolset does not own. Agent 8's executor is assembled
  /// out of several toolsets (§IV), so each has to be able to say "not mine"
  /// without claiming the unknown-tool error for itself — that answer belongs to
  /// whoever holds every name.
  execute: (call: DesignerCall) => Promise<DesignerOutcome | null>;
};

export function galleryToolset({
  db,
  projectId,
  references = designerReferences({ db, projectId }),
}: {
  db: PrismaClient;
  projectId: string;
  /// The project's pictures, read once and shared with agent 8's other toolsets
  /// (`references.ts`). Taken rather than made so that a design call asking for a
  /// page and then for one of the pictures on it pays one query for both.
  references?: DesignerReferences;
}): GalleryToolset {
  /// The boards, read whole — `elements` is megabytes, and the discard is the
  /// only call here that needs them.
  ///
  /// Agent 6 gates the same read on the project having a board at all, because
  /// its own turn commonly runs on a project with none. Agent 8 is reachable
  /// only through `design_page`, whose gate is `boards > 0` (§VI), so a gate here
  /// would be re-asking a question the door has already answered.
  let boardRows: Promise<{ id: string; title: string; elements: unknown }[]> | null = null;

  function boards() {
    boardRows ??= db.moodboard.findMany({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, elements: true },
    });
    return boardRows;
  }

  /// The expensive half of an answer, and the one place a bucket path is read:
  /// the original bytes, as the part the model sees them in.
  function pictureOf(row: DesignerReferenceRow): GeneratePart | null {
    const mimeType = contentTypeOfUri(row.gcsUri);
    return mimeType ? { fileData: { fileUri: row.gcsUri, mimeType } } : null;
  }

  /// An answer and the picture it is about, put together in one place, so that
  /// neither door can forget to say the picture is missing.
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

    /// Its own versions rather than the whole tree under it: a version of a
    /// version is listed under the one it was cut from, which is where a model
    /// reading that line would go looking for it.
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
    /// An original is named back rather than answered about. The two doors carry
    /// different fields — a region and a reason on one, a palette and the
    /// versions on the other — so answering an original here would be
    /// `get_image`'s answer with holes in it, and a round spent finding that out.
    if (!reference.source) {
      return {
        result: {
          error: `${modificationId} is a picture in its own right rather than a modification of one — call get_image for it`,
        },
      };
    }

    /// The frame's title as the gallery lists it, when the frame is still in the
    /// project: the version's own copy of it is the filename the frame was
    /// uploaded under, and a model handed two names for one picture in two
    /// answers has to guess which list the id belongs to.
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

    /// Every version under it and not only its own children: a cut of a cut is a
    /// row too, and the delete cascades to all of them.
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
        /// A version and an original are different news, and the model has to
        /// say which: removing a version leaves the picture it was cut out of
        /// standing, and a user told "the photograph would go" about a crop is
        /// being asked the wrong question.
        ...(named.source && {
          modificationOf: `${named.source.id} — this is a modification, and the ${pictureNoun(named.origin)} it was cut from stays in the project`,
        }),
        /// The cascade said as the pictures it is rather than as a number: the
        /// user may have taken one of these versions an hour ago and will not
        /// connect it to the picture they are removing.
        ...(versions.length && {
          modificationsThatWouldGoWithIt: versions.map((id) => {
            const version = byId.get(id);
            return { id, title: version ? titleOf(version) : "" };
          }),
        }),
        ...(standing.own.length && { onBoards: standing.own }),
        /// Split from the boards showing the picture itself, because it is the
        /// half nobody can check by looking: a picture kept off every board while
        /// a modification of it holds up two reads as "on no board".
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

        /// Not a board edit, whatever the boards it reads suggest: the row it is
        /// about is a picture, and the boards are read only to say what the
        /// removal would cost them.
        case DISCARD_IMAGE.name:
          return offerDiscard(args);

        default:
          return null;
      }
    },
  };
}
