import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.GCS_BUCKET = "test-bucket";

const { MODEL_RENDER_RULE, withModelRenderRule } = await import("./lifecycle");
type LifecycleRule = Parameters<typeof withModelRenderRule>[0][number];
const { MODEL_RENDER_LIFECYCLE_DAYS, MODEL_RENDER_PREFIX, modelPageRenderObjectPath } =
  await import("../../lib/scene/moodboard-render");

const cors: LifecycleRule = {
  action: { type: "Delete" },
  condition: { age: 400, matchesPrefix: ["seed/"] },
};

test("the rule sweeps the prefix the renderer actually writes to", () => {
  const path = modelPageRenderObjectPath("page-1", 4);
  const [prefix] = MODEL_RENDER_RULE.condition.matchesPrefix as string[];
  assert.ok(path.startsWith(prefix));
  assert.deepEqual(MODEL_RENDER_RULE, {
    action: { type: "Delete" },
    condition: {
      age: MODEL_RENDER_LIFECYCLE_DAYS,
      matchesPrefix: [MODEL_RENDER_PREFIX],
    },
  });
});

test("a bucket with no rules gains exactly one", () => {
  const plan = withModelRenderRule([]);
  assert.equal(plan.change, "added");
  assert.deepEqual(plan.rules, [MODEL_RENDER_RULE]);
  assert.deepEqual(plan.replaced, []);
});

test("other prefixes are carried across untouched", () => {
  const plan = withModelRenderRule([cors]);
  assert.deepEqual(plan.rules, [cors, MODEL_RENDER_RULE]);
  assert.equal(plan.change, "added");
});

test("a second apply changes nothing and hands back the list it was given", () => {
  const existing = [MODEL_RENDER_RULE, cors];
  const plan = withModelRenderRule(existing);
  assert.equal(plan.change, "already");
  assert.equal(plan.rules, existing);
  assert.deepEqual(plan.replaced, []);
});

test("an older renders rule is replaced rather than left beside the right one", () => {
  const stale: LifecycleRule = {
    action: { type: "Delete" },
    condition: { age: 30, matchesPrefix: [MODEL_RENDER_PREFIX] },
  };
  const plan = withModelRenderRule([cors, stale]);
  assert.equal(plan.change, "replaced");
  assert.deepEqual(plan.replaced, [stale]);
  assert.deepEqual(plan.rules, [cors, MODEL_RENDER_RULE]);
});

test("two renders rules collapse to one", () => {
  const other: LifecycleRule = {
    action: { type: "SetStorageClass", storageClass: "NEARLINE" },
    condition: { age: 2, matchesPrefix: [MODEL_RENDER_PREFIX] },
  };
  const plan = withModelRenderRule([MODEL_RENDER_RULE, other]);
  assert.equal(plan.change, "replaced");
  assert.deepEqual(plan.replaced, [MODEL_RENDER_RULE, other]);
  assert.deepEqual(plan.rules, [MODEL_RENDER_RULE]);
});

test("a rule naming the prefix among others is ours", () => {
  const shared: LifecycleRule = {
    action: { type: "Delete" },
    condition: { age: 90, matchesPrefix: ["seed/", MODEL_RENDER_PREFIX] },
  };
  const plan = withModelRenderRule([shared]);
  assert.equal(plan.change, "replaced");
  assert.deepEqual(plan.rules, [MODEL_RENDER_RULE]);
});

test("a bucket-wide rule is reported rather than replaced — it can sweep first", () => {
  const whole: LifecycleRule = {
    action: { type: "Delete" },
    condition: { age: 3 },
  };
  const plan = withModelRenderRule([whole]);
  assert.deepEqual(plan.wider, [whole]);
  assert.deepEqual(plan.rules, [whole, MODEL_RENDER_RULE]);
});

test("a shorter prefix that still covers renders/ is reported the same way", () => {
  const shorter: LifecycleRule = {
    action: { type: "Delete" },
    condition: { age: 1, matchesPrefix: ["render"] },
  };
  const plan = withModelRenderRule([shorter, cors]);
  assert.deepEqual(plan.wider, [shorter]);
  assert.deepEqual(plan.rules, [shorter, cors, MODEL_RENDER_RULE]);
});

test("a prefix under renders/ is neither ours nor wider", () => {
  const deeper: LifecycleRule = {
    action: { type: "Delete" },
    condition: { age: 1, matchesPrefix: [`${MODEL_RENDER_PREFIX}boards/`] },
  };
  const plan = withModelRenderRule([deeper]);
  assert.equal(plan.change, "added");
  assert.deepEqual(plan.wider, []);
  assert.deepEqual(plan.rules, [deeper, MODEL_RENDER_RULE]);
});
