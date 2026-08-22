import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countTokens,
  generateContent,
  type Content,
  type CountConfig,
  type GenerateAnswer,
  type GenerateConfig,
} from "./vertex";
import { TEST, filesNaming, readSource, sourceFiles } from "./source-tree";

/// `generateContent(model, contents, config)` is positional and stays that way
/// (tech-spec §VII). The SDK's own call is a parameter object, and letting that
/// shape out through the seam would rewrite four agents and every fake in the
/// suite to buy nothing.
///
/// Nothing already in the tree defends it. The four injected agents type their
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
  "src/server/agents/analyzer.ts",
  "src/server/agents/compositor.ts",
  "src/server/agents/cropper.ts",
  "src/server/agents/image-generator.ts",
  "src/server/agents/layout-reader.ts",
  "src/server/agents/orchestrator.ts",
  "scripts/floor.mts",
];

/// The six that take the seam as a parameter instead of importing it — the
/// reason it has to stay positional at all. The analyzer and the compositor
/// joined them after the migration: both are one call and one read of what came
/// back, and the read is the half that decides what the user is shown.
const INJECTED = [
  "src/server/agents/analyzer.ts",
  "src/server/agents/compositor.ts",
  "src/server/agents/cropper.ts",
  "src/server/agents/image-generator.ts",
  "src/server/agents/layout-reader.ts",
  "src/server/agents/orchestrator.ts",
];

/// Where those four are answered from. `tools.ts` also injects a `generate` and
/// is deliberately absent: that one is `typeof generateImage`, an agent-level
/// call that takes an object and always has.
const FAKED_IN = [
  "src/server/agents/analyzer.test.mts",
  "src/server/agents/compositor.test.mts",
  "src/server/agents/cropper.test.mts",
  "src/server/agents/image-generator.test.mts",
  "src/server/agents/layout-reader.test.mts",
  "src/server/agents/orchestrator.test.mts",
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

const seam: PositionalSeam = generateContent;
const counting: PositionalCount = countTokens;

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
  const named = await filesNaming("generate?: typeof generateContent", await appSources());
  assert.deepEqual(named, [...INJECTED].sort());
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
