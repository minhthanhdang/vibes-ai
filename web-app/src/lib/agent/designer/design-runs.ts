import { finiteInt, mostFirst } from "@/lib/util/tally";

export type DesignRun = {
  status: string;
  output: unknown;
};

export type RenderTally = { made: number; cached: number; failed: number };

export type DesignRunOutput = {
  rounds: number | null;
  modelCalls: number | null;
  pictures: number | null;
  picturesRefused: number;
  picturesDropped: number;
  roundsDropped: number;
  stopped: string | null;
  renders: RenderTally | null;
  calls: string[];
  skills: string[];
};

const tally = (value: unknown): RenderTally | null => {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const made = finiteInt(row.made);
  const cached = finiteInt(row.cached);
  const failed = finiteInt(row.failed);
  if (made === null || cached === null || failed === null) return null;
  return { made, cached, failed };
};

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
  stoppedOnRounds: number;
  pictures: CeilingRead;
  picturesRefused: number;
  picturesDropped: number;
  renders: {
    runs: number;
    made: number;
    cached: number;
    failed: number;
    hitRate: number | null;
  };
  calls: { name: string; calls: number; runs: number }[];
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

function statusCounts(runs: readonly DesignRun[]) {
  const statuses = new Map<string, number>();
  for (const { status } of runs) statuses.set(status, (statuses.get(status) ?? 0) + 1);
  return [...statuses]
    .map(([status, count]) => ({ status, runs: count }))
    .sort(mostFirst((row) => row.runs, (row) => row.status));
}

function callTally(outputs: readonly DesignRunOutput[]) {
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
  return [...calls]
    .map(([name, entry]) => ({ name, ...entry }))
    .sort(mostFirst((row) => row.calls, (row) => row.name));
}

function skillTally(outputs: readonly DesignRunOutput[]) {
  const taught = outputs.filter(({ skills }) => skills.length > 0);
  const skills = new Map<string, number>();
  for (const output of taught) {
    for (const name of new Set(output.skills)) skills.set(name, (skills.get(name) ?? 0) + 1);
  }
  return {
    runs: taught.length,
    read: [...skills]
      .map(([name, count]) => ({ name, runs: count }))
      .sort(mostFirst((row) => row.runs, (row) => row.name)),
  };
}

function renderTotals(outputs: readonly DesignRunOutput[]) {
  const drew = outputs.map(({ renders }) => renders).filter((row) => row !== null);
  const made = drew.reduce((sum, row) => sum + row.made, 0);
  const cached = drew.reduce((sum, row) => sum + row.cached, 0);
  return {
    runs: drew.length,
    made,
    cached,
    failed: drew.reduce((sum, row) => sum + row.failed, 0),
    hitRate: made + cached > 0 ? cached / (made + cached) : null,
  };
}

export function designRunsRead(
  runs: readonly DesignRun[],
  limits: { rounds: number; pictures: number },
): DesignRunsRead {
  const outputs = runs.map(({ output }) => designRunOutput(output));

  return {
    runs: runs.length,
    byStatus: statusCounts(runs),
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
    renders: renderTotals(outputs),
    calls: callTally(outputs),
    skills: skillTally(outputs),
  };
}
