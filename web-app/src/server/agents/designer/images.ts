import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolDeclaration } from "@/lib/agent/shared/tool-declaration";
import { canvasObjects } from "@/lib/canvas-objects/object-read";
import { objectShape } from "@/lib/canvas-objects/object-shape";
import type { CropRegion } from "@/lib/canvas/moodboard-crop";
import { cropOfferCaption, cropOfferShape } from "@/lib/crop/crop-offer";
import { CROP_IMAGE, DESIGNER_GENERATE_IMAGE } from "@/lib/agent/designer/image-tools";
import type { UploadContentType } from "@/lib/intake/image-types";
import type { DesignerCall, DesignerOutcome } from "@/server/agents/designer/loop";
import {
  designerReferences,
  type DesignerReferences,
} from "@/server/agents/designer/references";
import { cropReference } from "@/server/agents/cropper/cropper";
import { generateImage } from "@/server/agents/image-generator/image-generator";
import type { Cut } from "@/server/references/cut";
import {
  cutFailed,
  cutTarget,
  makeCut,
  targetFailed,
  type CropTally,
} from "@/server/references/tool-crop";
import {
  drawPicture,
  drawnFailed,
  type GenerationTally,
} from "@/server/references/tool-generation";
import { storeProjectUpload } from "@/server/references/upload";

/// Agent 8's image toolset, executed (compositor-v2.md §IV.4).
///
/// The tools that make bytes. What happens between the ask and the row is the
/// same sequence agent 6 runs — it is in `@/server/references/tool-generation`
/// now, lifted out whole rather than copied, because the completion rule §IV.4
/// states is a property of that sequence: the call does not answer until the
/// bytes are in the bucket and the row is filed, so the id in the answer is one
/// `put_on_canvas` takes on the very next round.
///
/// What differs is only the ending. Agent 6 answers beside a tile the user can
/// see and names `crop_reference`; agent 8 shows nobody anything (§III) and
/// names `crop_image`. So the wording is here and the work is there.

/// The picture is not sent back to look at, and that is a choice rather than an
/// omission.
///
/// Agent 8 can see, and the budget it sees on is eight pictures for the whole
/// design (`DESIGNER_PICTURE_LIMIT`) — so a drawing that put itself in front of
/// the model would spend a look nobody asked for on the one picture in the
/// project whose subject the model already knows, having written it. `get_image`
/// is the door for looking, and it is a round the model can decide to spend.
export const GENERATED_STATUS =
  "drawn and filed in the gallery — an image like any other now, and put_on_canvas takes this id on the next round. The analyzer reads it minutes behind; until it does, its line in list_gallery carries the description above and nothing read off the pixels. Say in your closing line that the picture was made rather than found.";

/// The same, for a drawing whose header would not give up its pixel size. Said
/// rather than left out: a picture with no width is one `put_on_canvas` has to
/// be given a box for from somewhere else.
export const GENERATED_UNSIZED_STATUS =
  "drawn and filed in the gallery, but its pixel size could not be read — so its shape is not known here and a box for it cannot be checked against it. It is an image like any other and put_on_canvas takes this id on the next round. Say in your closing line that the picture was made rather than found.";

/// What a cut answers with, and the whole of the offer: the board is not changed
/// by this call.
///
/// Agent 6's crop can close the loop itself — it is given a `boardId` and swaps
/// the cut into the frame's place. Agent 8 cannot, and that is §IV.1's rule
/// rather than a gap: the five canvas tools are the only writers on a board
/// agent 8 has, none of them exchanges the picture an object points at, and a
/// swapping crop would be a sixth canvas write arriving through the image
/// toolset's back door. So the cut is filed and the two calls that place it are
/// named, in the order they have to happen in.
export const CUT_STATUS =
  "cut and filed in the gallery as a modification of the picture it came out of — that picture is untouched and still there. Nothing on any board changed: put_on_canvas takes this id on the next round, and remove_from_canvas takes the old one off if it is standing where this one goes. discard_image is the way back if it is not the shot you meant.";

/// The turn's two picture ceilings, held as one object because they belong to
/// the turn rather than to the agent spending them (§VII).
///
/// `GENERATE_CALL_LIMIT` and `CROP_CALL_LIMIT` are inherited *and shared with
/// agent 6's* — one budget, whoever spends it. A design is not a turn of its
/// own: it runs inside the turn that called `design_page`, and a tally opened
/// here would let one turn draw two pictures at agent 6's door and two more at
/// agent 8's. That is twice the ceiling either declaration promises the model,
/// on the two most expensive calls in the product, and neither agent would be
/// able to see it happening — each one's count is right about itself.
export type PictureBudget = { generations: GenerationTally; crops: CropTally };

/// A budget of its own, for a design assembled outside a turn — `npm run floor`
/// and the tests. Never what a `design_page` gets: agent 6 hands its own down.
export const ownPictureBudget = (): PictureBudget => ({
  generations: { asked: 0, filed: 0 },
  crops: { asked: 0, filed: 0 },
});

export type ImageToolset = {
  declarations: ToolDeclaration[];
  /// Null for a name this toolset does not own, on `galleryToolset`'s terms: the
  /// unknown-tool error belongs to whoever holds every name.
  execute: (call: DesignerCall) => Promise<DesignerOutcome | null>;
  /// The pictures this design really made, for the report agent 6 answers with.
  ///
  /// A ledger rather than a re-read of the calls, for `skillToolset().read()`'s
  /// reason: the arguments say what was *asked* for, and a design that asked
  /// for three pictures and was refused two by the budget made one. Parsing
  /// them downstream would put the refusals and the failures in front of the
  /// user as pictures on the page.
  made: () => { generated: string[]; cropped: string[] };
};

export function imageToolset({
  db,
  projectId,
  /// The board this design is about (§VI's `design_page` names one and the gate
  /// is `boards > 0`), which is where `crop_image`'s `toObjectId` is resolved.
  /// A handle is an element id and nothing else carries the board it belongs to,
  /// so without this the tool would have to guess which of the project's boards
  /// the model was reading — and it read this one.
  boardId,
  references = designerReferences({ db, projectId }),
  /// The turn's picture ceilings, handed down by whoever opened the turn.
  budget = ownPictureBudget(),
  /// Agent 7, injected on agent 6's terms: it is the one thing here that costs a
  /// model call, and the only reason a test of this file would reach Vertex.
  generate = generateImage,
  /// Agent 3, injected on the same terms and for a sharper reason: it reads a
  /// *photograph*, which is the most expensive call in the product.
  crop = cropReference,
  /// The pixels, cut on the server. Left to `makeCut`'s own default — which
  /// imports `sharp` only when a cut is really made — and named here so a test
  /// of this file can stand in for it without a codec in its module graph.
  cutRegion,
  /// Where a made picture's bytes go — it names a bucket off the environment,
  /// which a test has none of.
  storeImage = (contentType: UploadContentType, bytes: Uint8Array) =>
    storeProjectUpload(projectId, contentType, bytes),
  /// The analyzer's wake-up, imported inside the call rather than at the top for
  /// the reason agent 6 does it: reaching `analysis-queue` binds the real
  /// database and the real vision model at import time.
  kickAnalyzer = () => {
    void import("@/server/agents/analyzer/analysis-queue").then(({ kickAnalyzerWorker }) =>
      kickAnalyzerWorker(),
    );
  },
}: {
  db: PrismaClient;
  projectId: string;
  boardId: string;
  references?: DesignerReferences;
  budget?: PictureBudget;
  generate?: typeof generateImage;
  crop?: typeof cropReference;
  cutRegion?: (gcsUri: string, region: CropRegion) => Promise<Cut>;
  storeImage?: (contentType: UploadContentType, bytes: Uint8Array) => Promise<string>;
  kickAnalyzer?: () => void;
}): ImageToolset {
  /// Filed on the success paths below and nowhere else — a refused draw and a
  /// cut that threw are both an answer to the model and neither is a picture.
  /// Held per toolset, and the toolset is built per `design_page` call, so this
  /// is one design's making.
  const generated: string[] = [];
  const cropped: string[] = [];

  async function makeImage(args: Record<string, unknown>): Promise<DesignerOutcome> {
    const drawing = await drawPicture({
      db,
      projectId,
      description: typeof args.description === "string" ? args.description.trim() : "",
      shapeSaid: typeof args.aspect === "string" ? args.aspect.trim() : "",
      /// The ledger's only account of which agent asked. Two doors file
      /// `IMAGE_GENERATOR` runs against one project, and a design's drawing and
      /// an orchestrator's read identically without it.
      via: "designer",
      tally: budget.generations,
      takenTitles: async () => (await references()).all.map((reference) => reference.title),
      /// Into the design's own memoised read, which is what makes the id in this
      /// answer resolve for `put_on_canvas` on the next round.
      file: references.file,
      generate,
      storeImage,
      kickAnalyzer,
    });
    if (drawnFailed(drawing)) return { result: { error: drawing.error } };
    const { row, title, size, shape, offShape } = drawing;
    generated.push(row.id);

    return {
      result: {
        imageId: row.id,
        title,
        ...(size ?? {}),
        ...(shape && { aspect: shape.label }),
        /// The drawing model composes at its own canvas sizes, so an exact ratio
        /// asked for in a prompt is a request rather than a setting. Said,
        /// because the next thing this model does is write a box for the picture
        /// — and a box drawn to the shape that was asked for around a picture
        /// that is not that shape is a stretch nobody chose.
        ...(offShape && {
          drawnAt: `${size!.width}×${size!.height}, which is not ${shape!.label} — draw the box to this shape rather than to the one you asked for, or cut it exact with crop_image first`,
        }),
        status: size ? GENERATED_STATUS : GENERATED_UNSIZED_STATUS,
      },
    };
  }

  /// The shape a cut for one placed object is held to (§IV.4's `toObjectId`).
  ///
  /// Read fresh rather than off any memoised scene, and that is the point: the
  /// model has been placing things all call, so the box behind a handle it read
  /// three rounds ago may have moved. A cut held to a box that is no longer that
  /// shape fills nothing.
  async function opening(objectId: string) {
    const board = await db.moodboard.findFirst({
      where: { id: boardId, projectId },
      select: { elements: true },
    });
    if (!board) return { error: `no board called ${boardId} in this project` };

    /// The whole board rather than a page of it: a handle names an object and
    /// the tool is not told which page it is on, and `objectShape` needs the
    /// page in the same list anyway to multiply a thousandths box back out.
    const objects = canvasObjects(board.elements) ?? [];
    if (!objects.some((object) => object.objectId === objectId)) {
      return {
        error: `no object called ${objectId} on that board — objectIds come from read_canvas, and an imageId is not a handle: the same picture placed twice is two objects`,
      };
    }

    const shape = objectShape(objects, objectId);
    /// Refused rather than cut unheld, and refused *before* the photograph is
    /// read. A cut made to the frame's own subject under an answer naming the
    /// box it was for is the one wrong ending here — the model would place it
    /// and find it does not fill the opening.
    return (
      shape ?? {
        error: `${objectId} has no shape a cut can be held to — it is either a sliver or a box with no size. Crop without toObjectId and place the cut with put_on_canvas, or fix the box with transform_on_canvas first`,
      }
    );
  }

  async function cutImage(args: Record<string, unknown>): Promise<DesignerOutcome> {
    const { rows } = await references();
    const imageId = typeof args.imageId === "string" ? args.imageId.trim() : "";
    /// Which picture, at what shape, and every refusal that costs a sentence
    /// rather than a photograph — agent 6's own sequence, shared whole.
    const targeting = cutTarget({
      frames: rows,
      referenceId: imageId,
      intention: typeof args.intention === "string" ? args.intention.trim() : "",
      shapeSaid: typeof args.aspect === "string" ? args.aspect.trim() : "",
      noun: "picture",
    });
    if (targetFailed(targeting)) return { result: { error: targeting.error } };
    const { named, frame, nudge, loose, aspect } = targeting;

    const toObjectId = typeof args.toObjectId === "string" ? args.toObjectId.trim() : "";
    const box = toObjectId ? await opening(toObjectId) : null;
    if (box && "error" in box) return { result: { error: box.error } };

    /// A shape said in *this* call wins, which is what the declaration promises:
    /// `toObjectId` is passed instead of `aspect` rather than beside it. Read off
    /// the argument rather than off `aspect`, because `aspect` also carries the
    /// shape a nudge inherits from the cut it is moving — and a nudge that names
    /// a box is asking for that box, not for the shape the old cut happened to
    /// be at.
    const said = typeof args.aspect === "string" && Boolean(args.aspect.trim());
    /// A picture whose pixel size was never recorded is left alone, for the
    /// reason `unfittableAspect` refuses one above: a ratio is a ratio of pixels,
    /// so holding such a picture to the box would turn an ask that works into a
    /// refusal — and it would make it after the photograph had been read.
    const heldToBox = box && !said && frame.width && frame.height ? box : null;
    const held = heldToBox ? heldToBox.shape.label : aspect;
    /// An exact shape and a loose one are never both in play: a box's ratio is
    /// exact, so a refined loose ask stops being loose.
    const framed = heldToBox ? null : loose;

    const making = await makeCut({
      db,
      projectId,
      target: targeting,
      held,
      framed,
      tally: budget.crops,
      /// The ledger's only account of which agent asked — a design's cut and an
      /// orchestrator's read identically without it.
      via: "designer",
      crop,
      ...(cutRegion && { cutRegion }),
      storeImage,
      /// Into the design's own memoised read, which is what makes this id
      /// resolve for `put_on_canvas` on the next round.
      file: references.file,
      kickAnalyzer,
    });
    if (cutFailed(making)) return { result: { error: making.error } };
    const { row, cut } = making;
    cropped.push(row.id);

    return {
      result: {
        /// The cut, not the picture it came out of: this answer is about a row
        /// that did not exist when the call was made, and it is the id the next
        /// round places.
        imageId: row.id,
        cutOf: frame.id,
        ...(nudge && {
          nudgeOf: `${named.id} is untouched — this is that cut moved, filed as a second modification of ${frame.id}. It is still in the gallery, and discard_image is how it goes`,
        }),
        keeps: cut.editIntent,
        why: cut.editRationale,
        ...(cut.aspect && { aspect: cut.aspect }),
        /// Said rather than left to `aspect`, because a loose cut is not held to
        /// a ratio and an answer naming one would be naming a promise nobody
        /// made. The measured shape rides with it so the model can write a box
        /// for what the cut *is*.
        ...(framed && {
          framedAs: `framed ${framed.wants} rather than held to an exact ratio — the cut came out ${cropOfferShape(cut, frame) ?? "a shape this picture's pixel size was never recorded to measure"}`,
        }),
        size: cropOfferCaption(cut, frame),
        status: CUT_STATUS,
        /// Said because it is not the shape that was asked for — it is the shape
        /// of the box, which is almost never one of the six names. Without it the
        /// model writes the next box to the ratio it passed and stretches the
        /// picture it just had cut exact.
        ...(heldToBox && {
          heldTo: `held to ${cut.aspect}, the exact shape of ${heldToBox.objectId}${heldToBox.name ? ` (${heldToBox.name})` : ""} — ${heldToBox.width}×${heldToBox.height} on the board${heldToBox.clipped ? ", measured over the part its page shows rather than the whole of it" : ""}. Give put_on_canvas that object's own box and the cut fills it with no page showing`,
        }),
      },
      /// No picture back, for `generate_image`'s reason: the budget is eight
      /// looks for the whole design, and `get_image` is the door that spends one
      /// on purpose.
    };
  }

  return {
    declarations: [DESIGNER_GENERATE_IMAGE, CROP_IMAGE],

    made: () => ({ generated: [...generated], cropped: [...cropped] }),

    async execute({ name, args }) {
      switch (name) {
        /// Neither is queued behind a board: they write no scene, and the tools
        /// that place what they made run on the round after this one.
        case DESIGNER_GENERATE_IMAGE.name:
          return makeImage(args);

        case CROP_IMAGE.name:
          return cutImage(args);

        default:
          return null;
      }
    },
  };
}
