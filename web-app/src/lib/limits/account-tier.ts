import type { AccountTier } from "@/generated/prisma/enums";

export const UNLIMITED = Number.POSITIVE_INFINITY;

export type AccountLimits = {
  projects: number;
  galleryImages: number;
  conversationsPerProject: number;
  vibesBoards: number;
};

export type QuotaResource = keyof AccountLimits;

export const TIERS = {
  TIER_1: { projects: 5, galleryImages: 100, conversationsPerProject: 8, vibesBoards: UNLIMITED },
  TIER_2: { projects: 1, galleryImages: 20, conversationsPerProject: 2, vibesBoards: 4 },
  TIER_3: { projects: 1, galleryImages: 15, conversationsPerProject: 1, vibesBoards: 2 },
} as const satisfies Record<AccountTier, AccountLimits>;

export const limitsFor = (tier: AccountTier): AccountLimits => TIERS[tier];

export const isUnlimited = (limit: number) => limit === UNLIMITED;

export const roomFor = (limit: number, used: number, adding = 1) => used + adding <= limit;

export type QuotaReading = { limit: number; used: number; adding?: number };

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

const SAID: Record<QuotaResource, (reading: Required<QuotaReading>) => string> = {
  projects: ({ limit }) =>
    `your plan allows ${plural(limit, "project", "projects")} — delete one to start another`,
  galleryImages: ({ limit, used, adding }) =>
    adding > 1
      ? `that would put ${adding} more pictures in a gallery already holding ${used} of the ${limit} your plan allows — remove some first, or add fewer`
      : `the gallery holds all ${plural(limit, "picture", "pictures")} your plan allows — remove one to add another`,
  conversationsPerProject: ({ limit }) =>
    `your plan allows ${plural(limit, "chat", "chats")} per project — delete one to start another`,
  vibesBoards: ({ limit, used, adding }) =>
    adding > 1
      ? `that batch is ${plural(adding, "board", "boards")} and your plan allows ${limit} in total, of which ${used} ${used === 1 ? "is" : "are"} spent — ask for fewer`
      : `your plan allows ${plural(limit, "board", "boards")} in total, and all of them are spent`,
};

export function quotaRefusal(resource: QuotaResource, reading: QuotaReading): string | null {
  const adding = reading.adding ?? 1;
  if (roomFor(reading.limit, reading.used, adding)) return null;
  return SAID[resource]({ ...reading, adding });
}

export function galleryFullSaid(limit: number): string {
  return `the gallery is full — this account holds all ${limit} pictures its plan allows, so nothing more can be drawn or filed. Say so, and offer to work with what is already there or to discard one first.`;
}
