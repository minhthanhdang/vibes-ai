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
  spentThrown,
  sumUsage,
  usageOf,
  usageThrown,
} from "@/lib/agent/shared/model-cost";

const PRO = "gemini-3.1-pro-preview";
const FLASH = "gemini-3.7-flash";
const IMAGE = "gemini-3-pro-image";

test("thinking tokens are output tokens", () => {
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

  assert.equal(
    costMicrosOf(PRO, { promptTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 }),
    price.input + price.output,
  );
});

test("a drawn picture prices at the image rate, on the dear side of the invoice", () => {
  const price = MODEL_PRICES[IMAGE]!;
  assert.equal(price.output, 120_000_000, "the picture rate, not the $12/M text one");

  const drawn = { promptTokens: 400, outputTokens: 1_490, totalTokens: 1_890 };
  assert.equal(costMicrosOf(IMAGE, drawn), 400 * 2 + 1_490 * 120);
  assert.equal(formatCost(costMicrosOf(IMAGE, drawn)), "$0.18");
});

const FLASH_TURN = [
  {
    promptTokenCount: 12_720,
    candidatesTokenCount: 16,
    totalTokenCount: 12_912,
    trafficType: "ON_DEMAND",
    promptTokensDetails: [{ modality: "TEXT", tokenCount: 12_720 }],
    candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 16 }],
    thoughtsTokenCount: 176,
  },
  {
    promptTokenCount: 13_234,
    candidatesTokenCount: 117,
    totalTokenCount: 13_591,
    cachedContentTokenCount: 10_919,
    trafficType: "ON_DEMAND",
    promptTokensDetails: [{ modality: "TEXT", tokenCount: 13_234 }],
    cacheTokensDetails: [{ modality: "TEXT", tokenCount: 10_919 }],
    candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 117 }],
    thoughtsTokenCount: 240,
  },
  {
    promptTokenCount: 13_669,
    candidatesTokenCount: 177,
    totalTokenCount: 13_846,
    trafficType: "ON_DEMAND",
    promptTokensDetails: [{ modality: "TEXT", tokenCount: 13_669 }],
    candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 177 }],
  },
];

test("a real turn's three calls read as the API's own totals", () => {
  assert.deepEqual(
    FLASH_TURN.map((usageMetadata) => usageOf({ usageMetadata })),
    [
      { promptTokens: 12_720, outputTokens: 192, totalTokens: 12_912 },
      { promptTokens: 13_234, outputTokens: 357, totalTokens: 13_591 },
      { promptTokens: 13_669, outputTokens: 177, totalTokens: 13_846 },
    ],
  );

  for (const usageMetadata of FLASH_TURN) {
    const usage = usageOf({ usageMetadata });
    assert.equal(usage.promptTokens + usage.outputTokens, usage.totalTokens);
  }
});

test("cached prompt tokens stay inside the prompt count, and stay at the full rate", () => {
  const cached = FLASH_TURN[1]!;
  assert.equal(cached.cachedContentTokenCount, 10_919, "the measured call, not a rewritten one");

  const usage = usageOf({ usageMetadata: cached });
  assert.equal(usage.promptTokens, cached.promptTokenCount);

  const priced = costMicrosOf(FLASH, usage)!;
  const withoutCached = costMicrosOf(FLASH, {
    ...usage,
    promptTokens: usage.promptTokens - cached.cachedContentTokenCount,
  })!;
  assert.ok(priced > withoutCached * 3, "a cached round is priced as if nothing were cached");
});

test("a model with no rate is unpriced, which is not free", () => {
  const usage = { promptTokens: 1000, outputTokens: 100, totalTokens: 1100 };
  assert.equal(costMicrosOf("gemini-4-imaginary", usage), null);
  assert.equal(costMicrosOf(null, usage), null);
  assert.notEqual(costMicrosOf(PRO, usage), null);
});

test("a thrown agent's tokens are read off the error, whatever class it is", () => {
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

test("a refusal is priced against the model it names, not against one the caller picked", () => {
  const thrown = Object.assign(new Error("no usable box"), {
    usage: { promptTokens: 3000, outputTokens: 40, totalTokens: 3040 },
    model: FLASH,
  });
  assert.deepEqual(spentThrown(thrown), {
    model: FLASH,
    promptTokens: 3000,
    outputTokens: 40,
    totalTokens: 3040,
  });
});

test("a throw that names no model is not priced at all", () => {
  const carried = { usage: { promptTokens: 1, outputTokens: 2, totalTokens: 3 } };
  for (const thrown of [carried, { ...carried, model: "" }, { ...carried, model: 12 }]) {
    assert.equal(spentThrown(thrown), null);
  }
  assert.equal(spentThrown({ model: FLASH }), null);
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
  const { total } = spendSummary([
    { agent: "ANALYZER", model: null, promptTokens: null, outputTokens: null, totalTokens: null },
    spent("ANALYZER", 1000, 100),
  ]);

  assert.equal(total.runs, 2);
  assert.deepEqual(total.usage, { promptTokens: 1000, outputTokens: 100, totalTokens: 1100 });
  assert.equal(total.costMicros, costMicrosOf(PRO, total.usage));
});

test("one unpriced model with real tokens unprices the total it is part of", () => {
  const { byAgent, total } = spendSummary([
    spent("ANALYZER", 1000, 100),
    spent("CROPPER", 5000, 100, "gemini-4-imaginary"),
  ]);

  assert.equal(total.costMicros, null);
  assert.notEqual(byAgent.find((group) => group.agent === "ANALYZER")!.costMicros, null);
  assert.equal(total.usage.totalTokens, 6200);
});

test("a fraction of a cent is shown as a fraction of a cent", () => {
  assert.equal(formatCost(4_200), "$0.0042");
  assert.equal(formatCost(1_250_000), "$1.25");
  assert.equal(formatCost(0), "$0");
  assert.equal(formatCost(null), "—");
});
