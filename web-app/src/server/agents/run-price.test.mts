import { test } from "node:test";
import assert from "node:assert/strict";

import { TEST, filesNaming, sourceFiles } from "@/server/google/source-tree";

/// Criterion 5 of the migration — a run row prices against the model that
/// actually did the work — held over the source, because it is the one the type
/// system cannot defend: `spentColumns` takes a string, and every model id is a
/// string.
///
/// The agents' own tests cover the other half: a refusal carries the model it
/// read on, so `spentThrown` prices it correctly. What no unit test reaches is
/// the writer *ignoring* that and naming a model itself — the branches that
/// price a run row sit behind a database call, and the three that went stale
/// when §II moved the agents onto flash were each found by hand.

/// Where a run row's spend is written, named rather than counted: a walk that
/// silently resolved to nothing would satisfy the rule below forever.
const DOORS = [
  /// The analyzer's worker, the orchestrator's own turn, its tools (the crop and
  /// the layout read) and the panel's crop — §III's four doors onto `AgentRun`.
  "src/server/agents/analyzer/analyzer-worker.ts",
  "src/server/agents/orchestrator/turn.ts",
  "src/server/agents/orchestrator/tools.ts",
  "src/server/api/routers/reference.ts",
  /// And the two that used to be branches inside `tools.ts` and are now their own
  /// modules because agent 8 has the same doors (compositor-v2.md §IV.4): the
  /// cut and the drawing. One writer each still, read by two tool layers.
  "src/server/references/tool-crop.ts",
  "src/server/references/tool-generation.ts",
  /// And agent 8's own door, which opens one row per `design_page` call and
  /// closes it on what twelve rounds of a loop cost (compositor-v2.md §VII).
  "src/server/agents/designer/design.ts",
  /// And the module the function is declared in, which is the only other place
  /// the name appears.
  "src/lib/agent/shared/model-cost.ts",
];

async function appSources() {
  const walked = await sourceFiles("src", "scripts");
  return walked.filter((path) => !TEST.test(path));
}

test("the doors onto the run table are the ones this rule is about", async () => {
  const writers = await filesNaming("spentColumns(", await appSources());
  assert.deepEqual(writers, [...DOORS].sort());
});

test("a run row's price is never a model its writer named itself", async () => {
  /// The model comes off the answer (`answer.model`) or off the throw
  /// (`spentThrown`) — either way from the call that was actually made. A writer
  /// naming `MODELS.FLASH` would be a second copy of a decision made in the
  /// agent, and two copies of a model choice is what iteration 1 had to correct
  /// three times over.
  const writers = await filesNaming("spentColumns(", await appSources());
  assert.deepEqual(await filesNaming(/\bMODELS\./, writers), []);
});
