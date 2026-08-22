/// The seven-day sweep on the `renders/` prefix, read or applied.
/// `npm run bucket:lifecycle`, and `-- --apply` to write it.
///
///   npm run bucket:lifecycle              # what the bucket says now
///   npm run bucket:lifecycle -- --apply   # make it say what §III.2 asks
///
/// compositor-v2.md §III.2 ends stage 0 with a bucket lifecycle rule, and
/// infra.md §IX has carried it as an owner action ever since: the app's identity
/// (`vercel-ui@`) has object access only and cannot read or set bucket metadata,
/// so this cannot be something the app does at boot. It runs on the operator's
/// own ADC — the same credential `gcloud storage buckets update` would use — and
/// that is why it is a script rather than a test or a route.
///
/// Why a script and not the one-line `gcloud` invocation infra.md already
/// writes out: setting a lifecycle is a whole-list write, so the paste-the-rule
/// form silently drops every other rule the bucket has. The merge is in
/// `src/server/google/lifecycle.ts` and tested there; what this adds is the
/// reading, the writing and the check afterwards that CORS survived — the other
/// piece of bucket metadata this project depends on and the one a careless
/// write would take with it.

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
  /// Not an error and not fixed here: somebody else's rule about the whole
  /// bucket is theirs. But it can delete a render before seven days are up, and
  /// then the number in `moodboard-render.ts` is not the number that governs.
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

/// Read back rather than trusting the write, and read CORS back with it: the
/// preflight the browser's direct upload depends on (infra.md §IX) is metadata
/// on the same object as the rules, and a bucket that stopped answering it
/// would not fail here — it would fail on somebody's next drag-and-drop.
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
