import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELS } from "./vertex";
import { TEST, filesNaming, readSource, sourceFiles } from "./source-tree";

/// The eligibility floor (tech-spec §I) held as a test rather than as a rule
/// someone remembers. §II moved every text and vision agent onto `FLASH`, and
/// all five are now pinned at their seam — the analyzer and the compositor took
/// `generate` as a parameter too, so a fake reads the model they ask for the way
/// the cropper's, the layout reader's and the orchestrator's do.
///
/// This file is still the floor's own test and not a duplicate of those five: a
/// fake answers for the agent it is handed to, and the question here is about
/// the app — that *no* caller anywhere reaches a model below 3.5, including the
/// callers nobody thought to write a fake for.
///
/// `PRO` stays declared and priced on purpose — it is the fallback for a read
/// that degrades on flash (§II) — which is exactly what makes putting an agent
/// back on it a one-word edit that no other test would notice.

const DECLARED_IN = "src/server/google/vertex.ts";
const PRICED_IN = "src/lib/agent/shared/model-cost.ts";

/// The event asks for Gemini 3.5 or newer. The image model is the one exception
/// §I grants, because no image model at or above the floor exists.
const FLOOR = 3.5;

const IMAGE = "IMAGE";

/// Every agent the floor is about, named rather than counted: a walk that
/// silently resolved to nothing would satisfy "nobody calls PRO" forever.
const AGENTS = [
  "src/server/agents/orchestrator/orchestrator.ts",
  "src/server/agents/analyzer/analyzer.ts",
  "src/server/agents/cropper/cropper.ts",
  "src/server/agents/deprecated/compositor.ts",
  "src/server/agents/deprecated/layout-reader.ts",
];

/// The app as it runs, which is what the requirement is about: the test files
/// name `MODELS.IMAGE` and the pinned flash id freely, and a rule that counted
/// those would be a rule about the suite.
async function appSources() {
  const walked = await sourceFiles("src", "scripts");
  return walked.filter((path) => !TEST.test(path));
}

/// The generation an id claims, read off the id. `gemini-3-pro-image` claims 3.
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
