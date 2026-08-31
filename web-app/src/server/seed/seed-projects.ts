import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { env } from "@/env";
import italianRestaurantMenu from "./italian-restaurant-menu.json";
import type { SeedManifest, SeedReference } from "./seed-manifest";

export const SEEDS: SeedManifest[] = [italianRestaurantMenu as SeedManifest];

type SeedClient = Pick<PrismaClient, "project" | "reference" | "analysis">;

function gcsUri(object: string) {
  return `gs://${env().GCS_BUCKET}/${object}`;
}

export function referenceColumns(reference: SeedReference, projectId: string) {
  return {
    projectId,
    gcsUri: gcsUri(reference.object),
    thumbGcsUri: reference.thumbObject ? gcsUri(reference.thumbObject) : null,
    title: reference.title,
    width: reference.width,
    height: reference.height,
    contentHash: reference.contentHash,
    origin: reference.origin,
    generationPrompt: reference.generationPrompt,
  } satisfies Prisma.ReferenceCreateManyInput;
}

export function analysisColumns(seed: SeedManifest, filed: { id: string; gcsUri: string }[]) {
  const byUri = new Map(filed.map((row) => [row.gcsUri, row.id]));
  return seed.references.flatMap((reference) => {
    const referenceId = byUri.get(gcsUri(reference.object));
    if (!reference.analysis || !referenceId) return [];
    return [{ referenceId, ...reference.analysis } satisfies Prisma.AnalysisCreateManyInput];
  });
}

async function seedProject(client: SeedClient, userId: string, seed: SeedManifest) {
  const project = await client.project.create({
    data: { userId, title: seed.title, brief: seed.brief },
    select: { id: true },
  });

  await client.reference.createMany({
    data: seed.references.map((reference) => referenceColumns(reference, project.id)),
  });

  const filed = await client.reference.findMany({
    where: { projectId: project.id },
    select: { id: true, gcsUri: true },
  });
  await client.analysis.createMany({ data: analysisColumns(seed, filed) });

  return project.id;
}

export async function seedProjectsFor(client: SeedClient, userId: string) {
  const held = await client.project.count({ where: { userId } });
  if (held > 0) return [];

  const seeded: string[] = [];
  for (const seed of SEEDS) seeded.push(await seedProject(client, userId, seed));
  return seeded;
}

export async function seedJudgeProjects(client: SeedClient, userId: string) {
  try {
    return await seedProjectsFor(client, userId);
  } catch (cause) {
    console.error(`judge ${userId} signed in but the seed projects were not written:`, cause);
    return [];
  }
}
