import "server-only";
import { TRPCError } from "@trpc/server";
import type { AccountTier } from "@/generated/prisma/enums";
import type { PrismaClient } from "@/generated/prisma/client";
import { galleryFullSaid, isUnlimited, limitsFor, quotaRefusal } from "@/lib/limits/account-tier";

type ProjectClient = Pick<PrismaClient, "project">;
type ReferenceClient = Pick<PrismaClient, "reference">;
type ConversationClient = Pick<PrismaClient, "conversation">;
type UserClient = Pick<PrismaClient, "user">;

export const ORIGINAL_GALLERY_IMAGES = { sourceReferenceId: null } as const;

export function refuseOverQuota(said: string): never {
  throw new TRPCError({ code: "FORBIDDEN", message: said });
}

export async function projectRoom(
  client: ProjectClient,
  { userId, tier, adding = 1 }: { userId: string; tier: AccountTier; adding?: number },
): Promise<string | null> {
  const limit = limitsFor(tier).projects;
  if (isUnlimited(limit)) return null;
  const used = await client.project.count({ where: { userId } });
  return quotaRefusal("projects", { limit, used, adding });
}

export async function galleryRoom(
  client: ReferenceClient,
  { userId, tier, adding = 1 }: { userId: string; tier: AccountTier; adding?: number },
): Promise<string | null> {
  const limit = limitsFor(tier).galleryImages;
  if (isUnlimited(limit)) return null;
  const used = await client.reference.count({
    where: { project: { userId }, ...ORIGINAL_GALLERY_IMAGES },
  });
  return quotaRefusal("galleryImages", { limit, used, adding });
}

export async function galleryFullForProject(
  client: ProjectClient & ReferenceClient,
  { projectId }: { projectId: string },
): Promise<string | null> {
  const owner = await client.project.findUnique({
    where: { id: projectId },
    select: { user: { select: { id: true, tier: true } } },
  });
  if (!owner) return null;

  const { id: userId, tier } = owner.user;
  const said = await galleryRoom(client, { userId, tier });
  return said ? galleryFullSaid(limitsFor(tier).galleryImages) : null;
}

export async function conversationRoom(
  client: ConversationClient,
  { projectId, tier, adding = 1 }: { projectId: string; tier: AccountTier; adding?: number },
): Promise<string | null> {
  const limit = limitsFor(tier).conversationsPerProject;
  if (isUnlimited(limit)) return null;
  const used = await client.conversation.count({ where: { projectId } });
  return quotaRefusal("conversationsPerProject", { limit, used, adding });
}

export async function claimVibesBoards(
  client: UserClient,
  { userId, tier, boards }: { userId: string; tier: AccountTier; boards: number },
): Promise<string | null> {
  const limit = limitsFor(tier).vibesBoards;
  if (isUnlimited(limit)) return null;

  const { count } = await client.user.updateMany({
    where: { id: userId, vibesBoardsUsed: { lte: limit - boards } },
    data: { vibesBoardsUsed: { increment: boards } },
  });
  if (count > 0) return null;

  const holder = await client.user.findUnique({
    where: { id: userId },
    select: { vibesBoardsUsed: true },
  });
  return quotaRefusal("vibesBoards", {
    limit,
    used: holder?.vibesBoardsUsed ?? limit,
    adding: boards,
  });
}

export function releaseVibesBoards(
  client: UserClient,
  { userId, tier, boards }: { userId: string; tier: AccountTier; boards: number },
): Promise<unknown> {
  if (boards <= 0 || isUnlimited(limitsFor(tier).vibesBoards)) return Promise.resolve(null);
  return client.user.updateMany({
    where: { id: userId },
    data: { vibesBoardsUsed: { decrement: boards } },
  });
}
