import "server-only";
import { AgentKind, type ReferenceOrigin } from "@/generated/prisma/enums";
import type { PrismaClient } from "@/generated/prisma/client";
import { analyzerJob } from "@/lib/analysis/analyzer-queue";
import { type ToolReference, unreadReason } from "@/lib/agent/shared/reference";
import type { AnalysisRunStatus } from "@/lib/analysis/analysis-view";
import { forDisplay } from "@/server/references/display";

export type ReferenceRow = {
  id: string;
  title: string;
  width: number | null;
  height: number | null;
  editIntent: string;
  edit: unknown;
  isFavorite: boolean;
  origin: ReferenceOrigin;
  gcsUri: string;
  thumbGcsUri: string | null;
  source: { id: string; title: string } | null;
  analysis: {
    title: string;
    colorPalette: string[];
    lighting: string[];
    texture: string[];
    composition: string[];
    subject: string[];
    contrastDepth: string[];
    rationale: string;
  } | null;
};

export const GALLERY_ORDER = [{ isFavorite: "desc" }, { createdAt: "desc" }] as const;

export const TOOL_REFERENCE_SELECT = {
  id: true,
  title: true,
  width: true,
  height: true,
  editIntent: true,
  edit: true,
  isFavorite: true,
  origin: true,
  generationPrompt: true,
  gcsUri: true,
  thumbGcsUri: true,
  source: { select: { id: true, title: true } },
  analysis: {
    select: {
      title: true,
      colorPalette: true,
      lighting: true,
      texture: true,
      composition: true,
      subject: true,
      contrastDepth: true,
      rationale: true,
    },
  },
} as const;

export function toolReferences(
  rows: readonly ReferenceRow[],
  unread: ReadonlyMap<string, ReturnType<typeof unreadReason>>,
): ToolReference[] {
  return rows.map(({ gcsUri, thumbGcsUri, isFavorite, ...reference }) => ({
    ...reference,
    favorite: isFavorite,
    thumbUrl: forDisplay({ id: reference.id, gcsUri, thumbGcsUri }).thumbUrl,
    ...(unread.get(reference.id) && { unread: unread.get(reference.id) }),
  }));
}

export const ANALYZER_RUN_LIMIT = 500;

export async function unreadReasons(
  db: PrismaClient,
  projectId: string,
  rows: readonly ReferenceRow[],
) {
  const blank = rows.filter((row) => !row.analysis);
  const reasons = new Map<string, ReturnType<typeof unreadReason>>();
  if (!blank.length) return reasons;

  const runs = await db.agentRun.findMany({
    where: { projectId, agent: AgentKind.ANALYZER },
    orderBy: { startedAt: "desc" },
    take: ANALYZER_RUN_LIMIT,
    select: { input: true, status: true },
  });

  const latest = new Map<string, AnalysisRunStatus>();
  for (const { input, status } of runs) {
    const job = analyzerJob(input);
    if (!job || latest.has(job.referenceId)) continue;
    latest.set(job.referenceId, status);
  }

  for (const row of blank) {
    const status = latest.get(row.id);
    const reason = unreadReason(status ? { status } : null);
    if (reason) reasons.set(row.id, reason);
  }
  return reasons;
}
