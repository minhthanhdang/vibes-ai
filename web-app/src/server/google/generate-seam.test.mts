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

const DECLARED_IN = "src/server/google/vertex.ts";

const SEAM_CALLERS = [
  "src/server/agents/analyzer/analyzer.ts",
  "src/server/agents/deprecated/compositor.ts",
  "src/server/agents/image-editor/image-editor.ts",
  "src/server/agents/designer/loop.ts",
  "src/server/agents/image-generator/image-generator.ts",
  "src/server/agents/deprecated/layout-reader.ts",
  "src/server/agents/orchestrator/orchestrator.ts",
  "scripts/floor.mts",
];

const INJECTED = [
  "src/server/agents/analyzer/analyzer.ts",
  "src/server/agents/deprecated/compositor.ts",
  "src/server/agents/image-editor/image-editor.ts",
  "src/server/agents/image-generator/image-generator.ts",
  "src/server/agents/deprecated/layout-reader.ts",
];

const STREAM_INJECTED = [
  "src/server/agents/designer/design.ts",
  "src/server/agents/designer/loop.ts",
  "src/server/agents/orchestrator/orchestrator.ts",
];

const FAKED_IN = [
  "src/server/agents/analyzer/analyzer.test.mts",
  "src/server/agents/deprecated/compositor.test.mts",
  "src/server/agents/image-editor/image-editor.test.mts",
  "src/server/agents/designer/design.test.mts",
  "src/server/agents/designer/loop.test.mts",
  "src/server/agents/image-generator/image-generator.test.mts",
  "src/server/agents/deprecated/layout-reader.test.mts",
  "src/server/agents/orchestrator/orchestrator.test.mts",
];

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

type PositionalStream = (
  model: string,
  contents: Content[],
  config?: GenerateConfig,
  watch?: GenerateWatcher,
) => Promise<GenerateAnswer>;

const seam: PositionalSeam = generateContent;
const counting: PositionalCount = countTokens;
const streaming: PositionalStream = generateContentStream;
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
  assert.equal(seam.length, 2);
  assert.equal(counting.length, 2);
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
