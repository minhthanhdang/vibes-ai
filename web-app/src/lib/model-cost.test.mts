import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MODEL_PRICES,
  NO_USAGE,
  addUsage,
  costMicrosOf,
  formatCost,
  spendSummary,
  spentColumns,
  sumUsage,
  usageOf,
  usageThrown,
} from "./model-cost";

const PRO = "gemini-3.1-pro-preview";

test("thinking tokens are output tokens", () => {
  /// The one reading that is easy to get wrong and expensive when it is: a Pro
  /// call that reasoned for a page and answered in a sentence bills the page at
  /// the output rate, and reading only `candidatesTokenCount` would call it 20
  /// tokens.
  assert.deepEqual(
    usageOf({
      usageMetadata: {
        promptTokenCount: 1000,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 4000,
        totalTokenCount: 5020,
      },
    }),
    { promptTokens: 1000, outputTokens: 4020, totalTokens: 5020 },
  );
});

test("a reported total is kept, an absent one is derived", () => {
  /// Kept because it counts parts the other three fields do not — re-deriving it
  /// would quietly drop them.
  assert.equal(
    usageOf({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 99 } })
      .totalTokens,
    99,
  );
  assert.equal(
    usageOf({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }).totalTokens,
    15,
  );
});

test("a response with no usage at all reads as nothing spent, not as a crash", () => {
  for (const response of [undefined, null, {}, { usageMetadata: null }, { usageMetadata: "?" }]) {
    assert.deepEqual(usageOf(response as never), NO_USAGE);
  }
});

test("counts that are not counts are dropped rather than propagated", () => {
  assert.deepEqual(
    usageOf({
      usageMetadata: {
        promptTokenCount: "1000",
        candidatesTokenCount: -5,
        thoughtsTokenCount: Number.NaN,
        totalTokenCount: 12.4,
      },
    }),
    { promptTokens: 0, outputTokens: 0, totalTokens: 12 },
  );
});

test("usage adds up, and an empty sum is nothing", () => {
  const a = { promptTokens: 1, outputTokens: 2, totalTokens: 3 };
  const b = { promptTokens: 10, outputTokens: 20, totalTokens: 30 };
  assert.deepEqual(addUsage(a, b), { promptTokens: 11, outputTokens: 22, totalTokens: 33 });
  assert.deepEqual(sumUsage([]), NO_USAGE);
  assert.deepEqual(sumUsage([a, b, a]), { promptTokens: 12, outputTokens: 24, totalTokens: 36 });
});

test("output is priced at the output rate, not at the prompt's", () => {
  const price = MODEL_PRICES[PRO]!;
  assert.ok(price.output > price.input, "the shape of every rate table this app will ever see");

  /// A million of each, so the answer is the rates themselves and the test says
  /// what it is checking rather than restating an arithmetic.
  assert.equal(
    costMicrosOf(PRO, { promptTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 }),
    price.input + price.output,
  );
});

test("a model with no rate is unpriced, which is not free", () => {
  const usage = { promptTokens: 1000, outputTokens: 100, totalTokens: 1100 };
  assert.equal(costMicrosOf("gemini-4-imaginary", usage), null);
  assert.equal(costMicrosOf(null, usage), null);
  assert.notEqual(costMicrosOf(PRO, usage), null);
});

test("a thrown agent's tokens are read off the error, whatever class it is", () => {
  /// Structural on purpose. The error crosses a module boundary between the
  /// agent that threw it and the row that records it, and a class loaded twice
  /// makes `instanceof` quietly false exactly where the bill is.
  const thrown = Object.assign(new Error("no usable box"), {
    usage: { promptTokens: 3000, outputTokens: 40, totalTokens: 3040 },
  });
  assert.deepEqual(usageThrown(thrown), { promptTokens: 3000, outputTokens: 40, totalTokens: 3040 });
  assert.deepEqual(usageThrown({ usage: { promptTokens: 1, outputTokens: 2 } }), {
    promptTokens: 1,
    outputTokens: 2,
    totalTokens: 3,
  });
});

test("what was thrown by something else carried no tokens", () => {
  /// A network failure is not a spend this app can measure, and a zero there
  /// would be a claim that the call was free rather than that it was unread.
  for (const thrown of [new Error("fetch failed"), null, undefined, "nope", { usage: 12 }]) {
    assert.equal(usageThrown(thrown), null);
  }
});

test("spentColumns is the four keys a run row records, and no others", () => {
  assert.deepEqual(spentColumns(PRO, { promptTokens: 7, outputTokens: 8, totalTokens: 15 }), {
    model: PRO,
    promptTokens: 7,
    outputTokens: 8,
    totalTokens: 15,
  });
});

const spent = (agent: string, promptTokens: number, outputTokens: number, model: string | null = PRO) => ({
  agent,
  model,
  promptTokens,
  outputTokens,
  totalTokens: promptTokens + outputTokens,
});

test("spend is grouped by agent and ordered by what it cost", () => {
  const { byAgent, total } = spendSummary([
    spent("ORCHESTRATOR", 500, 100),
    spent("CROPPER", 8000, 200),
    spent("ORCHESTRATOR", 700, 150),
    spent("COMPOSITOR", 900, 60),
  ]);

  assert.deepEqual(
    byAgent.map((group) => [group.agent, group.runs]),
    /// The cropper first because it reads photographs — which is the whole point
    /// of grouping, since one number over all three hides which cap to move.
    [
      ["CROPPER", 1],
      ["ORCHESTRATOR", 2],
      ["COMPOSITOR", 1],
    ],
  );
  assert.deepEqual(byAgent[1]!.usage, { promptTokens: 1200, outputTokens: 250, totalTokens: 1450 });
  assert.equal(total.runs, 4);
  assert.equal(total.usage.totalTokens, 10_610);
  assert.equal(
    total.costMicros,
    byAgent.reduce((sum, group) => sum + (group.costMicros ?? 0), 0),
  );
});

test("a run that recorded no counts is still a run, and does not unprice the group", () => {
  /// Every row written before these columns existed looks like this, and a
  /// summary that answered "—" for the project because of them would be a
  /// summary nobody could read until the table was cleared.
  const { total } = spendSummary([
    { agent: "ANALYZER", model: null, promptTokens: null, outputTokens: null, totalTokens: null },
    spent("ANALYZER", 1000, 100),
  ]);

  assert.equal(total.runs, 2);
  assert.deepEqual(total.usage, { promptTokens: 1000, outputTokens: 100, totalTokens: 1100 });
  assert.equal(total.costMicros, costMicrosOf(PRO, total.usage));
});

test("one unpriced model with real tokens unprices the total it is part of", () => {
  /// The other way round from the row above: tokens nobody has a rate for are
  /// spend that is really there, and adding the rest up without them would put a
  /// number in front of the director that is short by an unknown amount.
  const { byAgent, total } = spendSummary([
    spent("ANALYZER", 1000, 100),
    spent("CROPPER", 5000, 100, "gemini-4-imaginary"),
  ]);

  assert.equal(total.costMicros, null);
  assert.notEqual(byAgent.find((group) => group.agent === "ANALYZER")!.costMicros, null);
  /// The tokens are still summed — unpriced is not unmeasured.
  assert.equal(total.usage.totalTokens, 6200);
});

test("a fraction of a cent is shown as a fraction of a cent", () => {
  /// A chat turn costs less than a cent, so rounding to two places would print
  /// "$0.00" for every reply the app has ever sent.
  assert.equal(formatCost(4_200), "$0.0042");
  assert.equal(formatCost(1_250_000), "$1.25");
  assert.equal(formatCost(0), "$0");
  assert.equal(formatCost(null), "—");
});
