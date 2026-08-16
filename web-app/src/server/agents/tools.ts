import "server-only";
import {
  COMPOSE_MOODBOARD,
  CROP_CALL_LIMIT,
  CROP_REFERENCE,
  INSPECT_BOARD,
  LIST_REFERENCES,
  SHOW_REFERENCES,
  attachmentOf,
  boardAttachmentOf,
  boardsBrief,
  catalogBrief,
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
  boardSelection,
  composedBoardTitle,
  composedScene,
  layoutBlocks,
} from "@/lib/moodboard-compose";
import { layoutForBoard, planAssignments, seatUnplaced } from "@/lib/moodboard-layouts";
import { looseFits } from "@/lib/slot-fit";
import { boardContents, boardItems, sceneBounds } from "@/lib/board-contents";
import { boardPreview, scenePreview } from "@/lib/board-preview";
import { persistableElements, sceneReferenceIds } from "@/lib/moodboard-scene";
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
  /// What is in the project, as text to prime the turn with. Off the same read
  /// the tools use, so priming a turn and then calling a tool in it is still one
  /// question to the database — and the list the model was handed is the list
  /// its ids are resolved against.
  brief: () => Promise<string>;
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

  /// What a board holds, read back off its own scene.
  ///
  /// The one tool here that is a pure read of something the model has already
  /// been told exists. It is here because the alternative was worse than a
  /// missing feature: the boards are primed by id, title and page size, so a
  /// model asked "what is on my board?" could only answer it by calling
  /// `compose_moodboard` — paying a vision-free but real model call *and*
  /// rewriting the arrangement — to find out. A read that costs one query is the
  /// thing that makes that never the right call.
  async function inspectBoard(args: Record<string, unknown>): Promise<ToolOutcome> {
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    /// Scoped to the project for the same reason the rebuild's read is: the id
    /// is a model argument, so it is checked rather than trusted.
    const board = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: {
            id: true,
            title: true,
            widthPx: true,
            heightPx: true,
            elements: true,
            layout: true,
          },
        })
      : null;
    if (!board) return { result: { error: `no board called ${boardId} in this project` } };

    const { all } = await references();
    const byId = new Map(all.map((reference) => [reference.id, reference]));

    const elements = persistableElements(board.elements);
    const items = boardItems(elements);
    const { pictures, lines, unnamedImages } = boardContents(elements);

    /// The tags are left off on purpose: the photographs of the project are
    /// already primed into the instruction with theirs, so repeating them here
    /// is the same paragraph bought twice. What a board adds is *which* of them
    /// and in what order.
    const on = pictures.map((id, index) => {
      const reference = byId.get(id);
      if (!reference) {
        /// On the board and no longer in the gallery — deleted out from under
        /// it. Said rather than skipped, because the position it occupies is
        /// what the director is counting when they say "the third one".
        return { position: index + 1, id, gone: true };
      }
      const digest = referenceDigest(reference);
      return {
        position: index + 1,
        id,
        title: digest.title,
        shape: digest.shape,
        ...(digest.croppedFrom && { croppedFrom: digest.croppedFrom }),
        ...(digest.keeps && { keeps: digest.keeps }),
      };
    });

    const page = { width: board.widthPx, height: board.heightPx };
    const cover = pictures.map((id) => byId.get(id)).find(Boolean);

    return {
      result: {
        boardId: board.id,
        title: board.title,
        page: `${board.widthPx}×${board.heightPx}`,
        /// The template it was last composed at, not a claim about where things
        /// are now — the director may have dragged half of it since, and the
        /// positions below are read off the scene rather than off this.
        ...(board.layout && { composedAs: board.layout }),
        pictures: on,
        ...(lines.length && { lines }),
        ...(unnamedImages && { imagesNotInThisProject: unnamedImages }),
        status:
          "read only — nothing on the board changed. Positions are reading order, so 'the third one' is position 3",
      },
      attachments: [
        boardAttachmentOf({
          id: board.id,
          title: board.title,
          page,
          images: pictures.length,
          thumbUrl: cover?.thumbUrl ?? null,
          preview: scenePreview(
            items,
            sceneBounds(items, page),
            (id) => byId.get(id)?.thumbUrl,
          ),
        }),
      ],
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

    /// The board being rebuilt, read scoped to this project — the id arrives in
    /// a model argument, so it is checked against the project the toolset is
    /// closed over rather than trusted.
    const boardId = typeof args.boardId === "string" ? args.boardId.trim() : "";
    const existing = boardId
      ? await db.moodboard.findFirst({
          where: { id: boardId, projectId },
          select: { id: true, title: true, revision: true, elements: true, layout: true },
        })
      : null;
    if (boardId && !existing) {
      return { result: { error: `no board called ${boardId} in this project` } };
    }

    /// tech-spec §III.4 gives agent 4 "all current blocks" as its input, and a
    /// rebuild is where that reading bites: asked to lay their board out again,
    /// the director means the pictures already on it. Read off the scene rather
    /// than guessed at by the model, so "make that a 3×3" costs no round of
    /// naming ids back.
    const edit = boardSelection({
      onBoard: existing ? sceneReferenceIds(persistableElements(existing.elements)) : [],
      requested: asStringArray(args.referenceIds),
      add: asStringArray(args.addReferenceIds),
      remove: asStringArray(args.removeReferenceIds),
    });
    const selection = edit.selection;
    if (!selection.length) {
      return {
        result: {
          error: edit.removed.length
            ? "that would take every picture off the board — say so rather than leaving them with an empty one"
            : existing
              ? "that board has no pictures on it — name the references to put on it"
              : "name the references to put on the board",
        },
      };
    }

    const { found, missing } = pickReferences(all, selection, COMPOSE_BLOCK_LIMIT);
    if (found.length === 0) {
      return {
        result: {
          error: "none of those reference ids are in this project",
          ...(missing.length && { notFound: missing }),
        },
      };
    }

    const blocks = layoutBlocks(found, asStringArray(args.captions));
    /// A rebuild keeps the board's own template while it has room for the
    /// pictures. Re-picking from the block count is right for a new board and
    /// wrong for one the director has been looking at — see `layoutForBoard`.
    const { layout, reason: layoutReason } = layoutForBoard({
      stored: existing?.layout,
      requested: args.layout,
      blocks,
    });

    /// References the compositor was never even offered: the block cap bites
    /// before the call, and captions are kept ahead of photographs when it does.
    /// `unplaced` cannot say this — it only knows the blocks that were sent — so
    /// without it a director who named fourteen references is told about the
    /// three the compositor left off and nothing about the two that never
    /// reached it.
    const offered = new Set(blocks.map((block) => block.id));
    const notOffered = [...new Set(selection)].filter(
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
        input: {
          layout: layout.id,
          intention,
          blocks: blocks.map((block) => block.id),
          ...(existing && { rebuilds: existing.id }),
        },
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
    /// The model's reading of the set, then the rule it does not get a say in:
    /// a picture the director named does not fall off a board that has a slot
    /// free for it. Seen live — asked to add a second photograph to a two-slot
    /// board, the compositor placed one and dropped the other, which on a
    /// rebuild is a deletion rather than a selection.
    const plan = seatUnplaced(layout, planAssignments(layout, answer.assignments, blocks), blocks);
    if (plan.placed.length === 0) {
      const message = "the compositor placed nothing on the board";
      await db.agentRun.update({
        where: { id: run.id },
        data: { status: RunStatus.FAILED, error: message, finishedAt: new Date(), ...spent },
      });
      return { result: { error: message } };
    }

    const elements = composedScene(plan.placed);
    const named = typeof args.title === "string" && args.title.trim() ? args.title : "";
    /// A rebuild keeps the name the director gave the board. Renaming "Act two
    /// exteriors" to whatever they said while asking for a 3×3 is a second,
    /// unasked-for change to a thing they already own.
    const title = named
      ? composedBoardTitle(named)
      : existing
        ? existing.title
        : composedBoardTitle(intention);

    let board: { id: string; title: string };
    if (existing) {
      /// Guarded on the revision that was read, exactly as the autosave is: a
      /// rebuild is a write to a document a tab may have open, and the tab that
      /// loses gets its own conflict — a reload — rather than its arrangement
      /// silently overwritten.
      ///
      /// `renderRevision` is dropped because the stored picture is now of a board
      /// that no longer exists. Left standing, the tab row would show the old
      /// arrangement as the preview of the new one until somebody opened it.
      const written = await db.moodboard.updateMany({
        where: { id: existing.id, revision: existing.revision },
        data: {
          title,
          layout: layout.id,
          widthPx: layout.page.width,
          heightPx: layout.page.height,
          elements: elements as unknown as Prisma.InputJsonValue,
          revision: { increment: 1 },
          renderRevision: null,
        },
      });
      if (written.count === 0) {
        const message =
          "that board was changed while I was composing it — the director has it open, so tell them and ask again";
        await db.agentRun.update({
          where: { id: run.id },
          data: { status: RunStatus.FAILED, error: message, finishedAt: new Date(), ...spent },
        });
        return { result: { error: message } };
      }
      board = { id: existing.id, title };
    } else {
      board = await db.moodboard.create({
        data: {
          projectId,
          title,
          /// Recorded so the *next* rebuild has something to keep. A board with
          /// no template on it is one the director dragged together, and that is
          /// exactly the board a rebuild has to choose a template for.
          layout: layout.id,
          widthPx: layout.page.width,
          heightPx: layout.page.height,
          elements: elements as unknown as Prisma.InputJsonValue,
        },
        select: { id: true, title: true },
      });
    }

    /// The cover is whatever landed in the first slot the layout reads — the
    /// hero in every template that has one. A board has no picture of its own
    /// until a tab has drawn it, and this is the one that is true before then.
    const opening = layout.slots
      .filter((slot) => slot.kind === "image")
      .map((slot) => plan.placed.find((placement) => placement.slot.id === slot.id))
      .find(Boolean);
    const cover = found.find((reference) => reference.id === opening?.block.id);
    const images = plan.placed.filter((placement) => placement.slot.kind === "image").length;

    /// Where agent 4 hands over to agent 3. A picture is contained in its slot,
    /// never stretched to it, so a portrait in a wide frame is on the board with
    /// page showing either side — and the only thing that closes that gap is a
    /// cut. The board is written either way; this is the sentence that lets the
    /// orchestrator offer the crop instead of the director noticing it.
    const loose = looseFits(plan.placed);

    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: RunStatus.SUCCEEDED,
        output: {
          boardId: board.id,
          layout: layout.id,
          layoutFrom: layoutReason,
          placed: plan.placed.length,
          unplaced: plan.unplaced,
          ...(plan.seated.length && { seated: plan.seated }),
          ...(existing && { rebuilt: true }),
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
        /// Only when the board changed shape. A rebuild that keeps the template
        /// needs no sentence about it; one that could not is a second change the
        /// director did not ask for, and the arrangement they were looking at is
        /// gone either way.
        ...(layoutReason === "outgrew" &&
          existing && {
            layoutChanged: `that board was a ${existing.layout} and could not hold ${blocks.length} blocks, so it was laid out as ${layout.id} — tell the director its shape changed`,
          }),
        /// Which of the two things happened, said in the answer rather than left
        /// to the model's memory of what it asked for: "I made you a board" about
        /// a board the director already had is the one sentence a rebuild can
        /// get wrong, and the tab count is what gives it away.
        status: existing
          ? "rebuilt in place — that board now holds this arrangement instead of what was on it, so say so"
          : "filed as a new board",
        placed: plan.placed.map(({ slot, block }) => ({ slotId: slot.id, blockId: block.id })),
        /// Everything the answer did not amount to, said rather than swallowed:
        /// a board with a hole in it is still a board, and the director is owed
        /// the sentence that admits it.
        ...(plan.unplaced.length && { unplaced: plan.unplaced }),
        /// Placed by the room that was left rather than by the compositor's
        /// reading. Said because it is the one part of the arrangement nobody
        /// composed: these sit where they fitted, so "I put it in beside the
        /// other one" is the honest sentence about them.
        ...(plan.seated.length && { seatedWhereThereWasRoom: plan.seated }),
        ...(plan.unknownBlocks.length && { unknownBlocks: plan.unknownBlocks }),
        ...(plan.unknownSlots.length && { unknownSlots: plan.unknownSlots }),
        ...(plan.mismatched.length && { mismatched: plan.mismatched }),
        ...(notOffered.length && { notOffered }),
        ...(missing.length && { notFound: missing }),
        /// What the edit came to, since the model named a change and not a set:
        /// a picture it asked to remove that was never on the board means it
        /// meant a different one, and only the director can say which.
        ...(edit.added.length && { added: edit.added }),
        ...(edit.removed.length && { removed: edit.removed }),
        ...(edit.notOnBoard.length && { notOnBoard: edit.notOnBoard }),
        ...(edit.alreadyOn.length && { alreadyOnBoard: edit.alreadyOn }),
        /// Only when there is one, so a board that fits costs nothing to say so.
        ...(loose.length && {
          looseInSlot: loose,
          looseInSlotNote:
            "these are on the board with page showing around them — offer the director a crop_reference at the shape beside each one, and once they take the cut put it on this board with addReferenceIds and take the original off with removeReferenceIds. Ask first; a cut nobody wanted is a row they have to delete",
        }),
        ...(answer.note && { note: answer.note }),
      },
      attachments: [
        boardAttachmentOf({
          id: board.id,
          title: board.title,
          layout: layout.id,
          images,
          thumbUrl: cover?.thumbUrl ?? null,
          /// Off `found` rather than the blocks, because a block carries the
          /// pixel size and the id and never the picture — the thumbnail is a
          /// signed URL the tool layer holds and the model never sees.
          preview: boardPreview(plan.placed, layout.page, (id) =>
            found.find((reference) => reference.id === id)?.thumbUrl,
          ),
        }),
      ],
    };
  }

  return {
    declarations: [
      LIST_REFERENCES,
      SHOW_REFERENCES,
      CROP_REFERENCE,
      INSPECT_BOARD,
      COMPOSE_MOODBOARD,
    ],

    async brief() {
      const { all, photos } = await references();
      /// Two reads rather than one, because they answer different questions and
      /// only one of them is asked on every turn's tool calls. The boards are a
      /// handful of small columns — never `elements`, which is megabytes a turn
      /// that never mentions a board would pay for.
      const boards = await db.moodboard.findMany({
        where: { projectId },
        orderBy: { updatedAt: "desc" },
        select: { id: true, title: true, widthPx: true, heightPx: true, layout: true },
      });

      return [
        catalogBrief(photos, { crops: all.length - photos.length }),
        boardsBrief(
          boards.map(({ id, title, widthPx, heightPx, layout }) => ({
            id,
            title,
            width: widthPx,
            height: heightPx,
            layout,
          })),
        ),
      ]
        .filter(Boolean)
        .join("\n\n");
    },

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

        case INSPECT_BOARD.name:
          return inspectBoard(args);

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
