import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELS } from "./vertex";
import { TEST, filesNaming, readSource, sourceFiles } from "./source-tree";

const DECLARED_IN = "src/server/google/vertex.ts";
const PRICED_IN = "src/lib/agent/shared/model-cost.ts";

const NAMED_IN_COPY = [
  "src/components/landing/architecture-tab.tsx",
  "src/components/landing/diagrams.tsx",
];

const FLOOR = 3.5;

const IMAGE = "IMAGE";

const OPEN_WEIGHT = ["GEMMA"];

const REASONING_AGENTS = [
  "src/server/agents/orchestrator/orchestrator.ts",
  "src/server/agents/designer/loop.ts",
  "src/server/agents/image-editor/image-editor.ts",
];

const ANALYZER = "src/server/agents/analyzer/analyzer.ts";

const AGENTS = [
  "src/server/agents/orchestrator/orchestrator.ts",
  "src/server/agents/analyzer/analyzer.ts",
  "src/server/agents/image-editor/image-editor.ts",
  "src/server/agents/deprecated/compositor.ts",
  "src/server/agents/deprecated/layout-reader.ts",
];

async function appSources() {
  const walked = await sourceFiles("src", "scripts");
  return walked.filter((path) => !TEST.test(path));
}

function generationOf(model: string): number {
  const claimed = /^gemini-(\d+(?:\.\d+)?)-/.exec(model);
  assert.ok(claimed, `${model} is not a gemini id this can read a generation from`);
  return Number(claimed[1]);
}

async function aliasesCalled() {
  const files = (await appSources()).filter((path) => path !== DECLARED_IN);
  const called = new Set<string>();
  for (const path of files) {
    for (const [, alias] of (await readSource(path)).matchAll(/\bMODELS\.([A-Z_]+)/g)) {
      called.add(alias!);
    }
  }
  return called;
}

test("the five agents the floor is about are in the scan", async () => {
  const app = await appSources();
  for (const agent of AGENTS) assert.ok(app.includes(agent), `${agent} was not walked`);
});

test("a generation is read off the id, so the floor below is a number and not a string match", () => {
  assert.equal(generationOf(MODELS.PRO), 3.1);
  assert.equal(generationOf(MODELS.FLASH), 3.7);
  assert.equal(generationOf(MODELS.IMAGE), 3);
});

test("the app calls FLASH, GEMMA and IMAGE — nothing reaches PRO, including the two agents with no seam", async () => {
  assert.deepEqual([...(await aliasesCalled())].sort(), ["FLASH", "GEMMA", IMAGE]);
});

test("every Gemini alias the app calls clears the 3.5 floor, the image model excepted", async () => {
  const called = await aliasesCalled();
  assert.ok(called.has("FLASH"), "expected the text and vision tier to be called at all");
  for (const alias of called) {
    if (alias === IMAGE || OPEN_WEIGHT.includes(alias)) continue;
    const model = MODELS[alias as keyof typeof MODELS];
    assert.ok(model, `${alias} is called but is not declared in MODELS`);
    assert.ok(generationOf(model) >= FLOOR, `${alias} is ${model}, below the ${FLOOR} floor`);
  }
});

test("an open-weight alias is allowed alongside the Gemini tier, and is named as one", async () => {
  for (const alias of OPEN_WEIGHT) {
    const model = MODELS[alias as keyof typeof MODELS];
    assert.ok(model, `${alias} is allow-listed but is not declared in MODELS`);
    assert.doesNotMatch(model, /^gemini-/, `${alias} is ${model}, which is a Gemini id`);
  }
});

test("the reasoning agents stay on the Gemini tier, and only the analyzer went open-weight", async () => {
  for (const agent of REASONING_AGENTS) {
    const source = await readSource(agent);
    assert.match(source, /MODELS\.FLASH/, `${agent} no longer calls the Gemini text tier`);
    assert.doesNotMatch(source, /MODELS\.GEMMA/, `${agent} was moved off Gemini`);
  }

  const analyzer = await readSource(ANALYZER);
  assert.match(analyzer, /MODELS\.GEMMA/, "the analyzer is not on the open-weight model");
  assert.doesNotMatch(analyzer, /MODELS\.FLASH/, "the analyzer still reaches for Flash");
});

const SPELLS_AN_ID = /(?:gemini|gemma)-\d+(?:\.\d+)?-[a-z0-9]/;

test("a model id is spelled where it is declared, where it is priced, and where the copy names it", async () => {
  const named = await filesNaming(SPELLS_AN_ID, await appSources());
  assert.deepEqual(named, [PRICED_IN, DECLARED_IN, ...NAMED_IN_COPY].sort());
});

test("the copy that names a model names the one the analyzer actually runs on", async () => {
  for (const path of NAMED_IN_COPY) {
    const source = await readSource(path);
    assert.ok(source.includes(MODELS.GEMMA), `${path} does not name ${MODELS.GEMMA}`);
    assert.ok(source.includes(MODELS.FLASH), `${path} does not name ${MODELS.FLASH}`);
  }
});
