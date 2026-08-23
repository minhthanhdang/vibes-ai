/// What the designs already run came to, read off the `AgentKind.DESIGNER` rows
/// (compositor-v2.md §VIII).
///
/// `design.ts` writes four things onto every run row that nothing has ever read
/// back: the rounds, the pictures, the draws and what stopped the loop. §VIII
/// names two of them as the numbers to check before moving a ceiling — "measure
/// the cache hit rate before the render time", and "watch the `AgentRun` rows
/// before raising it" of `DESIGNER_PICTURE_LIMIT` — and both of those are a
/// question about the *set* of runs rather than about one of them. A ceiling
/// read off a single design is a ceiling set by the last thing somebody tried.
///
/// The ceilings themselves are not imported here: they live beside the loop,
/// which is `server-only`, and this module is arithmetic over rows that a test
/// can hand it. The caller passes them in, which also means a row written under
/// an older limit can be read against the limit that was in force for it.
///
/// Nothing here prices anything — `model-cost.ts` next door does that off the
/// same rows, and the two questions are separate: that one asks what a design
/// cost, this one asks what a design *did*.
///
/// The first reading it took, over the 32 designs on the development database
/// (`npm run design:runs`, $1.70 of Vertex between them), answered both of
/// §VIII's questions against the guess that was standing in for them:
///
///   - the render cache hits **7%** of the time — 6 of 85 draws — so the
///     eight-second render budget is a per-look cost, not a per-revision one
///   - `DESIGNER_PICTURE_LIMIT` **has never refused a picture**: 117 fetched
///     across 30 designs, mean 3.9, max 7 against a limit of 8
///   - `DESIGNER_ROUND_LIMIT` is the one that binds — 3 designs reached it and
///     2 were stopped mid-work by it
///   - 7 of agent 8's 17 declarations have never been called by any design,
///     and every one of them is re-sent on every round (`npm run floor`)
///
/// The fourth number it reads is the newest, and the reason the row carries it
/// at all: which of §V's thirteen skills a design was taught. §VIII leaves
/// three guards standing against an ugly page — the skill, the picture and the
/// second look — and the skills were the only one of the three that left no
/// trace, because they reach the model as text in a transcript the loop throws
/// away. The first reading over the three fixture asks: `typography` read by
/// every design, the occupation matching the ask read by each, and one of
/// `visual-hierarchy` or `composition` alongside — so of the ten skills that
/// are not the ask's own trade, exactly two have ever been opened.
///
/// Read again at 67 designs, 33 of them recording their skills, and the shape
/// held: `typography` 33 of 33, `visual-hierarchy` 28, `grid-systems` 16, and
/// `colour-theory`, `light-and-shadow` and `photographer` **zero** — including
/// every one of the 23 designs whose intention handed it a palette of hexes.
/// Three slots (`SKILLS_PER_CALL`) all spent on an occupation and two ways of
/// arranging a page, which is what §II.5's two examples both look like. That is
/// this census answering the question it was built to ask: §VIII leaves the
/// skill standing as one of three guards against an ugly page, and the guard
/// against an unreadable colour was never being asked for. What answered it is
/// a sentence in the Vibes intention (§IX.3) rather than a fourth slot — and
/// not one in agent 8's instruction, which was tried first and moved nothing
/// across two live designs and two wordings.

/// One run row, as this module reads it — the two columns and nothing else, for
/// the reason `SpentRun` gives next door.
export type DesignRun = {
  status: string;
  output: unknown;
};

/// The draws one design made (`countedRenders`). `failed` is neither a hit nor
/// a miss: the renderer answering "I could not" says nothing about whether the
/// bytes were already there.
export type RenderTally = { made: number; cached: number; failed: number };

/// A run's `output`, as far as this module needs it. Every field is optional
/// because the shape is JSON on a column rather than a type: rows predate keys,
/// a FAILED row carries the draws and none of the rest, and a design that never
/// looked has no `renders` at all.
export type DesignRunOutput = {
  rounds: number | null;
  modelCalls: number | null;
  pictures: number | null;
  picturesRefused: number;
  picturesDropped: number;
  roundsDropped: number;
  /// `"rounds"` when the loop stopped the model mid-work — the only value that
  /// says a §VII ceiling was reached rather than approached.
  stopped: string | null;
  renders: RenderTally | null;
  calls: string[];
  /// The skills this design read (§V), as `skills.ts` counted them — so a name
  /// here is one whose text really went into the transcript, not one the model
  /// typed. Empty for every row written before the key existed, which is why
  /// the census reports the designs that answered rather than all of them.
  skills: string[];
};

const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;

const tally = (value: unknown): RenderTally | null => {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const made = whole(row.made);
  const cached = whole(row.cached);
  const failed = whole(row.failed);
  /// All three or none: a partial tally would read as a hit rate over a
  /// denominator that is missing its misses.
  if (made === null || cached === null || failed === null) return null;
  return { made, cached, failed };
};

/// One row's `output` column, read defensively. A row this cannot make sense of
/// reads as a design that said nothing rather than throwing: these rows are a
/// ledger of every design ever run on this database, including the ones written
/// before the key existed, and a census that dies on the oldest row is a census
/// nobody can take.
export function designRunOutput(value: unknown): DesignRunOutput {
  const row = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    rounds: whole(row.rounds),
    modelCalls: whole(row.modelCalls),
    pictures: whole(row.pictures),
    picturesRefused: whole(row.picturesRefused) ?? 0,
    picturesDropped: whole(row.picturesDropped) ?? 0,
    roundsDropped: whole(row.roundsDropped) ?? 0,
    stopped: typeof row.stopped === "string" && row.stopped.length > 0 ? row.stopped : null,
    renders: tally(row.renders),
    calls: Array.isArray(row.calls) ? row.calls.filter((name) => typeof name === "string") : [],
    skills: Array.isArray(row.skills) ? row.skills.filter((name) => typeof name === "string") : [],
  };
}

/// How a set of runs sat under one per-call ceiling. `runs` is the rows that
/// reported the count at all, so a mean is over the designs that answered and
/// not over the ledger; `atLimit` is the ones that reached it, which is the
/// number that decides whether the ceiling is binding or decorative.
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
  /// than a count that merely equals the limit, because a design that finishes
  /// on its last round finished.
  stoppedOnRounds: number;
  pictures: CeilingRead;
  /// Pictures the picture ceiling refused, and pictures the window dropped out
  /// of the transcript (§III.1). The first is the model asking to look and being
  /// answered in words; the second is the ordinary case and the whole cost lever.
  picturesRefused: number;
  picturesDropped: number;
  renders: {
    /// The rows that drew at all. A design that never looked is filtered out
    /// rather than summed in as three zeroes, for the reason `drawsMade` gives.
    runs: number;
    made: number;
    cached: number;
    failed: number;
    /// `cached / (made + cached)`, or null when nothing was ever drawn. This is
    /// the number §VIII says to read before the render time: a design whose
    /// draws are mostly `made` is paying the eight-second budget on every look.
    hitRate: number | null;
  };
  /// Every tool name these designs called, most-called first — what twelve
  /// rounds are actually spent on.
  calls: { name: string; calls: number; runs: number }[];
  /// Which of §V's thirteen the designs actually read, most-read first, over
  /// the rows that recorded any at all. §VIII leaves the skill as one of three
  /// guards against an ugly page, and a foundation no design ever asks for is a
  /// guard that is not standing — but it is also thirteen summaries in
  /// `get_skill`'s description, paid on every round whether or not anything is
  /// read. `runs` is the denominator here for the same reason the render tally
  /// filters: a row from before the key is a design that said nothing about
  /// skills, not a design that read none.
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
      .sort((a, b) => b.runs - a.runs || a.status.localeCompare(b.status)),
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
      .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)),
    skills: {
      runs: taught.length,
      read: [...skills]
        .map(([name, count]) => ({ name, runs: count }))
        .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name)),
    },
  };
}
