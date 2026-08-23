import { finiteInt, mostFirst } from "@/lib/util/tally";

/// What the designs already run came to, read off the `AgentKind.DESIGNER` rows
/// (compositor-v2.md §VIII). Metering.md §VI; the readings themselves are the
/// spec's, at §VIII.
///
/// The ceilings are not imported: they live beside the loop, which is
/// `server-only`, and this module is arithmetic over rows a test can hand it.

/// One run row, as this module reads it — the two columns and nothing else, for
/// the reason `SpentRun` gives next door.
export type DesignRun = {
  status: string;
  output: unknown;
};

/// The draws one design made (`countedRenders`). `failed` is neither a hit nor a
/// miss. Metering.md §VI.1.
export type RenderTally = { made: number; cached: number; failed: number };

/// A run's `output`, as far as this module needs it. Every field is optional
/// because the shape is JSON on a column rather than a type. Metering.md §VI.1.
export type DesignRunOutput = {
  rounds: number | null;
  modelCalls: number | null;
  pictures: number | null;
  picturesRefused: number;
  picturesDropped: number;
  roundsDropped: number;
  /// `"rounds"` when the loop stopped the model mid-work — the only value that
  /// says a §VII ceiling was reached rather than approached. Metering.md §VI.1.
  stopped: string | null;
  renders: RenderTally | null;
  calls: string[];
  /// The skills this design read (§V), as `skills.ts` counted them. Empty for
  /// every row written before the key existed. Metering.md §VI.1.
  skills: string[];
};

const tally = (value: unknown): RenderTally | null => {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const made = finiteInt(row.made);
  const cached = finiteInt(row.cached);
  const failed = finiteInt(row.failed);
  /// All three or none. Metering.md §VI.1.
  if (made === null || cached === null || failed === null) return null;
  return { made, cached, failed };
};

/// One row's `output` column, read defensively — a row this cannot make sense of
/// reads as a design that said nothing rather than throwing. Metering.md §VI.1.
export function designRunOutput(value: unknown): DesignRunOutput {
  const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    rounds: finiteInt(row.rounds),
    modelCalls: finiteInt(row.modelCalls),
    pictures: finiteInt(row.pictures),
    picturesRefused: finiteInt(row.picturesRefused) ?? 0,
    picturesDropped: finiteInt(row.picturesDropped) ?? 0,
    roundsDropped: finiteInt(row.roundsDropped) ?? 0,
    stopped: typeof row.stopped === "string" && row.stopped.length > 0 ? row.stopped : null,
    renders: tally(row.renders),
    calls: Array.isArray(row.calls) ? row.calls.filter((name) => typeof name === "string") : [],
    skills: Array.isArray(row.skills) ? row.skills.filter((name) => typeof name === "string") : [],
  };
}

/// How a set of runs sat under one per-call ceiling. `runs` is the rows that
/// reported the count at all; `atLimit` is the ones that reached it.
/// Metering.md §VI.2.
export type CeilingRead = {
  limit: number;
  runs: number;
  max: number;
  mean: number;
  atLimit: number;
};

export type DesignRunsRead = {
  runs: number;
  byStatus: { status: string; runs: number }[];
  rounds: CeilingRead;
  /// Rounds the loop stopped the model on (§VII) — `stopped: "rounds"` rather
  /// than a count that merely equals the limit. Metering.md §VI.1.
  stoppedOnRounds: number;
  pictures: CeilingRead;
  /// Pictures the picture ceiling refused, and pictures the window dropped out
  /// of the transcript (§III.1) — two different things. Metering.md §VI.2.
  picturesRefused: number;
  picturesDropped: number;
  renders: {
    /// The rows that drew at all, filtered rather than summed in as three
    /// zeroes. Metering.md §VI.2.
    runs: number;
    made: number;
    cached: number;
    failed: number;
    /// `cached / (made + cached)`, or null when nothing was ever drawn — the
    /// number §VIII says to read before the render time. Metering.md §VI.2.
    hitRate: number | null;
  };
  /// Every tool name these designs called, most-called first. Metering.md §VI.2.
  calls: { name: string; calls: number; runs: number }[];
  /// Which of §V's skills the designs actually read, most-read first, over the
  /// rows that recorded any at all — `runs` is that denominator, for the reason
  /// the render tally filters. Metering.md §VI.2.
  skills: { runs: number; read: { name: string; runs: number }[] };
};

function ceiling(counts: number[], limit: number): CeilingRead {
  const total = counts.reduce((sum, count) => sum + count, 0);
  return {
    limit,
    runs: counts.length,
    max: counts.length ? Math.max(...counts) : 0,
    mean: counts.length ? total / counts.length : 0,
    atLimit: counts.filter((count) => count >= limit).length,
  };
}

export function designRunsRead(
  runs: readonly DesignRun[],
  limits: { rounds: number; pictures: number },
): DesignRunsRead {
  const outputs = runs.map(({ output }) => designRunOutput(output));

  const statuses = new Map<string, number>();
  for (const { status } of runs) statuses.set(status, (statuses.get(status) ?? 0) + 1);

  const drew = outputs.map(({ renders }) => renders).filter((row) => row !== null);
  const made = drew.reduce((sum, row) => sum + row.made, 0);
  const cached = drew.reduce((sum, row) => sum + row.cached, 0);

  const calls = new Map<string, { calls: number; runs: number }>();
  for (const output of outputs) {
    const seen = new Set<string>();
    for (const name of output.calls) {
      const entry = calls.get(name) ?? { calls: 0, runs: 0 };
      entry.calls += 1;
      if (!seen.has(name)) {
        entry.runs += 1;
        seen.add(name);
      }
      calls.set(name, entry);
    }
  }

  const taught = outputs.filter(({ skills }) => skills.length > 0);
  const skills = new Map<string, number>();
  for (const output of taught) {
    for (const name of new Set(output.skills)) skills.set(name, (skills.get(name) ?? 0) + 1);
  }

  return {
    runs: runs.length,
    byStatus: [...statuses]
      .map(([status, count]) => ({ status, runs: count }))
      .sort(mostFirst((row) => row.runs, (row) => row.status)),
    rounds: ceiling(
      outputs.map(({ rounds }) => rounds).filter((count) => count !== null),
      limits.rounds,
    ),
    stoppedOnRounds: outputs.filter(({ stopped }) => stopped === "rounds").length,
    pictures: ceiling(
      outputs.map(({ pictures }) => pictures).filter((count) => count !== null),
      limits.pictures,
    ),
    picturesRefused: outputs.reduce((sum, { picturesRefused }) => sum + picturesRefused, 0),
    picturesDropped: outputs.reduce((sum, { picturesDropped }) => sum + picturesDropped, 0),
    renders: {
      runs: drew.length,
      made,
      cached,
      failed: drew.reduce((sum, row) => sum + row.failed, 0),
      hitRate: made + cached > 0 ? cached / (made + cached) : null,
    },
    calls: [...calls]
      .map(([name, entry]) => ({ name, ...entry }))
      .sort(mostFirst((row) => row.calls, (row) => row.name)),
    skills: {
      runs: taught.length,
      read: [...skills]
        .map(([name, count]) => ({ name, runs: count }))
        .sort(mostFirst((row) => row.runs, (row) => row.name)),
    },
  };
}
