import "server-only";
import { AgentKind, type ReferenceOrigin } from "@/generated/prisma/enums";
import type { PrismaClient } from "@/generated/prisma/client";
import { analyzerJob } from "@/lib/analysis/analyzer-queue";
import { type ToolReference, unreadReason } from "@/lib/agent/shared/reference";
import type { AnalysisRunStatus } from "@/lib/analysis/analysis-view";
import { forDisplay } from "@/server/references/display";

/// The project's pictures as an agent's tools read them: the columns, the order,
/// the shape the model is handed, and why each blank one is blank.
///
/// Extracted from agent 6's tool layer rather than written for agent 8, and
/// nothing in it changed on the way out. Two agents answering about one gallery
/// have to answer about the same rows in the same order — a model told "the
/// second one" by a user is counting the tiles, and a second select would be a
/// second answer to what a picture *is*. What differs between the two is the
/// vocabulary and what an answer may cost, and both of those live beside the
/// agent that has them.

export type ReferenceRow = {
  id: string;
  title: string;
  width: number | null;
  height: number | null;
  editIntent: string;
  editAspect: string;
  isFavorite: boolean;
  /// Where the bytes came from, read because a cut inherits it: a piece of a
  /// picture the assistant drew was not shot by the user either.
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

/// Gallery order, matching what the user is looking at while they talk: a
/// model answering "the second one" and a user counting tiles have to be
/// counting the same list.
export const GALLERY_ORDER = [{ isFavorite: "desc" }, { createdAt: "desc" }] as const;

/// The columns a tool reads off a reference. Analysis rides along because the
/// tags are the vocabulary the pipeline talks in — without them the catalog is a
/// list of filenames and the model has nothing to reason with.
export const TOOL_REFERENCE_SELECT = {
  id: true,
  title: true,
  width: true,
  height: true,
  editIntent: true,
  editAspect: true,
  /// Four integers, read only when the model asks for a *cut* to be changed:
  /// that ask is a nudge of this box rather than a crop of the cut, and the box
  /// is the one thing the nudge cannot be made without.
  cropBox: true,
  /// The star. One boolean, and it is the only column here the *user* wrote —
  /// everything else was read off the pixels or typed by the uploader. It also
  /// decides `GALLERY_ORDER`, so without it the model is handed a list whose
  /// ordering encodes a fact it cannot see.
  isFavorite: true,
  /// Which of these pictures the assistant drew itself, which is the one thing
  /// about a reference that is true of it before the analyzer has read it and
  /// that no tag will ever say.
  origin: true,
  /// What a drawn picture was asked for, in the words it was asked in. Read by
  /// `read_references` alone — it is a sentence rather than a mark, so it is
  /// worth its tokens on the one picture the user is asking about and not on
  /// every catalog line. It is also the only thing anywhere that says what a
  /// picture drawn a minute ago is *of*: the conversation the model is handed
  /// carries no tool calls, so its own description is gone by the next turn.
  generationPrompt: true,
  gcsUri: true,
  thumbGcsUri: true,
  source: { select: { id: true, title: true } },
  analysis: {
    select: {
      /// Agent 2's name for the picture, which `referenceDigest` prefers over
      /// the row's own title — that one is the uploaded filename.
      title: true,
      colorPalette: true,
      lighting: true,
      texture: true,
      composition: true,
      subject: true,
      contrastDepth: true,
      /// Read for `read_references` alone. No digest carries it — a paragraph per
      /// picture on twenty-four primed lines is the catalog several times over —
      /// and that tool is the one door in the layer that answers about a single
      /// picture, where the paragraph is the answer.
      rationale: true,
    },
  },
} as const;

/// The bucket paths are dropped here rather than at the edge. A model that has
/// been handed a `gs://` uri in JSON will put it in a sentence, and a sentence
/// with a bucket path in it is what the signed-URL indirection exists to
/// prevent. An agent that has to *look* at a picture gets the uri as a file
/// part, from code, never from the conversation.
export function toolReferences(
  rows: readonly ReferenceRow[],
  unread: ReadonlyMap<string, ReturnType<typeof unreadReason>>,
): ToolReference[] {
  return rows.map(({ gcsUri, thumbGcsUri, isFavorite, ...reference }) => ({
    ...reference,
    /// Renamed at the edge, like the uri is stripped at it: the column is
    /// `isFavorite` and what the model reads is `starred`, and the one word it is
    /// carried under downstream is `favorite`.
    favorite: isFavorite,
    thumbUrl: forDisplay({ id: reference.id, gcsUri, thumbGcsUri }).thumbUrl,
    ...(unread.get(reference.id) && { unread: unread.get(reference.id) }),
  }));
}

/// How many analyzer runs one read looks back over. A run per re-analysis
/// accumulates, and only the newest per reference is read; past this a picture
/// with no `Analysis` row reads as one nobody ever offered to agent 2, which is
/// the same wrong answer the blank line used to give and no worse.
export const ANALYZER_RUN_LIMIT = 500;

/// Why each unread picture is unread, for the pictures that have no analysis.
///
/// A second query, and it is the only one in this file that a turn can be spared
/// entirely: a project agent 2 has finished with has nothing to explain, so the
/// read is gated on there being a blank line to explain in the first place. The
/// commonest turn — a user talking about pictures uploaded yesterday — pays
/// nothing for it.
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

  /// Newest first, so the first row naming a reference is that reference's
  /// latest run — `AgentRun` has no reference column and the id only comes out
  /// of the `input` Json the queue wrote.
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
