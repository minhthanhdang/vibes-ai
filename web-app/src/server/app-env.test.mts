import { test } from "node:test";
import assert from "node:assert/strict";
import { TEST, filesNaming, sourceFiles } from "./google/source-tree";

const MAY_NAME_THE_SWITCH = ["src/env.ts"];

const MAY_BRANCH_ON_THE_ENVIRONMENT = ["src/env.ts"];

async function naming(needle: string | RegExp) {
  const app = (await sourceFiles("src", "scripts")).filter((path) => !TEST.test(path));
  return filesNaming(needle, app);
}

test("the app scans as a real tree — the rules below are asserted over files, not over none", async () => {
  const files = await sourceFiles("src");
  assert.ok(files.length > 100, `expected the whole of src, walked ${files.length} files`);
  assert.ok(files.includes("src/env.ts"));
});

test("APP_ENV is spelled where it is parsed, and read nowhere else by name", async () => {
  assert.deepEqual(await naming("APP_ENV"), [...MAY_NAME_THE_SWITCH].sort());
});

test("the branch between the two environments is taken in a short, listed set of places", async () => {
  assert.deepEqual(await naming(/\bdeveloping\(\)/), [...MAY_BRANCH_ON_THE_ENVIRONMENT].sort());
});
