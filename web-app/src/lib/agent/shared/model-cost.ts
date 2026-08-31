import { finiteInt, mostFirst } from "@/lib/util/tally";

export type TokenUsage = {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export const NO_USAGE: TokenUsage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };

type RawUsage = {
  promptTokenCount?: unknown;
  candidatesTokenCount?: unknown;
  thoughtsTokenCount?: unknown;
  totalTokenCount?: unknown;
};

const count = (value: unknown) => finiteInt(value) ?? 0;

export function usageOf(response: { usageMetadata?: unknown } | null | undefined): TokenUsage {
  const raw = (response?.usageMetadata ?? {}) as RawUsage;
  const promptTokens = count(raw.promptTokenCount);
  const outputTokens = count(raw.candidatesTokenCount) + count(raw.thoughtsTokenCount);
  return {
    promptTokens,
    outputTokens,
    totalTokens: count(raw.totalTokenCount) || promptTokens + outputTokens,
  };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

export function sumUsage(usages: readonly TokenUsage[]): TokenUsage {
  return usages.reduce(addUsage, NO_USAGE);
}

export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "gemini-3.1-pro-preview": { input: 2_000_000, output: 12_000_000 },
  "gemini-3.7-flash": { input: 300_000, output: 2_500_000 },
  "gemini-3-pro-image": { input: 2_000_000, output: 120_000_000 },
  "gemma-4-26b-a4b-it-maas": { input: 150_000, output: 600_000 },
};

const PER_MILLION = 1_000_000;

export function costMicrosOf(model: string | null | undefined, usage: TokenUsage): number | null {
  const price = model ? MODEL_PRICES[model] : undefined;
  if (!price) return null;
  return Math.round(
    (usage.promptTokens * price.input + usage.outputTokens * price.output) / PER_MILLION,
  );
}

export function usageThrown(cause: unknown): TokenUsage | null {
  const usage = (cause as { usage?: unknown } | null | undefined)?.usage as
    | Record<string, unknown>
    | undefined;
  if (!usage || typeof usage !== "object") return null;

  const { promptTokens, outputTokens, totalTokens } = usage;
  if (typeof promptTokens !== "number" || typeof outputTokens !== "number") return null;
  return {
    promptTokens,
    outputTokens,
    totalTokens: typeof totalTokens === "number" ? totalTokens : promptTokens + outputTokens,
  };
}

export function modelThrown(cause: unknown): string | null {
  const model = (cause as { model?: unknown } | null | undefined)?.model;
  return typeof model === "string" && model.length > 0 ? model : null;
}

export function spentColumns(model: string, usage: TokenUsage) {
  return {
    model,
    promptTokens: usage.promptTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

export function spentThrown(cause: unknown) {
  const usage = usageThrown(cause);
  const model = modelThrown(cause);
  if (!usage || !model) return null;
  return spentColumns(model, usage);
}

export type SpentRun = {
  agent: string;
  model: string | null;
  promptTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type Spend = {
  agent: string;
  runs: number;
  usage: TokenUsage;
  costMicros: number | null;
};

const usageOfRun = (run: SpentRun): TokenUsage => ({
  promptTokens: run.promptTokens ?? 0,
  outputTokens: run.outputTokens ?? 0,
  totalTokens: run.totalTokens ?? 0,
});

export function spendSummary(runs: readonly SpentRun[]): { byAgent: Spend[]; total: Spend } {
  const groups = new Map<string, SpentRun[]>();
  for (const run of runs) {
    const group = groups.get(run.agent);
    if (group) group.push(run);
    else groups.set(run.agent, [run]);
  }

  const byAgent = [...groups]
    .map(([agent, rows]) => spendOf(agent, rows))
    .sort(mostFirst((row) => row.usage.totalTokens, (row) => row.agent));

  return { byAgent, total: spendOf("ALL", runs) };
}

function spendOf(agent: string, runs: readonly SpentRun[]): Spend {
  const usages = runs.map(usageOfRun);
  let costMicros: number | null = 0;
  for (const [at, run] of runs.entries()) {
    const usage = usages[at]!;
    const cost = costMicrosOf(run.model, usage);
    if (cost === null && usage.totalTokens > 0) costMicros = null;
    else if (costMicros !== null) costMicros += cost ?? 0;
  }

  return {
    agent,
    runs: runs.length,
    usage: sumUsage(usages),
    costMicros,
  };
}

export function formatCost(micros: number | null): string {
  if (micros === null) return "—";
  const dollars = micros / 1_000_000;
  if (dollars === 0) return "$0";
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}
