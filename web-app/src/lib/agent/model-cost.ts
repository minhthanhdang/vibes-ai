/// What a turn of the pipeline actually cost, in the only units the API reports
/// exactly: tokens.
///
/// Every ceiling in this codebase — `MAX_TOOL_ROUNDS`, `CROP_CALL_LIMIT`,
/// `CROP_MAX_ATTEMPTS`, `COMPOSE_BLOCK_LIMIT` — bounds the *number* of calls,
/// which is a guess at the bill rather than a reading of it. A capped catalog
/// still spends whatever a hundred tags come to. This module is the reading: the
/// counts Vertex returns on every response, summed the way the agents spend
/// them, and priced in one place.
///
/// Tokens are stored, money is derived. A price table goes stale — the model ids
/// are preview ids and the rates change — and a cost written into a row goes
/// stale with it. Counts do not.

export type TokenUsage = {
  promptTokens: number;
  /// Everything the model wrote, thinking included. Thinking tokens bill at the
  /// output rate and are reported apart from the answer, so a Pro call that
  /// reasoned for a page and replied in a sentence reads as cheap unless the two
  /// are added up here.
  outputTokens: number;
  totalTokens: number;
};

export const NO_USAGE: TokenUsage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };

/// `usageMetadata`, as it arrives. Every field is optional because a blocked or
/// truncated response still carries the block and not the count.
///
/// `cachedContentTokenCount` is reported beside these and is deliberately not
/// one of them: it is a *part of* `promptTokenCount`, not a fifth number to add,
/// and the only thing a reader could do with it is charge those tokens a cheaper
/// rate — which needs a column on `AgentRun` to survive the write, and there is
/// none. It is real on `FLASH` (10,919 of 13,234 on a probed orchestrator round,
/// tech-spec §II), so what these rows say is the ceiling on a turn rather than
/// the invoice for it.
type RawUsage = {
  promptTokenCount?: unknown;
  candidatesTokenCount?: unknown;
  thoughtsTokenCount?: unknown;
  totalTokenCount?: unknown;
};

const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;

/// The counts off one response. A response with no `usageMetadata` reads as
/// zero rather than as unknown: the alternative is every caller carrying a
/// null through its own sum, to distinguish a call that cost nothing from one
/// that did not say — a difference no reader of these rows can act on.
export function usageOf(response: { usageMetadata?: unknown } | null | undefined): TokenUsage {
  const raw = (response?.usageMetadata ?? {}) as RawUsage;
  const promptTokens = count(raw.promptTokenCount);
  const outputTokens = count(raw.candidatesTokenCount) + count(raw.thoughtsTokenCount);
  return {
    promptTokens,
    outputTokens,
    /// Reported when it is reported — it counts parts these three fields do not,
    /// so re-deriving it would quietly lose them. Derived only when it is absent.
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

/// Micro-dollars per million tokens, so the arithmetic is integer and a rate
/// like $0.30/M does not arrive as a float.
///
/// Keyed by the model id rather than by the `MODELS` alias, because that is what
/// a run row records and what a rename would break: a row written under the old
/// preview id must still price, and an id nobody has entered a rate for must
/// read as unpriced rather than as free.
///
/// **These rates are the one thing on this page that is not measured.** Check
/// them against cloud.google.com/vertex-ai/generative-ai/pricing before quoting
/// a number at anyone; the token counts either side of them are exact.
///
/// The image model bills its output at two rates — $12/M for the text and the
/// thinking, $120/M for the picture itself — and a run row keeps one output
/// number, so the picture rate is the one entered here. A generation is roughly
/// 1,120 image tokens against 370 thought tokens, so that reads a call about a
/// quarter dearer than the invoice does. Deliberate: the alternative is a second
/// column recording modality, and an image tool that reads cheaper than it is
/// invites exactly the call this table exists to bound.
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "gemini-3.1-pro-preview": { input: 2_000_000, output: 12_000_000 },
  "gemini-3.7-flash": { input: 300_000, output: 2_500_000 },
  "gemini-3-pro-image": { input: 2_000_000, output: 120_000_000 },
};

const PER_MILLION = 1_000_000;

/// What one model's usage comes to, in micro-dollars. Null for a model with no
/// rate — the tokens are still real and still worth showing, and a zero here
/// would read as a call that was free.
export function costMicrosOf(model: string | null | undefined, usage: TokenUsage): number | null {
  const price = model ? MODEL_PRICES[model] : undefined;
  if (!price) return null;
  return Math.round(
    (usage.promptTokens * price.input + usage.outputTokens * price.output) / PER_MILLION,
  );
}

/// The tokens a thrown agent carried out with it, or null when what was thrown
/// carried none.
///
/// Read structurally rather than with `instanceof`. The error crosses a module
/// boundary — the cropper throws it, the executor and the router record it — and
/// a class that has been loaded twice makes a nominal check quietly false at
/// exactly the moment it matters. Two loaders is not hypothetical here: under
/// the test runner an `.mts` file and a `.ts` file importing the same module by
/// the same specifier get two copies of it, so a check that passes in the app
/// cannot be asserted from a test at all.
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
/// or an update. Written through one function because there are four doors onto
/// that table — the analyzer's worker, the panel's crop, the orchestrator's
/// crop and its own turn — and four hand-written copies of the same four keys is
/// three chances to record output tokens in the prompt column.
export function spentColumns(model: string, usage: TokenUsage) {
  return {
    model,
    promptTokens: usage.promptTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

/// What a thrown agent's reads cost and what they cost it *on*, ready to spread
/// onto the failed row — or null when the throw carried no price at all, which
/// is what reaching the model failed rather than the model refusing looks like.
///
/// The model rides out on the error rather than being named again here, because
/// a caller that names it is a caller that can name a different one than the
/// agent called: §II moved five agents at once and left three failure branches
/// pricing flash work at pro rates.
export function spentThrown(cause: unknown) {
  const usage = usageThrown(cause);
  const model = modelThrown(cause);
  if (!usage || !model) return null;
  return spentColumns(model, usage);
}

/// One run row, as this module reads it. Deliberately the columns and nothing
/// else: what a run *is* belongs to Prisma, and pricing it should not need the
/// client.
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
  /// rate. A partial total is worse than no total: it is a number the reader
  /// will take for the whole bill.
  costMicros: number | null;
};

const usageOfRun = (run: SpentRun): TokenUsage => ({
  promptTokens: run.promptTokens ?? 0,
  outputTokens: run.outputTokens ?? 0,
  totalTokens: run.totalTokens ?? 0,
});

/// What the project spent, per agent and in total. Grouped by agent because
/// that is the question worth asking of these rows: the cropper reads
/// photographs and the compositor reads a sentence, so one number over both of
/// them hides which one to go and cap.
///
/// Rows that recorded no counts — everything written before this column existed,
/// and every run that failed before the call — are counted as runs and add
/// nothing, rather than being dropped. A run that spent nothing still happened.
export function spendSummary(runs: readonly SpentRun[]): { byAgent: Spend[]; total: Spend } {
  const groups = new Map<string, SpentRun[]>();
  for (const run of runs) {
    const group = groups.get(run.agent);
    if (group) group.push(run);
    else groups.set(run.agent, [run]);
  }

  const byAgent = [...groups]
    .map(([agent, rows]) => spendOf(agent, rows))
    .sort((a, b) => (b.usage.totalTokens - a.usage.totalTokens) || a.agent.localeCompare(b.agent));

  return { byAgent, total: spendOf("ALL", runs) };
}

function spendOf(agent: string, runs: readonly SpentRun[]): Spend {
  let costMicros: number | null = 0;
  for (const run of runs) {
    const cost = costMicrosOf(run.model, usageOfRun(run));
    /// A run with no tokens on it was never priced, so an unknown model there
    /// costs nothing and unpricing the whole group over it would make every
    /// pre-column row poison the total.
    if (cost === null && usageOfRun(run).totalTokens > 0) costMicros = null;
    else if (costMicros !== null) costMicros += cost ?? 0;
  }

  return {
    agent,
    runs: runs.length,
    usage: sumUsage(runs.map(usageOfRun)),
    costMicros,
  };
}

/// Micro-dollars as money. Small spends are the normal case here — a chat turn
/// is a fraction of a cent — so the fraction is kept rather than rounded to
/// "$0.00", which is the number that makes a bill look like it isn't there.
export function formatCost(micros: number | null): string {
  if (micros === null) return "—";
  const dollars = micros / 1_000_000;
  if (dollars === 0) return "$0";
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}
