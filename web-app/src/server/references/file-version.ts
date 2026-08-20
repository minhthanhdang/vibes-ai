import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { ReferenceModel } from "@/generated/prisma/models";
import { enqueueAnalysis } from "@/server/agents/analysis-enqueue";
import { croppedReferenceTitle } from "@/lib/canvas/moodboard-crop";
import {
  cropBoxColumns,
  editIntent as asEditIntent,
  editRationale as asEditRationale,
  versionOrigin,
  type CropBox,
} from "@/lib/references/reference-version";

/// What a cut of a frame is filed as, for both doors that file one.
///
/// A version is a reference in every respect the board and the analyzer care
/// about — its own bytes, its own id, its own analysis — and the columns below
/// are the whole difference. There are now two callers: `reference.addVersion`,
/// which the properties panel reaches after the browser cut the pixels, and
/// `crop_reference`, which cuts them on the server and files the row in the turn
/// it was asked in. A title derived one way here and another way there would put
/// two differently-named cuts of one frame in a list whose only purpose is
/// telling them apart.

/// Enough of a client to file both rows: the reference and its analyzer job land
/// in one transaction, so what is passed here is that transaction.
type VersionClient = Pick<PrismaClient, "reference" | "agentRun">;

export type NewVersion = {
  projectId: string;
  /// The frame this is a cut of. Its title is what the cut is named from and its
  /// origin is what the cut inherits, so both doors read the same two columns.
  source: {
    id: string;
    title: string;
    origin?: Prisma.ReferenceCreateInput["origin"] | null;
  };
  gcsUri: string;
  thumbGcsUri?: string | undefined;
  editIntent?: string | undefined;
  /// The cropper's own line on why this box. Absent on a crop the user drew:
  /// nobody reasoned about it in words.
  editRationale?: string | undefined;
  cropBox: CropBox;
  editAspect?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  contentHash?: string | undefined;
};

/// The columns, apart from the write, because the two doors select different
/// things back off the row and only the derivation is shared.
function versionColumns(version: NewVersion): Prisma.ReferenceUncheckedCreateInput {
  return {
    projectId: version.projectId,
    gcsUri: version.gcsUri,
    thumbGcsUri: version.thumbGcsUri,
    title: croppedReferenceTitle(version.source.title),
    width: version.width,
    height: version.height,
    contentHash: version.contentHash,
    sourceReferenceId: version.source.id,
    editIntent: asEditIntent(version.editIntent ?? ""),
    editRationale: asEditRationale(version.editRationale ?? ""),
    cropBox: cropBoxColumns(version.cropBox),
    editAspect: version.editAspect ?? "",
    origin: versionOrigin(version.source),
  };
}

/// The row and its analyzer job, together. A crop is what the user means to put
/// on the board, so its palette and its composition are the ones worth having —
/// reading them off the frame it was cut out of is reading the parts they cut
/// away. And a reference with no job is one the panel offers to analyze by hand,
/// which is not what a filed cut should be.
///
/// The columns read back are the caller's: the panel's door answers the browser
/// with the whole row, and the tool's door wants the few the model is shown.
export function fileVersion(client: VersionClient, version: NewVersion): Promise<ReferenceModel>;
export function fileVersion<Select extends Prisma.ReferenceSelect & { id: true }>(
  client: VersionClient,
  version: NewVersion,
  select: Select,
): Promise<Prisma.ReferenceGetPayload<{ select: Select }>>;
export async function fileVersion(
  client: VersionClient,
  version: NewVersion,
  select?: Prisma.ReferenceSelect,
): Promise<unknown> {
  const created = (await client.reference.create({
    data: versionColumns(version),
    ...(select && { select }),
  })) as { id: string };
  await enqueueAnalysis(client, {
    projectId: version.projectId,
    referenceId: created.id,
  });
  return created;
}
