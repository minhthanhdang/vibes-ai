import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TIERS,
  UNLIMITED,
  galleryFullSaid,
  isUnlimited,
  limitsFor,
  quotaRefusal,
  roomFor,
  type QuotaResource,
} from "./account-tier";
import { AccountTier } from "@/generated/prisma/enums";

const RESOURCES: QuotaResource[] = [
  "projects",
  "galleryImages",
  "conversationsPerProject",
  "vibesBoards",
];

test("every tier the database can store is keyed, with every resource on it", () => {
  for (const tier of Object.values(AccountTier)) {
    const limits = limitsFor(tier);
    assert.ok(limits, `${tier} has no limits`);
    for (const resource of RESOURCES) {
      assert.equal(typeof limits[resource], "number", `${tier}.${resource} is not a number`);
      assert.ok(limits[resource] > 0, `${tier}.${resource} is not positive`);
    }
  }
});

test("the judges tier is the most generous of the three at every resource", () => {
  for (const resource of RESOURCES) {
    assert.ok(TIERS.TIER_1[resource] >= TIERS.TIER_2[resource], resource);
    assert.ok(TIERS.TIER_2[resource] >= TIERS.TIER_3[resource], resource);
  }
});

test("an unlimited allowance compares as a number, so no call site needs a null guard", () => {
  assert.equal(TIERS.TIER_1.vibesBoards, UNLIMITED);
  assert.ok(isUnlimited(TIERS.TIER_1.vibesBoards));
  assert.ok(!isUnlimited(TIERS.TIER_2.vibesBoards));
  assert.ok(roomFor(UNLIMITED, 10_000_000, 500));
  assert.equal(quotaRefusal("vibesBoards", { limit: UNLIMITED, used: 10_000, adding: 99 }), null);
});

test("room is counted for what is being added, not only for one more", () => {
  assert.ok(roomFor(4, 2, 2));
  assert.ok(!roomFor(4, 2, 3));
  assert.ok(roomFor(1, 0));
  assert.ok(!roomFor(1, 1));
});

test("a reading with room refuses nothing", () => {
  for (const resource of RESOURCES) {
    assert.equal(quotaRefusal(resource, { limit: 5, used: 2 }), null, resource);
  }
});

test("a reading over the line refuses in a sentence that names the allowance", () => {
  for (const resource of RESOURCES) {
    const said = quotaRefusal(resource, { limit: 3, used: 3 });
    assert.equal(typeof said, "string", resource);
    assert.match(said!, /3/, resource);
    assert.doesNotMatch(said!, /undefined|NaN/, resource);
  }
});

test("each resource refuses in its own words rather than one shared sentence", () => {
  const said = RESOURCES.map((resource) => quotaRefusal(resource, { limit: 2, used: 2 }));
  assert.equal(new Set(said).size, RESOURCES.length);
  assert.match(said[0]!, /project/);
  assert.match(said[1]!, /gallery/);
  assert.match(said[2]!, /chat/);
  assert.match(said[3]!, /board/);
});

test("a batch that overshoots says how much of it is the problem", () => {
  const said = quotaRefusal("vibesBoards", { limit: 4, used: 3, adding: 3 });
  assert.match(said!, /3 boards/);
  assert.match(said!, /4/);
});

test("one over the line reads as singular where the number is one", () => {
  assert.match(quotaRefusal("projects", { limit: 1, used: 1 })!, /1 project\b/);
  assert.match(quotaRefusal("conversationsPerProject", { limit: 1, used: 1 })!, /1 chat\b/);
});

test("the agent-facing gallery sentence names the ceiling and says what to do instead", () => {
  const said = galleryFullSaid(20);
  assert.match(said, /20/);
  assert.match(said, /Say so/);
  assert.doesNotMatch(said, /try again|retry/i);
});
