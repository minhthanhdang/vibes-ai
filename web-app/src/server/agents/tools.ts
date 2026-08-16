import "server-only";
import {
  COMPOSE_MOODBOARD,
  CROP_CALL_LIMIT,
  CROP_REFERENCE,
  LIST_REFERENCES,
  SHOW_REFERENCES,
  attachmentOf,
  boardAttachmentOf,
  cropAttachmentOf,
  pickReferences,
  referenceCatalog,
  referenceDigest,
  type ToolDeclaration,
  type ToolOutcome,
  type ToolReference,
} from "@/lib/agent-tools";
import { cropOffer, cropOfferCaption, unfittableAspect } from "@/lib/crop-offer";
import { cropAspectOf } from "@/lib/reference-version";
import { cropReference } from "@/server/agents/cropper";
import { MODELS } from "@/server/google/vertex";
import { spentColumns, usageThrown } from "@/lib/model-cost";
import { AgentKind, RunStatus } from "@/generated/prisma/enums";
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
  /// Agent 3, injected for the same reason. It is the one tool here that reads a
  /// *photograph*, so it is also the one whose cost a test must never pay.
  crop = cropReference,
}: {
  db: PrismaClient;
  projectId: string;
  compose?: typeof composeMoodboard;
  crop?: typeof cropReference;
}): Toolset {
  let loaded: Promise<{
    photos: ToolReference[];
    all: ToolReference[];
    frames: Map<string, ReferenceRow>;
  }> | null = null;

  function references() {
    loaded ??= db.reference
      .findMany({
        where: { projectId },
        orderBy: [...GALLERY_ORDER],
        select: TOOL_REFERENCE_SELECT,
      })
      .then((rows) => {
        const all = toolReferences(rows);
        return {
          all,
          photos: all.filter((reference) => !reference.source),
          /// The rows as they came out of the database, bucket paths and all.
          /// Kept beside the model's copy rather than in it: an agent that has to
          /// *look* at a picture is handed its uri as a file part, from code, and
          /// the only way to keep that true is for the uri never to be in the
          /// shape the model reads.
          frames: new Map(rows.map((row) => [row.id, row])),
        };
      });
    return loaded;
  }

  /// Vision calls spent this turn. The counter is per toolset, and a toolset is
  /// per request, so this bounds one exchange rather than one round — a model
  /// given three rounds could otherwise ask for the same crop in each of them.
  let cropsAsked = 0;

  /// Agent 3 as an agent-tool, ending at an offer rather than at a row.
  ///
  /// The board agent 4 composes is JSON the server writes; the pixels agent 3
  /// cuts are cut in the browser, on bytes read back same-origin (§II.6). So
  /// this cannot file a version even if it wanted to — what it can do is answer
  /// with the same offer the properties panel's own ask answers with, and let
  /// the click carry it there.
  async function makeCrop(args: Record<string, unknown>): Promise<ToolOutcome> {
    const { all, frames } = await references();
    const referenceId = typeof args.referenceId === "string" ? args.referenceId : "";
    const frame = frames.get(referenceId);
    if (!frame) return { result: { error: `no reference called ${referenceId} in this project` } };

    const intention = typeof args.intention === "string" ? args.intention.trim() : "";
    if (!intention) return { result: { error: "say what to crop out of this reference" } };

    const aspect = cropAspectOf(args.aspect);
    /// Read before the call rather than after it: a frame with no recorded size
    /// cannot be held to a format, and asking the model first would spend a
    /// vision call to arrive at the same sentence.
    const unfittable = unfittableAspect(frame, aspect);
    if (unfittable) return { result: { error: unfittable } };

    if (cropsAsked >= CROP_CALL_LIMIT) {
      return {
        result: {
          error: `you have already offered ${cropsAsked} cuts this turn — ask the director which of them is the one, rather than cropping more frames`,
        },
      };
    }
    cropsAsked += 1;

    /// The same row the panel's ask writes, for the same reason: what the
    /// cropper could not answer is readable afterwards instead of being a
    /// sentence that scrolled out of a chat.
    const run = await db.agentRun.create({
      data: {
        projectId,
        agent: AgentKind.CROPPER,
        status: RunStatus.RUNNING,
        input: { referenceId, prompt: intention, ...(aspect && { aspect }), via: "orchestrator" },
      },
      select: { id: true },
    });

    const fail = async (message: string, spent?: ReturnType<typeof spentColumns>) => {
      await db.agentRun.update({
        where: { id: run.id },
        data: { status: RunStatus.FAILED, error: message, finishedAt: new Date(), ...spent },
      });
      return { result: { error: message } };
    };

    let answer;
    try {
      answer = await crop({
        gcsUri: frame.gcsUri,
        prompt: intention,
        title: frame.title,
        ...(aspect && { aspect }),
      });
    } catch (cause) {
      /// A refusal the cropper reached on its third read is the most expensive
      /// thing in this file, so the failed row carries the tokens too — a ledger
      /// that only counts the successes is a ledger that says a bad afternoon
      /// was cheap.
      const carried = usageThrown(cause);
      return fail(
        cause instanceof Error ? cause.message : String(cause),
        carried ? spentColumns(MODELS.PRO, carried) : undefined,
      );
    }

    const offered = cropOffer({
      reference: frame,
      box: answer.box,
      intent: answer.intent,
      rationale: answer.rationale,
      aspect,
    });
    const spent = spentColumns(answer.model, answer.usage);
    if ("refused" in offered) return fail(offered.refused, spent);

    const { offer } = offered;
    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: RunStatus.SUCCEEDED,
        output: { ...offer, model: answer.model, attempts: answer.attempts },
        finishedAt: new Date(),
        ...spent,
      },
    });

    const shown = all.find((reference) => reference.id === referenceId);
    return {
      result: {
        referenceId,
        keeps: offer.editIntent,
        why: offer.editRationale,
        ...(offer.aspect && { aspect: offer.aspect }),
        size: cropOfferCaption(offer, frame),
        /// Said in the answer, not only in the description: the model is about
        /// to write a sentence about what it just did, and "I cropped it" is a
        /// sentence about a row that does not exist.
        status:
          "offered, not filed — the cut appears beside your reply and the director takes it in the reference's properties panel",
      },
      attachments: shown ? [cropAttachmentOf(shown, offer)] : [],
    };
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
    const requested = asStringArray(args.referenceIds);
    const { found, missing } = pickReferences(all, requested, COMPOSE_BLOCK_LIMIT);
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

    /// References the compositor was never even offered: the block cap bites
    /// before the call, and captions are kept ahead of photographs when it does.
    /// `unplaced` cannot say this — it only knows the blocks that were sent — so
    /// without it a director who named fourteen references is told about the
    /// three the compositor left off and nothing about the two that never
    /// reached it.
    const offered = new Set(blocks.map((block) => block.id));
    const notOffered = [...new Set(requested)].filter(
      (id) => !offered.has(id) && !missing.includes(id),
    );

    const digests = new Map(found.map((reference) => [reference.id, referenceDigest(reference)]));

    /// The compositor gets a run row of its own, on the same terms as the
    /// cropper's. It is the cheapest model call in the pipeline and that is
    /// exactly why it needs one: "cheapest" is a claim about a bill, and the
    /// only way a block cap gets raised on evidence rather than on a feeling is
    /// if what a board actually cost is on a row somewhere.
    const run = await db.agentRun.create({
      data: {
        projectId,
        agent: AgentKind.COMPOSITOR,
        status: RunStatus.RUNNING,
        input: { layout: layout.id, intention, blocks: blocks.map((block) => block.id) },
      },
      select: { id: true },
    });

    let answer;
    try {
      answer = await compose({
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
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await db.agentRun.update({
        where: { id: run.id },
        data: { status: RunStatus.FAILED, error: message, finishedAt: new Date() },
      });
      return { result: { error: message } };
    }

    const spent = spentColumns(answer.model, answer.usage);
    const plan = planAssignments(layout, answer.assignments, blocks);
    if (plan.placed.length === 0) {
      const message = "the compositor placed nothing on the board";
      await db.agentRun.update({
        where: { id: run.id },
        data: { status: RunStatus.FAILED, error: message, finishedAt: new Date(), ...spent },
      });
      return { result: { error: message } };
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

    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: RunStatus.SUCCEEDED,
        output: {
          boardId: board.id,
          layout: layout.id,
          placed: plan.placed.length,
          unplaced: plan.unplaced,
        },
        finishedAt: new Date(),
        ...spent,
      },
    });

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
        ...(notOffered.length && { notOffered }),
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
    declarations: [LIST_REFERENCES, SHOW_REFERENCES, CROP_REFERENCE, COMPOSE_MOODBOARD],

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

        case CROP_REFERENCE.name:
          return makeCrop(args);

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
