import { Storage } from "@google-cloud/storage";
import { config } from "dotenv";

import {
  MODEL_RENDER_RULE,
  withModelRenderRule,
  type LifecycleRule,
} from "../src/server/google/lifecycle";

config({ path: ".env.local" });
config({ path: ".env" });

const apply = process.argv.includes("--apply");
const name = process.env.GCS_BUCKET;
if (!name) {
  console.error("no GCS_BUCKET in the environment — nothing to read");
  process.exit(1);
}

const bucket = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
}).bucket(name);

function say(rule: LifecycleRule) {
  const { age, matchesPrefix } = rule.condition as {
    age?: number;
    matchesPrefix?: string[];
  };
  const where = matchesPrefix?.length ? matchesPrefix.join(", ") : "the whole bucket";
  const when = age === undefined ? JSON.stringify(rule.condition) : `${age} days`;
  return `${rule.action.type} ${where} after ${when}`;
}

async function rulesOn() {
  const [metadata] = await bucket.getMetadata();
  return {
    rules: (metadata.lifecycle?.rule ?? []) as LifecycleRule[],
    corsOrigins: (metadata.cors ?? []).flatMap((entry) => entry.origin ?? []),
  };
}

const before = await rulesOn();
console.log(
  `gs://${name} — ${before.rules.length} lifecycle rule${before.rules.length === 1 ? "" : "s"}`,
);
for (const rule of before.rules) console.log(`  ${say(rule)}`);

const plan = withModelRenderRule(before.rules);
for (const rule of plan.wider) {
  console.log(`  note: ${say(rule)} also sweeps renders/ — it may bite first`);
}

if (plan.change === "already") {
  console.log(`\nalready swept: ${say(MODEL_RENDER_RULE)}`);
  process.exit(0);
}

for (const rule of plan.replaced) console.log(`  replacing: ${say(rule)}`);
console.log(`\n${plan.change === "added" ? "missing" : "wrong"}: ${say(MODEL_RENDER_RULE)}`);

if (!apply) {
  console.log(
    "re-run with -- --apply to write it (needs a bucket-admin credential, not the app SA)",
  );
  process.exit(1);
}

await bucket.setMetadata({ lifecycle: { rule: plan.rules } });

const after = await rulesOn();
const settled = withModelRenderRule(after.rules);
if (settled.change !== "already") {
  console.error("\nthe write went through but the rule is not what came back");
  process.exit(1);
}
const lostOrigins = before.corsOrigins.filter((origin) => !after.corsOrigins.includes(origin));
if (lostOrigins.length) {
  console.error(`\nCORS lost an origin: ${lostOrigins.join(", ")}`);
  process.exit(1);
}
console.log(
  `\napplied — ${after.rules.length} rule${after.rules.length === 1 ? "" : "s"}, CORS still allows ${after.corsOrigins.join(", ") || "nothing"}`,
);
