import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countTokens,
  generateContent,
  generateContentStream,
  type Content,
  type CountConfig,
  type GenerateAnswer,
  type GenerateConfig,
  type GenerateWatcher,
} from "./vertex";
import { TEST, filesNaming, readSource, sourceFiles } from "./source-tree";

/// `generateContent(model, contents, config)` is positional and stays that way
/// (tech-spec §VII). The SDK's own call is a parameter object, and letting that
/// shape out through the seam would rewrite four agents and every fake in the
/// suite to buy nothing.
///
/// There are two of them now — the whole-answer call and the streaming one —
/// and the streaming one is deliberately the same three arguments with a
/// watcher after them, so `generateContent` is still assignable to it and no
/// fake in the suite had to change.
///
/// Nothing already in the tree defends any of it. The injected agents type their
/// `generate` as `typeof generateContent`, so they follow the seam wherever it
/// goes; every fake reaches its agent through an `as never` cast, so no fake is
/// held to the seam's shape either. One refactor that moved the seam, its
/// callers and its fakes to a single object in one pass would leave both
/// `typecheck` and the suite green — which is the mutation this file is here to
/// fail.

const DECLARED_IN = "src/server/google/vertex.ts";

/// Everything that asks Vertex for something, under the two names the seam has:
/// `generateContent`/`countTokens` where it is imported, `generate` where it
/// arrives injected. Named rather than discovered, so a walk that resolved to
/// nothing could not satisfy the rules below.
const SEAM_CALLERS = [
  "src/server/agents/analyzer/analyzer.ts",
  "src/server/agents/deprecated/compositor.ts",
  "src/server/agents/cropper/cropper.ts",
  "src/server/agents/designer/loop.ts",
  "src/server/agents/image-generator/image-generator.ts",
  "src/server/agents/deprecated/layout-reader.ts",
  "src/server/agents/orchestrator/orchestrator.ts",
  "scripts/floor.mts",
];

/// The ones that take the whole-answer seam as a parameter instead of importing
/// it — the reason it has to stay positional at all. The analyzer and the
/// compositor joined them after the migration: both are one call and one read of
/// what came back, and the read is the half that decides what the user is shown.
///
/// None of these five narrates anything: each is one call inside a tool the user
/// is already being told about, so there is no round-by-round account to give
/// and nothing to stream.
const INJECTED = [
  "src/server/agents/analyzer/analyzer.ts",
  "src/server/agents/deprecated/compositor.ts",
  "src/server/agents/cropper/cropper.ts",
  "src/server/agents/image-generator/image-generator.ts",
  "src/server/agents/deprecated/layout-reader.ts",
];

/// And the three that take the *streaming* seam. The two round loops narrate
/// their rounds as they run — a summary is the label under a live turn and the
/// text is the reply typing itself — and agent 8's door is here for the reason
/// it was in the list above: a parameter only ever passed on is exactly the one
/// a refactor restates by hand rather than follows.
///
/// Held apart from `INJECTED` rather than folded into it, because
/// `generate?: typeof generateContentStream` *contains* the other string: one
/// substring search over both would go on passing after every one of these had
/// silently stopped streaming.
const STREAM_INJECTED = [
  "src/server/agents/designer/design.ts",
  "src/server/agents/designer/loop.ts",
  "src/server/agents/orchestrator/orchestrator.ts",
];

/// Where those eight are answered from. `tools.ts` also injects a `generate` and
/// is deliberately absent: that one is `typeof generateImage`, an agent-level
/// call that takes an object and always has.
const FAKED_IN = [
  "src/server/agents/analyzer/analyzer.test.mts",
  "src/server/agents/deprecated/compositor.test.mts",
  "src/server/agents/cropper/cropper.test.mts",
  "src/server/agents/designer/design.test.mts",
  "src/server/agents/designer/loop.test.mts",
  "src/server/agents/image-generator/image-generator.test.mts",
  "src/server/agents/deprecated/layout-reader.test.mts",
  "src/server/agents/orchestrator/orchestrator.test.mts",
];

/// The shape the seam promises, written out where a compiler can check it. This
/// assignment stops compiling the moment `generateContent` takes one object.
type PositionalSeam = (
  model: string,
  contents: Content[],
  config?: GenerateConfig,
) => Promise<GenerateAnswer>;

type PositionalCount = (
  model: string,
  contents: Content[],
  config?: CountConfig,
) => Promise<number>;

/// The streaming seam is the same three arguments with a watcher after them,
/// which is what makes it a widening rather than a fork: a function of three
/// parameters is assignable to this, so every `as never` fake in the suite
/// stands in for it unchanged.
type PositionalStream = (
  model: string,
  contents: Content[],
  config?: GenerateConfig,
  watch?: GenerateWatcher,
) => Promise<GenerateAnswer>;

const seam: PositionalSeam = generateContent;
const counting: PositionalCount = countTokens;
const streaming: PositionalStream = generateContentStream;
/// And the widening itself, asserted: the whole-answer seam still stands in for
/// the streaming one.
const widened: PositionalStream = generateContent;

async function appSources() {
  const walked = await sourceFiles("src", "scripts");
  return walked.filter((path) => !TEST.test(path));
}

test("every caller the seam has is in the scan", async () => {
  const app = await appSources();
  for (const caller of SEAM_CALLERS) assert.ok(app.includes(caller), `${caller} was not walked`);
});

test("the seam takes a model and contents, and a config it can do without", () => {
  /// Arity says at runtime what the two assignments above say at compile time,
  /// so `npm test` fails on this and not only `npm run typecheck`: a parameter
  /// object is one argument, and one argument is a length of 1.
  assert.equal(seam.length, 2);
  assert.equal(counting.length, 2);
  /// Two here as well: the config and the watcher are both optional, so a
  /// streamed call is still a model and some contents.
  assert.equal(streaming.length, 2);
  assert.ok(widened);
});

test("every caller names the model first and passes it positionally", async () => {
  for (const caller of SEAM_CALLERS) {
    const source = await readSource(caller);
    assert.ok(
      /await (?:generateContent|countTokens|generate)\(\s*MODELS\./.test(source),
      `${caller} does not call the seam with a model as its first argument`,
    );
  }
});

test("the SDK's parameter object stays on vertex.ts's side of the seam", async () => {
  const named = await filesNaming(/\b(?:generateContent|countTokens)\(\s*\{/, await appSources());
  assert.deepEqual(named, [DECLARED_IN]);

  for (const caller of SEAM_CALLERS) {
    const source = await readSource(caller);
    assert.ok(
      !/\bgenerate\(\s*\{/.test(source),
      `${caller} hands the seam an object rather than three arguments`,
    );
  }
});

test("the injected agents take the seam by type rather than restating its shape", async () => {
  /// Anchored on the semicolon, because `generateContentStream` starts with
  /// `generateContent`: without it this test passes over a file that has quietly
  /// moved to the other seam.
  const named = await filesNaming(/generate\?: typeof generateContent;/, await appSources());
  assert.deepEqual(named, [...INJECTED].sort());
});

test("the two round loops and agent 8's door take the streaming seam", async () => {
  const named = await filesNaming(/generate\?: typeof generateContentStream;/, await appSources());
  assert.deepEqual(named, [...STREAM_INJECTED].sort());
});

test("the fakes those agents are tested through are positional too", async () => {
  for (const faked of FAKED_IN) {
    const source = await readSource(faked);
    assert.ok(
      /async \(_?model: string, contents: Content\[\]/.test(source),
      `${faked} fakes the seam with something other than a positional model and contents`,
    );
  }
});
