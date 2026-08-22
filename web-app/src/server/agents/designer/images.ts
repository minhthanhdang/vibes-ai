import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolDeclaration } from "@/lib/agent/agent-tools";
import { DESIGNER_GENERATE_IMAGE } from "@/lib/agent/designer-tools";
import type { UploadContentType } from "@/lib/intake/image-types";
import type { DesignerCall, DesignerOutcome } from "@/server/agents/designer/loop";
import {
  designerReferences,
  type DesignerReferences,
} from "@/server/agents/designer/references";
import { generateImage } from "@/server/agents/image-generator";
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
  "drawn and filed in the gallery — an image like any other now, and put_on_canvas takes this id on the next round. The analyzer reads it minutes behind; until it does, get_image answers with the description above. Say in your closing line that the picture was made rather than found.";

/// The same, for a drawing whose header would not give up its pixel size. Said
/// rather than left out: a picture with no width is one `put_on_canvas` has to
/// be given a box for from somewhere else.
export const GENERATED_UNSIZED_STATUS =
  "drawn and filed in the gallery, but its pixel size could not be read — so its shape is not known here and a box for it cannot be checked against it. It is an image like any other and put_on_canvas takes this id on the next round. Say in your closing line that the picture was made rather than found.";

export type ImageToolset = {
  declarations: ToolDeclaration[];
  /// Null for a name this toolset does not own, on `galleryToolset`'s terms: the
  /// unknown-tool error belongs to whoever holds every name.
  execute: (call: DesignerCall) => Promise<DesignerOutcome | null>;
};

export function imageToolset({
  db,
  projectId,
  references = designerReferences({ db, projectId }),
  /// Agent 7, injected on agent 6's terms: it is the one thing here that costs a
  /// model call, and the only reason a test of this file would reach Vertex.
  generate = generateImage,
  /// Where a made picture's bytes go — it names a bucket off the environment,
  /// which a test has none of.
  storeImage = (contentType: UploadContentType, bytes: Uint8Array) =>
    storeProjectUpload(projectId, contentType, bytes),
  /// The analyzer's wake-up, imported inside the call rather than at the top for
  /// the reason agent 6 does it: reaching `analysis-queue` binds the real
  /// database and the real vision model at import time.
  kickAnalyzer = () => {
    void import("@/server/agents/analysis-queue").then(({ kickAnalyzerWorker }) =>
      kickAnalyzerWorker(),
    );
  },
}: {
  db: PrismaClient;
  projectId: string;
  references?: DesignerReferences;
  generate?: typeof generateImage;
  storeImage?: (contentType: UploadContentType, bytes: Uint8Array) => Promise<string>;
  kickAnalyzer?: () => void;
}): ImageToolset {
  /// The ceiling is per turn and a design call is a turn (§VII), so the count
  /// lives as long as this toolset does — a model given twelve rounds could
  /// otherwise ask for the same backdrop in each of them.
  const pictures: GenerationTally = { asked: 0, filed: 0 };

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
      tally: pictures,
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

  return {
    declarations: [DESIGNER_GENERATE_IMAGE],

    async execute({ name, args }) {
      switch (name) {
        /// Not queued behind a board: it writes no scene, and the tool that
        /// places what it made runs on the round after this one.
        case DESIGNER_GENERATE_IMAGE.name:
          return makeImage(args);

        default:
          return null;
      }
    },
  };
}
