import { test } from "node:test";
import assert from "node:assert/strict";
import { filesNaming, sourceFiles } from "./google/source-tree";

/// One database path, held as a test rather than as a rule someone remembers.
/// tech-spec §VIII put the app on Cloud SQL through the connector and left
/// `DATABASE_URL` behind as the Prisma CLI's channel — two names for a database
/// in one repo, which is exactly the shape of thing that drifts back together.
/// A `PrismaClient` built from `DATABASE_URL` anywhere in `src` still works, and
/// silently reads the database the app stopped writing: the ledger `npm run
/// spend` prints would stop growing while the app kept billing.
///
/// The same for the connector itself. One `Connector` per process is a
/// requirement, not a preference — each one holds a cert-refresh loop against
/// the Admin API for its instance — and `cloud-sql.ts` is where the single one
/// lives, along with the cast that reconciles the connector's nested
/// google-auth-library with this project's.
const MAY_NAME_THE_CONNECTOR = ["src/server/google/cloud-sql.ts"];

/// `env.ts` declares it and says what it is now for. Nothing else in the running
/// app has any business with it — the CLI reads it through `prisma.config.ts`,
/// which is not in this walk. `env.test.mts` is the schema's own test and has to
/// name every required key to build a complete environment, on the same
/// precedent as the test files on `sdk-boundary.test.mts`'s allow-lists: a test
/// that asserts a rule needs the words the rule is about.
const MAY_NAME_DATABASE_URL = ["src/env.ts", "src/env.test.mts"];

const SELF = "src/server/db-path.test.mts";

async function naming(needle: string) {
  const named = await filesNaming(needle, await sourceFiles("src"));
  return named.filter((path) => path !== SELF).sort();
}

test("the app scans as a real tree — the rules below are asserted over files, not over none", async () => {
  const files = await sourceFiles("src");
  assert.ok(files.length > 100, `expected the whole of src, walked ${files.length} files`);
  assert.ok(files.includes("src/server/db.ts"));
});

test("the Cloud SQL connector is constructed in one place", async () => {
  assert.deepEqual(await naming("@google-cloud/cloud-sql-connector"), [...MAY_NAME_THE_CONNECTOR].sort());
});

test("nothing the app runs reads DATABASE_URL — it is the Prisma CLI's channel now", async () => {
  assert.deepEqual(await naming("DATABASE_URL"), [...MAY_NAME_DATABASE_URL].sort());
});
