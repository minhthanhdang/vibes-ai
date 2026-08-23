import { finiteInt, mostFirst } from "@/lib/util/tally";

/// What a turn of the pipeline actually cost, in the only units the API reports
/// exactly: tokens. Tokens are stored, money is derived.

export type TokenUsage = {
  promptTokens: number;
  /// Everything the model wrote, thinking included.
  outputTokens: number;
  totalTokens: number;
};

export const NO_USAGE: TokenUsage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };

/// `usageMetadata`, as it arrives. Every field is optional because a blocked or
/// truncated response still carries the block and not the count.
/// `cachedContentTokenCount` is deliberately not among them.
type RawUsage = {
  promptTokenCount?: unknown;
  candidatesTokenCount?: unknown;
  thoughtsTokenCount?: unknown;
  totalTokenCount?: unknown;
};

/// `finiteInt`'s null is a value that did not arrive; a caller summing money
/// cannot act on the difference between that and nothing spent, so it is zero
/// here.
const count = (value: unknown) => finiteInt(value) ?? 0;

/// The counts off one response. A response with no `usageMetadata` reads as
/// zero rather than as unknown.
export function usageOf(response: { usageMetadata?: unknown } | null | undefined): TokenUsage {
  const raw = (response?.usageMetadata ?? {}) as RawUsage;
  const promptTokens = count(raw.promptTokenCount);
  const outputTokens = count(raw.candidatesTokenCount) + count(raw.thoughtsTokenCount);
  return {
    promptTokens,
    outputTokens,
    /// Reported when it is reported — it counts parts these three fields do
    /// not, so re-deriving it would quietly lose them.
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

/// Micro-dollars per million tokens, keyed by the model id rather than by the
/// `MODELS` alias. **The one thing on this page that is not measured** — check
/// them against cloud.google.com/vertex-ai/generative-ai/pricing before quoting
/// a number at anyone.
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "gemini-3.1-pro-preview": { input: 2_000_000, output: 12_000_000 },
  "gemini-3.7-flash": { input: 300_000, output: 2_500_000 },
  "gemini-3-pro-image": { input: 2_000_000, output: 120_000_000 },
};

const PER_MILLION = 1_000_000;

/// What one model's usage comes to, in micro-dollars. Null for a model with no
/// rate, never zero.
export function costMicrosOf(model: string | null | undefined, usage: TokenUsage): number | null {
  const price = model ? MODEL_PRICES[model] : undefined;
  if (!price) return null;
  return Math.round(
    (usage.promptTokens * price.input + usage.outputTokens * price.output) / PER_MILLION,
  );
}

/// The tokens a thrown agent carried out with it, or null when what was thrown
/// carried none. Read structurally and never with `instanceof`, because the
/// same class loaded twice makes a nominal check quietly false.
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

/// The model a thrown agent was billed against, or null when what was thrown
/// names none. Read structurally for the same reason its tokens are — see
/// `usageThrown`.
export function modelThrown(cause: unknown): string | null {
  const model = (cause as { model?: unknown } | null | undefined)?.model;
  return typeof model === "string" && model.length > 0 ? model : null;
}

/// The `AgentRun` columns for one agent's spend, ready to spread into a create
/// or an update. One function for four doors.
export function spentColumns(model: string, usage: TokenUsage) {
  return {
    model,
    promptTokens: usage.promptTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

/// What a thrown agent's reads cost and what they cost it *on*, ready to spread
/// onto the failed row — or null when the throw carried no price at all. The
/// model rides out on the error rather than being named again here.
export function spentThrown(cause: unknown) {
  const usage = usageThrown(cause);
  const model = modelThrown(cause);
  if (!usage || !model) return null;
  return spentColumns(model, usage);
}

/// One run row, as this module reads it — deliberately the columns and nothing
/// else.
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
  /// Micro-dollars, or null when any run in the group was on a model with no
  /// rate.
  costMicros: number | null;
};

const usageOfRun = (run: SpentRun): TokenUsage => ({
  promptTokens: run.promptTokens ?? 0,
  outputTokens: run.outputTokens ?? 0,
  totalTokens: run.totalTokens ?? 0,
});

/// What the project spent, per agent and in total. A row that recorded no
/// counts is counted as a run and adds nothing.
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
    /// A run with no tokens on it was never priced.
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

/// Micro-dollars as money, with the fraction kept.
export function formatCost(micros: number | null): string {
  if (micros === null) return "—";
  const dollars = micros / 1_000_000;
  if (dollars === 0) return "$0";
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}
