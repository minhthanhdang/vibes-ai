import "server-only";
import {
  COMPOSE_MOODBOARD,
  LIST_REFERENCES,
  SHOW_REFERENCES,
  attachmentOf,
  boardAttachmentOf,
  pickReferences,
  referenceCatalog,
  referenceDigest,
  type ToolDeclaration,
  type ToolOutcome,
  type ToolReference,
} from "@/lib/agent-tools";
import {
  COMPOSE_BLOCK_LIMIT,
  composedBoardTitle,
  composedScene,
  layoutBlocks,
} from "@/lib/moodboard-compose";
import { planAssignments, resolveLayout } from "@/lib/moodboard-layouts";
import { blockBrief, composeMoodboard } from "@/server/agents/compositor";
import { forDisplay } from "@/server/references/display";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

/// The seam agents 2-5 hang off: a toolset is a set of declarations to hand the
/// model and the one function that runs whatever it calls.
///
/// Assembled per request, closed over the project it is allowed to touch. That
/// is the whole access control story — a tool cannot be talked into reading
/// another director's project, because the id it reads is not an argument the
/// model can write.
export type Toolset = {
  declarations: ToolDeclaration[];
  execute: (call: { name: string; args: Record<string, unknown> }) => Promise<ToolOutcome>;
};

/// The columns a tool reads off a reference. Analysis rides along because the
/// tags are the vocabulary the pipeline talks in — without them the catalog is a
/// list of filenames and the model has nothing to reason with.
const TOOL_REFERENCE_SELECT = {
  id: true,
  title: true,
  width: true,
  height: true,
  editIntent: true,
  editAspect: true,
  gcsUri: true,
  thumbGcsUri: true,
  source: { select: { id: true, title: true } },
  analysis: {
    select: {
      colorPalette: true,
      lighting: true,
      texture: true,
      composition: true,
      subject: true,
      contrastDepth: true,
    },
  },
} as const;

/// The bucket paths are dropped here rather than at the edge. A model that has
/// been handed a `gs://` uri in JSON will put it in a sentence, and a sentence
/// with a bucket path in it is what the signed-URL indirection exists to
/// prevent. An agent that has to *look* at a picture gets the uri as a file
/// part, from code, never from the conversation.
function toolReferences(rows: readonly ReferenceRow[]): ToolReference[] {
  return rows.map(({ gcsUri, thumbGcsUri, ...reference }) => ({
    ...reference,
    thumbUrl: forDisplay({ id: reference.id, gcsUri, thumbGcsUri }).thumbUrl,
  }));
}

type ReferenceRow = {
  id: string;
  title: string;
  width: number | null;
  height: number | null;
  editIntent: string;
  editAspect: string;
  gcsUri: string;
  thumbGcsUri: string | null;
  source: { id: string; title: string } | null;
  analysis: {
    colorPalette: string[];
    lighting: string[];
    texture: string[];
    composition: string[];
    subject: string[];
    contrastDepth: string[];
  } | null;
};

/// Gallery order, matching what the director is looking at while they talk: a
/// model answering "the second one" and a director counting tiles have to be
/// counting the same list.
const GALLERY_ORDER = [{ isFavorite: "desc" }, { createdAt: "desc" }] as const;

/// The pictures of one project, as the tools see them.
///
/// Read once per turn rather than per tool call: `list_references` and
/// `show_references` are two questions about the same set, and the second one
/// resolving ids against a list the first never saw is how a model ends up being
/// told a reference it was just given does not exist.
export function referenceToolset({
  db,
  projectId,
  /// Agent 4, injected. It is the one thing in this file that costs a model
  /// call, and the only reason a test of the tool layer would have to reach
  /// Vertex — so the seam is here rather than in the import.
  compose = composeMoodboard,
}: {
  db: PrismaClient;
  projectId: string;
  compose?: typeof composeMoodboard;
}): Toolset {
  let loaded: Promise<{ photos: ToolReference[]; all: ToolReference[] }> | null = null;

  function references() {
    loaded ??= db.reference
      .findMany({
        where: { projectId },
        orderBy: [...GALLERY_ORDER],
        select: TOOL_REFERENCE_SELECT,
      })
      .then((rows) => {
        const all = toolReferences(rows);
        return { all, photos: all.filter((reference) => !reference.source) };
      });
    return loaded;
  }

  /// Agent 4 end to end: the references the orchestrator named become blocks, a
  /// template is settled before the call, the compositor says which block goes
  /// where, and deterministic code turns that into a board row.
  ///
  /// The board is filed rather than offered for approval. A moodboard is an
  /// excalidraw scene the director then rearranges — the composed one is a first
  /// draft that exists to be pushed around, and a draft they have to accept
  /// before they can see it is a draft they judge from a description.
  async function makeMoodboard(args: Record<string, unknown>): Promise<ToolOutcome> {
    const { all } = await references();
    const intention = typeof args.intention === "string" ? args.intention : "";
    const { found, missing } = pickReferences(all, asStringArray(args.referenceIds), COMPOSE_BLOCK_LIMIT);
    if (found.length === 0) {
      return {
        result: {
          error: "none of those reference ids are in this project",
          ...(missing.length && { notFound: missing }),
        },
      };
    }

    const blocks = layoutBlocks(found, asStringArray(args.captions));
    const layout = resolveLayout({ blockCount: blocks.length, requested: args.layout });

    const digests = new Map(found.map((reference) => [reference.id, referenceDigest(reference)]));
    const answer = await compose({
      layout,
      intention,
      blocks: blocks.map((block) => {
        const digest = digests.get(block.id);
        return blockBrief({
          ...block,
          ...(digest && { shape: digest.shape, keeps: digest.keeps, tags: digest.tags }),
        });
      }),
    });

    const plan = planAssignments(layout, answer.assignments, blocks);
    if (plan.placed.length === 0) {
      return { result: { error: "the compositor placed nothing on the board" } };
    }

    const elements = composedScene(plan.placed);
    const title =
      typeof args.title === "string" && args.title.trim()
        ? composedBoardTitle(args.title)
        : composedBoardTitle(intention);

    const board = await db.moodboard.create({
      data: {
        projectId,
        title,
        widthPx: layout.page.width,
        heightPx: layout.page.height,
        elements: elements as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, title: true },
    });

    /// The cover is whatever landed in the first slot the layout reads — the
    /// hero in every template that has one. A board has no picture of its own
    /// until a tab has drawn it, and this is the one that is true before then.
    const opening = layout.slots
      .filter((slot) => slot.kind === "image")
      .map((slot) => plan.placed.find((placement) => placement.slot.id === slot.id))
      .find(Boolean);
    const cover = found.find((reference) => reference.id === opening?.block.id);
    const images = plan.placed.filter((placement) => placement.slot.kind === "image").length;

    return {
      result: {
        boardId: board.id,
        title: board.title,
        layout: layout.id,
        placed: plan.placed.map(({ slot, block }) => ({ slotId: slot.id, blockId: block.id })),
        /// Everything the answer did not amount to, said rather than swallowed:
        /// a board with a hole in it is still a board, and the director is owed
        /// the sentence that admits it.
        ...(plan.unplaced.length && { unplaced: plan.unplaced }),
        ...(plan.unknownBlocks.length && { unknownBlocks: plan.unknownBlocks }),
        ...(plan.unknownSlots.length && { unknownSlots: plan.unknownSlots }),
        ...(plan.mismatched.length && { mismatched: plan.mismatched }),
        ...(missing.length && { notFound: missing }),
        ...(answer.note && { note: answer.note }),
      },
      attachments: [
        boardAttachmentOf({
          id: board.id,
          title: board.title,
          layout: layout.id,
          images,
          thumbUrl: cover?.thumbUrl ?? null,
        }),
      ],
    };
  }

  return {
    declarations: [LIST_REFERENCES, SHOW_REFERENCES, COMPOSE_MOODBOARD],

    async execute({ name, args }) {
      const { all, photos } = await references();

      switch (name) {
        case LIST_REFERENCES.name:
          return { result: referenceCatalog(args.includeCrops === true ? all : photos) };

        /// Resolved against every reference, crops included: a cut the model was
        /// given by an earlier call is a picture the director may well want to
        /// look at, whether or not this turn asked for crops in the catalog.
        case SHOW_REFERENCES.name: {
          const { found, missing } = pickReferences(all, asStringArray(args.referenceIds));
          return {
            result: {
              shown: found.map((reference) => reference.id),
              /// Named separately from `shown` so the model can say so. A silent
              /// difference between what it asked for and what appeared is a
              /// reply that describes pictures the director cannot see.
              ...(missing.length && { notFound: missing }),
            },
            attachments: found.map(attachmentOf),
          };
        }

        case COMPOSE_MOODBOARD.name:
          return makeMoodboard(args);

        default:
          return { result: { error: `no tool called ${name}` } };
      }
    },
  };
}

/// Arguments arrive as whatever the model emitted. A list of ids that came back
/// as a bare string, or with a number in it, is a malformed call rather than a
/// crash — the model is told what it found and gets to try again.
function asStringArray(value: unknown) {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}
