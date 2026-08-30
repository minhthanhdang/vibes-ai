import { test } from "node:test";
import assert from "node:assert/strict";
import { TEST, filesNaming, readSource, sourceFiles } from "./source-tree";

const MODULE = "src/server/google/source-tree.ts";

const NESTED = "src/server/api/routers/reference.ts";

const GENERATED = "src/generated";

test("the walk descends, so a rule reaches the files nobody keeps at the top", async () => {
  assert.ok((await sourceFiles("src")).includes(NESTED));
});

test("every TypeScript spelling is walked, and nothing that only sits beside them", async () => {
  const walked = await sourceFiles("src");
  for (const spelling of ["src/env.ts", "src/env.test.mts", "src/app/layout.tsx"]) {
    assert.ok(walked.includes(spelling), `${spelling} was not walked`);
  }
  for (const beside of ["src/app/globals.css", "src/app/favicon.ico"]) {
    assert.ok(!walked.includes(beside), `${beside} was walked`);
  }
});

test("the generated client is skipped, though it sits inside a directory that is walked", async () => {
  const walked = await sourceFiles("src");
  assert.ok(
    (await sourceFiles(GENERATED)).length > 0,
    "the generated client holds no source, so skipping it proves nothing",
  );
  assert.deepEqual(
    walked.filter((path) => path.startsWith(`${GENERATED}/`)),
    [],
  );
});

test("each directory named is walked, not only the first", async () => {
  const both = await sourceFiles("src", "scripts");
  assert.deepEqual(both, [...(await sourceFiles("src")), ...(await sourceFiles("scripts"))]);
  assert.ok(both.includes("scripts/floor.mts"));
});

test("paths come back repo-relative, and resolve against the web-app root", async () => {
  const walked = await sourceFiles("src");
  for (const path of walked) assert.ok(!path.startsWith("/"), `${path} is absolute`);
  assert.ok((await readSource(MODULE)).length > 0);
});

test("a file is read as text, not as bytes a rule would grep by accident", async () => {
  assert.equal(typeof (await readSource(MODULE)), "string");
});

test("a string needle is looked for anywhere in the file, not only where it opens", async () => {
  const source = await readSource(MODULE);
  const late = source.slice(-20);
  assert.ok(!source.startsWith(late), "the fixture is at the start, so it cannot show reach");
  assert.deepEqual(await filesNaming(late, [MODULE]), [MODULE]);
});

test("a regex needle that matches at the first character is a hit", async () => {
  assert.match(await readSource(MODULE), /^import /, "the fixture no longer opens with an import");
  assert.deepEqual(await filesNaming(/^import /, [MODULE]), [MODULE]);
});

test("a needle carrying `g` is answered from the whole file, not from where it was left", async () => {
  const source = await readSource(MODULE);
  assert.match(source, /\bexport /, "the fixture does not name the needle at all");
  const carried = /\bexport /g;
  carried.lastIndex = source.length;
  assert.deepEqual(await filesNaming(carried, [MODULE]), [MODULE]);
});

test("hits come back sorted, whatever order the files arrived in", async () => {
  const shuffled = ["src/server/google/vertex.ts", MODULE, "src/server/google/auth.ts"];
  assert.deepEqual(await filesNaming(/\bexport /, shuffled), [...shuffled].sort());
  assert.notDeepEqual(shuffled, [...shuffled].sort(), "the fixture arrived sorted already");
});

test("TEST names a test file and not every module written as one", () => {
  assert.ok(TEST.test("src/env.test.mts"));
  assert.ok(!TEST.test("scripts/floor.mts"));
  assert.ok(!TEST.test("src/env.ts"));
});

