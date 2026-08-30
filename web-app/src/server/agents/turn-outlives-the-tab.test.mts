import { test } from "node:test";
import assert from "node:assert/strict";

import { readSource } from "@/server/google/source-tree";

const SEND = "src/server/api/routers/orchestrator.ts";

const DOORS: [string, string, RegExp][] = [[SEND, "send", /chatMessage\.create(Many)?\(/]];

function procedure(source: string, name: string) {
  const from = source.indexOf(`  ${name}: protectedProcedure`);
  assert.ok(from >= 0, `${name} is no longer a procedure in this router`);
  const rest = source.slice(from + 1);
  const to = rest.search(/\n  \w+: protectedProcedure/);
  return to >= 0 ? rest.slice(0, to) : rest;
}

for (const [path, name, write] of DOORS) {
  test(`${path} — ${name} returns a generator rather than being one`, async () => {
    const body = procedure(await readSource(path), name);
    assert.doesNotMatch(
      body,
      /\.mutation\(async function\*/,
      "the resolver must return a generator, not be one — see the comment above",
    );
    assert.match(body, /return \(async function\*/, "this door no longer streams");
  });

  test(`${path} — ${name} keeps its write out of the generator`, async () => {
    const body = procedure(await readSource(path), name);
    const wrote = body.search(write);
    const handed = body.search(/return \(async function\*/);
    assert.ok(wrote >= 0, "this door no longer writes a message");
    assert.ok(
      wrote < handed,
      "the write is after the generator is handed back — a closed tab would skip it",
    );
  });
}

test("the turn's lifetime is tied to the work and never to the socket", async () => {
  const source = await readSource(SEND);
  assert.match(source, /after\(settled\)/);
  assert.doesNotMatch(
    source,
    /\.signal\b|signal:\s/,
    "hearing the client leave is one line away from killing a paid turn",
  );
});
