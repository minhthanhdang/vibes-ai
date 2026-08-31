import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { ReferenceModel } from "@/generated/prisma/models";
import { enqueueAnalysis } from "@/server/agents/analyzer/analysis-enqueue";
import { editedReferenceTitle } from "@/lib/edit/edit-said";
import type { EditOp } from "@/lib/edit/edit-ops";
import {
  editIntent as asEditIntent,
  editRationale as asEditRationale,
  versionOrigin,
} from "@/lib/references/reference-version";

type VersionClient = Pick<PrismaClient, "reference" | "agentRun">;

export type NewVersion = {
  projectId: string;
  source: {
    id: string;
    title: string;
    origin?: Prisma.ReferenceCreateInput["origin"] | null;
  };
  gcsUri: string;
  thumbGcsUri?: string | undefined;
  editIntent?: string | undefined;
  editRationale?: string | undefined;
  edit: readonly EditOp[];
  width?: number | undefined;
  height?: number | undefined;
  contentHash?: string | undefined;
};

function versionColumns(version: NewVersion): Prisma.ReferenceUncheckedCreateInput {
  return {
    projectId: version.projectId,
    gcsUri: version.gcsUri,
    thumbGcsUri: version.thumbGcsUri,
    title: editedReferenceTitle(version.source.title, version.edit),
    width: version.width,
    height: version.height,
    contentHash: version.contentHash,
    sourceReferenceId: version.source.id,
    editIntent: asEditIntent(version.editIntent ?? ""),
    editRationale: asEditRationale(version.editRationale ?? ""),
    edit: version.edit as Prisma.InputJsonValue,
    origin: versionOrigin(version.source),
  };
}

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
