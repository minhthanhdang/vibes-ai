import { test } from "node:test";
import assert from "node:assert/strict";
import { filesNaming, sourceFiles } from "./google/source-tree";

const MAY_NAME_THE_CONNECTOR = ["src/server/google/cloud-sql.ts"];

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
