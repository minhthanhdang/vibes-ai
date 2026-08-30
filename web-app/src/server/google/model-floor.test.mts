import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELS } from "./vertex";
import { TEST, filesNaming, readSource, sourceFiles } from "./source-tree";

const DECLARED_IN = "src/server/google/vertex.ts";
const PRICED_IN = "src/lib/agent/shared/model-cost.ts";

const FLOOR = 3.5;

const IMAGE = "IMAGE";

const AGENTS = [
  "src/server/agents/orchestrator/orchestrator.ts",
  "src/server/agents/analyzer/analyzer.ts",
  "src/server/agents/cropper/cropper.ts",
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

test("the app calls FLASH and IMAGE — nothing reaches PRO, including the two agents with no seam", async () => {
  assert.deepEqual([...(await aliasesCalled())].sort(), ["FLASH", IMAGE]);
});

test("every alias the app calls clears the 3.5 floor, the image model excepted", async () => {
  const called = await aliasesCalled();
  assert.ok(called.has("FLASH"), "expected the text and vision tier to be called at all");
  for (const alias of called) {
    if (alias === IMAGE) continue;
    const model = MODELS[alias as keyof typeof MODELS];
    assert.ok(model, `${alias} is called but is not declared in MODELS`);
    assert.ok(generationOf(model) >= FLOOR, `${alias} is ${model}, below the ${FLOOR} floor`);
  }
});

test("a model id is spelled where it is declared and where it is priced, and nowhere else", async () => {
  const named = await filesNaming(/gemini-\d+(?:\.\d+)?-[a-z]/, await appSources());
  assert.deepEqual(named, [PRICED_IN, DECLARED_IN].sort());
});
