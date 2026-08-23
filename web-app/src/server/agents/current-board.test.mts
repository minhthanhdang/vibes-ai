import { test } from "node:test";
import assert from "node:assert/strict";

import { TEST, filesNaming, readSource, sourceFiles } from "@/server/google/source-tree";

/// §II.1's other half, held over the source: the board the tab is showing gets
/// from the browser to the priming through five files, and only the last two of
/// them are reachable by a test that runs.
///
/// `turn.test.mts` covers the bottom hop and `tools.test.mts` covers what the
/// priming does with the id once it arrives. Above those sit a `"use client"`
/// component, a client store importing `useSyncExternalStore`, and a tRPC
/// mutation that wants an authenticated context — none of which this runner can
/// import, and none of which src/app has ever had a test for. What breaks them
/// is not a wrong answer but a dropped word: a hop that stops passing the id on
/// still compiles, still type-checks, and quietly primes every message as if no
/// board were open. That failure is invisible from every other test in this
/// repo, which is why it is asserted here as text.
///
/// The idiom is `run-price.test.mts`'s: the hops are written out rather than
/// walked to, because a walk that silently resolved to nothing would satisfy
/// every rule below forever.

/// Where the id travels, in the order it travels — the tab, the store that
/// sends the turn, the wire, the turn, and the toolset that primes it.
const CHAIN = [
  "src/app/projects/[id]/reference-sidebar.tsx",
  "src/app/projects/[id]/chat-log.ts",
  "src/server/api/routers/orchestrator.ts",
  "src/server/agents/turn.ts",
  "src/server/agents/tools.ts",
];

/// And the two harnesses that stand in for a browser, which name the id for the
/// same reason and are not hops: `npm run floor` prices the usual case rather
/// than the cheap one, and `npm run smoke` takes `--board`.
const HARNESSES = ["scripts/floor.mts", "scripts/smoke.mts"];

async function appSources() {
  const walked = await sourceFiles("src", "scripts");
  return walked.filter((path) => !TEST.test(path));
}

test("the id is named by the five hops and the two harnesses, and by nothing else", async () => {
  assert.deepEqual(
    await filesNaming("currentBoardId", await appSources()),
    [...CHAIN, ...HARNESSES].sort(),
  );
});

/// Each hop, by the shape it hands the id on in. A file may name the id and
/// still drop it — take it as a parameter, document it, and never pass it —
/// so what is asserted is the call, not the word.
const FORWARDS: [string, RegExp][] = [
  /// The tab. `useOpenBoard()` is the only thing in the repo that knows which
  /// board is on screen, and `?? undefined` is what turns "no board open" into
  /// an absent field rather than a null one.
  [CHAIN[0]!, /currentBoardId: openBoardId \?\? undefined,/],
  /// The store, into the injected ask. Anywhere else in the file is the type
  /// that declares it rather than the send that spends it.
  [CHAIN[1]!, /await ask\(\{[^}]*currentBoardId,/],
  /// The wire, into the turn.
  [CHAIN[2]!, /runOrchestratorTurn\(\{[^}]*currentBoardId: input\.currentBoardId,/],
  /// The turn, into the toolset it builds for this project.
  [CHAIN[3]!, /referenceToolset\(\{[^}]*currentBoardId[^}]*\}\)/],
  /// And the toolset, which resolves it against the board read the brief has
  /// already made — the only lookup on the whole chain.
  [CHAIN[4]!, /\.find\(\(board\) => board\.id === currentBoardId\) \?\? null,/],
];

for (const [path, forward] of FORWARDS) {
  test(`${path} hands the board id on`, async () => {
    assert.match(await readSource(path), forward);
  });
}

/// The rule the spec states outright and no runtime test can defend at the
/// layer someone would break it: the id is never checked against the project on
/// the way down. A tab whose board was deleted in another window sends an id
/// this project has not got, and that must prime as no board rather than fail a
/// send — so the wire takes a bare optional string, and the turn hands what it
/// was given straight to the toolset without a read in between.
test("nothing between the tab and the priming validates the id", async () => {
  assert.match(
    await readSource(CHAIN[2]!),
    /currentBoardId: z\.string\(\)\.optional\(\),/,
    "the wire's schema is a bare optional string — a refinement here refuses the send",
  );
  assert.match(
    await readSource(CHAIN[3]!),
    /const tools = referenceToolset\(\{ db, projectId, currentBoardId \}\);/,
    "the turn forwards the id it was handed, with no lookup of its own",
  );
});
