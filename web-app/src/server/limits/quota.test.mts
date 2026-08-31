import { test } from "node:test";
import assert from "node:assert/strict";

import {
  claimVibesBoards,
  conversationRoom,
  galleryFullForProject,
  galleryRoom,
  projectRoom,
  refuseOverQuota,
  releaseVibesBoards,
} from "./quota";
import type { PrismaClient } from "@/generated/prisma/client";

type Where = Record<string, unknown>;

function counter(answers: number | ((where: Where) => number)) {
  const seen: Where[] = [];
  const count = async ({ where }: { where: Where }) => {
    seen.push(where);
    return typeof answers === "number" ? answers : answers(where);
  };
  return { seen, count };
}

function projects(used: number) {
  const held = counter(used);
  return { client: { project: held } as unknown as Pick<PrismaClient, "project">, held };
}

function references(used: number) {
  const held = counter(used);
  return { client: { reference: held } as unknown as Pick<PrismaClient, "reference">, held };
}

function conversations(used: number) {
  const held = counter(used);
  return { client: { conversation: held } as unknown as Pick<PrismaClient, "conversation">, held };
}

function users(startingAt: number) {
  const state = { used: startingAt };
  const calls: { where: Where; data: Record<string, unknown> }[] = [];
  const user = {
    updateMany: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      calls.push({ where, data });
      const gate = (where.vibesBoardsUsed as { lte?: number } | undefined)?.lte;
      if (gate !== undefined && state.used > gate) return { count: 0 };
      const increment = (data.vibesBoardsUsed as { increment?: number; decrement?: number }) ?? {};
      state.used += (increment.increment ?? 0) - (increment.decrement ?? 0);
      return { count: 1 };
    },
    findUnique: async () => ({ vibesBoardsUsed: state.used }),
  };
  return { client: { user } as unknown as Pick<PrismaClient, "user">, state, calls };
}

test("a tier-3 account with no projects has room, and one with a project does not", async () => {
  const empty = projects(0);
  assert.equal(await projectRoom(empty.client, { userId: "u1", tier: "TIER_3" }), null);

  const full = projects(1);
  const said = await projectRoom(full.client, { userId: "u1", tier: "TIER_3" });
  assert.match(said!, /1 project/);
});

test("the project count is asked for that user's rows and nobody else's", async () => {
  const { client, held } = projects(0);
  await projectRoom(client, { userId: "u1", tier: "TIER_1" });
  assert.deepEqual(held.seen, [{ userId: "u1" }]);
});

test("a judge gets five projects where everyone else gets one", async () => {
  assert.equal(await projectRoom(projects(4).client, { userId: "u1", tier: "TIER_1" }), null);
  assert.ok(await projectRoom(projects(5).client, { userId: "u1", tier: "TIER_1" }));
  assert.ok(await projectRoom(projects(1).client, { userId: "u1", tier: "TIER_2" }));
});

test("the gallery counts originals across the account, not versions and not one project", async () => {
  const { client, held } = references(3);
  assert.equal(await galleryRoom(client, { userId: "u1", tier: "TIER_2" }), null);
  assert.deepEqual(held.seen, [{ project: { userId: "u1" }, sourceReferenceId: null }]);
});

test("a gallery at its ceiling refuses, and one below it refuses a batch that would cross", async () => {
  assert.ok(await galleryRoom(references(15).client, { userId: "u1", tier: "TIER_3" }));
  assert.equal(await galleryRoom(references(14).client, { userId: "u1", tier: "TIER_3" }), null);

  const said = await galleryRoom(references(13).client, { userId: "u1", tier: "TIER_3", adding: 4 });
  assert.match(said!, /4 more pictures/);
});

function ownedGallery(used: number, tier: string | null) {
  const held = counter(used);
  return {
    project: {
      findUnique: async () => (tier === null ? null : { user: { id: "u1", tier } }),
    },
    reference: held,
  } as unknown as Parameters<typeof galleryFullForProject>[0];
}

test("the agent is told the gallery is full in words it can stop on, not a router refusal", async () => {
  const said = await galleryFullForProject(ownedGallery(20, "TIER_2"), { projectId: "p1" });
  assert.match(said!, /gallery is full/);
  assert.match(said!, /20/);
  assert.match(said!, /Say so/);
});

test("a gallery with room says nothing, and a project nobody owns refuses nothing", async () => {
  assert.equal(await galleryFullForProject(ownedGallery(19, "TIER_2"), { projectId: "p1" }), null);
  assert.equal(await galleryFullForProject(ownedGallery(999, null), { projectId: "gone" }), null);
});

test("the ceiling the agent is told is its own account's, not a shared number", async () => {
  assert.match(
    (await galleryFullForProject(ownedGallery(15, "TIER_3"), { projectId: "p1" }))!,
    /15/,
  );
  assert.equal(await galleryFullForProject(ownedGallery(15, "TIER_1"), { projectId: "p1" }), null);
});

test("conversations are counted inside one project", async () => {
  const { client, held } = conversations(1);
  const said = await conversationRoom(client, { projectId: "p1", tier: "TIER_3" });
  assert.match(said!, /1 chat/);
  assert.deepEqual(held.seen, [{ projectId: "p1" }]);

  assert.equal(await conversationRoom(conversations(1).client, { projectId: "p1", tier: "TIER_2" }), null);
  assert.ok(await conversationRoom(conversations(2).client, { projectId: "p1", tier: "TIER_2" }));
});

test("claiming boards charges the counter up front, and the claim is one guarded statement", async () => {
  const { client, state, calls } = users(0);
  assert.equal(await claimVibesBoards(client, { userId: "u1", tier: "TIER_2", boards: 3 }), null);
  assert.equal(state.used, 3);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].where, { id: "u1", vibesBoardsUsed: { lte: 1 } });
  assert.deepEqual(calls[0].data, { vibesBoardsUsed: { increment: 3 } });
});

test("a claim past the lifetime allowance charges nothing and says what is left", async () => {
  const { client, state } = users(3);
  const said = await claimVibesBoards(client, { userId: "u1", tier: "TIER_2", boards: 2 });
  assert.match(said!, /2 boards/);
  assert.match(said!, /4/);
  assert.equal(state.used, 3);
});

test("the allowance is lifetime — a second batch is charged against the first", async () => {
  const held = users(0);
  assert.equal(await claimVibesBoards(held.client, { userId: "u1", tier: "TIER_3", boards: 2 }), null);
  assert.ok(await claimVibesBoards(held.client, { userId: "u1", tier: "TIER_3", boards: 1 }));
  assert.equal(held.state.used, 2);
});

test("an unlimited tier never writes the counter, because lte: Infinity must not reach Prisma", async () => {
  const { client, calls, state } = users(0);
  assert.equal(await claimVibesBoards(client, { userId: "u1", tier: "TIER_1", boards: 40 }), null);
  assert.equal(calls.length, 0);
  assert.equal(state.used, 0);
});

test("releasing gives back only what was never created, and is a no-op when unlimited", async () => {
  const held = users(0);
  await claimVibesBoards(held.client, { userId: "u1", tier: "TIER_2", boards: 3 });
  await releaseVibesBoards(held.client, { userId: "u1", tier: "TIER_2", boards: 2 });
  assert.equal(held.state.used, 1);

  const judge = users(0);
  await releaseVibesBoards(judge.client, { userId: "u1", tier: "TIER_1", boards: 2 });
  assert.equal(judge.calls.length, 0);

  const none = users(5);
  await releaseVibesBoards(none.client, { userId: "u1", tier: "TIER_2", boards: 0 });
  assert.equal(none.calls.length, 0);
});

test("a refusal is a standing no, not a retry-later", () => {
  assert.throws(
    () => refuseOverQuota("the gallery is full"),
    (thrown: { code?: string; message?: string }) => {
      assert.equal(thrown.code, "FORBIDDEN");
      assert.equal(thrown.message, "the gallery is full");
      return true;
    },
  );
});
