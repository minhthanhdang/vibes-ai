import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type {
  Analysis,
  ChatMessage,
  Conversation,
  Crop,
  Moodboard,
  MoodboardTile,
  PrismaClient,
  Project,
  Reference,
} from "@/generated/prisma/client";

export type CopyClient = Pick<
  PrismaClient,
  | "project"
  | "reference"
  | "analysis"
  | "crop"
  | "moodboard"
  | "moodboardTile"
  | "conversation"
  | "chatMessage"
>;

export type CopiedProject = {
  project: Project;
  references: Reference[];
  analyses: Analysis[];
  crops: Crop[];
  moodboards: Moodboard[];
  tiles: MoodboardTile[];
  conversations: Conversation[];
  messages: ChatMessage[];
};

export type ReadOptions = { withChats?: boolean };

export class ProjectOwnershipError extends Error {
  override readonly name = "ProjectOwnershipError";
}

export async function readProject(
  client: CopyClient,
  projectId: string,
  ownerEmail: string,
  { withChats = false }: ReadOptions = {},
): Promise<CopiedProject> {
  const owner = await client.project.findUnique({
    where: { id: projectId },
    select: { user: { select: { email: true } } },
  });
  if (!owner) throw new ProjectOwnershipError(`no project ${projectId}`);
  if (owner.user.email !== ownerEmail) {
    throw new ProjectOwnershipError(
      `project ${projectId} is not owned by ${ownerEmail} — a cuid is opaque, so check the id before reading a stranger's work`,
    );
  }

  const project = await client.project.findUniqueOrThrow({ where: { id: projectId } });

  const references = await client.reference.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });
  const referenceIds = references.map((row) => row.id);

  const analyses = await client.analysis.findMany({ where: { referenceId: { in: referenceIds } } });
  const crops = await client.crop.findMany({ where: { referenceId: { in: referenceIds } } });

  const moodboards = await client.moodboard.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });
  const tiles = await client.moodboardTile.findMany({
    where: { moodboardId: { in: moodboards.map((row) => row.id) } },
  });

  const conversations = withChats
    ? await client.conversation.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } })
    : [];
  const messages = conversations.length
    ? await client.chatMessage.findMany({
        where: { conversationId: { in: conversations.map((row) => row.id) } },
        orderBy: { seq: "asc" },
      })
    : [];

  return { project, references, analyses, crops, moodboards, tiles, conversations, messages };
}

const GS_URI = /^gs:\/\/([^/]+)\/(.+)$/;

export function rewriteUri(uri: string, from: string, to: string): string {
  const match = GS_URI.exec(uri);
  return match && match[1] === from ? `gs://${to}/${match[2]}` : uri;
}

export function rewriteDeep<T>(value: T, from: string, to: string): T {
  if (typeof value === "string") return rewriteUri(value, from, to) as T;
  if (Array.isArray(value)) return value.map((item) => rewriteDeep(item, from, to)) as T;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return Object.fromEntries(entries.map(([key, held]) => [key, rewriteDeep(held, from, to)])) as T;
  }
  return value;
}

export function rewritten(copied: CopiedProject, from: string, to: string): CopiedProject {
  const swap = (uri: string) => rewriteUri(uri, from, to);
  const deep = <T>(held: T) => rewriteDeep(held, from, to);

  return {
    project: { ...copied.project, libraryItems: deep(copied.project.libraryItems) },
    references: copied.references.map((row) => ({
      ...row,
      gcsUri: swap(row.gcsUri),
      thumbGcsUri: row.thumbGcsUri === null ? null : swap(row.thumbGcsUri),
    })),
    analyses: copied.analyses,
    crops: copied.crops.map((row) => ({ ...row, gcsUri: swap(row.gcsUri) })),
    moodboards: copied.moodboards.map((row) => ({
      ...row,
      renderUri: row.renderUri === null ? null : swap(row.renderUri),
      elements: deep(row.elements),
      appState: deep(row.appState),
    })),
    tiles: copied.tiles,
    conversations: copied.conversations,
    messages: copied.messages.map((row) => ({ ...row, parts: deep(row.parts) })),
  };
}

function urisIn(value: unknown, found: string[]) {
  if (typeof value === "string") {
    if (value.startsWith("gs://")) found.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) urisIn(item, found);
    return;
  }
  if (value && typeof value === "object") {
    for (const held of Object.values(value)) urisIn(held, found);
  }
}

export function urisOf(copied: CopiedProject): string[] {
  const found: string[] = [];
  urisIn(copied, found);
  return [...new Set(found)];
}

export function prodUrisRemaining(copied: CopiedProject, from: string): string[] {
  return urisOf(copied).filter((uri) => GS_URI.exec(uri)?.[1] === from);
}

export function objectPathsIn(copied: CopiedProject, bucket: string): string[] {
  return urisOf(copied).flatMap((uri) => {
    const match = GS_URI.exec(uri);
    return match && match[1] === bucket ? [match[2]] : [];
  });
}

function jsonInput(value: Prisma.JsonValue): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function nullableJson(value: Prisma.JsonValue | null) {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

export type WriteOptions = { userId: string; withRenders?: boolean };

function orderedReferences(references: Reference[]): Reference[] {
  const written = new Set<string>();
  const pending = [...references];
  const ordered: Reference[] = [];

  while (pending.length) {
    const ready = pending.filter(
      (row) => row.sourceReferenceId === null || written.has(row.sourceReferenceId),
    );
    if (!ready.length) {
      throw new Error(
        `${pending.length} references name a source that is not in the copy — the project is not whole`,
      );
    }
    for (const row of ready) {
      ordered.push(row);
      written.add(row.id);
    }
    pending.splice(0, pending.length, ...pending.filter((row) => !written.has(row.id)));
  }
  return ordered;
}

export function boardColumns(board: Moodboard, { withChats, withRenders }: {
  withChats: boolean;
  withRenders: boolean;
}) {
  return {
    ...board,
    elements: jsonInput(board.elements),
    appState: jsonInput(board.appState),
    layoutSlots: nullableJson(board.layoutSlots),
    vibesBrief: nullableJson(board.vibesBrief),
    ...(withChats ? {} : { conversationId: null }),
    ...(withRenders ? {} : { renderUri: null, renderRevision: null }),
  };
}

export function messageColumns(message: ChatMessage) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    turnId: message.turnId,
    role: message.role,
    status: message.status,
    parts: jsonInput(message.parts),
    createdAt: message.createdAt,
  };
}

export async function writeProject(
  client: CopyClient,
  copied: CopiedProject,
  { userId, withRenders = false }: WriteOptions,
) {
  const withChats = copied.conversations.length > 0;

  await client.project.create({
    data: { ...copied.project, userId, libraryItems: jsonInput(copied.project.libraryItems) },
  });
  if (withChats) await client.conversation.createMany({ data: copied.conversations });

  for (const reference of orderedReferences(copied.references)) {
    await client.reference.create({ data: reference });
  }

  await client.analysis.createMany({ data: copied.analyses });
  await client.crop.createMany({ data: copied.crops });
  await client.moodboard.createMany({
    data: copied.moodboards.map((board) => boardColumns(board, { withChats, withRenders })),
  });
  await client.moodboardTile.createMany({ data: copied.tiles });

  if (withChats) {
    for (const message of copied.messages) {
      await client.chatMessage.create({ data: messageColumns(message) });
    }
  }

  return counted(copied);
}

export function counted(copied: CopiedProject) {
  return {
    Project: 1,
    Reference: copied.references.length,
    Analysis: copied.analyses.length,
    Crop: copied.crops.length,
    Moodboard: copied.moodboards.length,
    MoodboardTile: copied.tiles.length,
    Conversation: copied.conversations.length,
    ChatMessage: copied.messages.length,
  };
}

export async function removeProject(client: CopyClient, projectId: string) {
  await client.project.deleteMany({ where: { id: projectId } });
}
