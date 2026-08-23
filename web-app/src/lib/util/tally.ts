/// The two rules a count read off rows keeps: how a tally is ordered, and what a
/// number that arrived through JSON is worth.
///
/// Both are shared by `model-cost.ts` and `design-runs.ts`, which read the same
/// `AgentRun` rows to answer two different questions — what a design cost, and
/// what a design did — and both feed a ledger somebody quotes a number out of. A
/// divergence there is not a broken build, it is a wrong number nobody notices.

/// Most first, then by name. The tie-break is the part worth sharing: without
/// it a tally of two statuses with equal counts comes back in whatever order the
/// `Map` happened to hold them, and the next run of the same script prints a
/// different list off identical rows.
export function mostFirst<T>(count: (row: T) => number, name: (row: T) => string) {
  return (a: T, b: T) => count(b) - count(a) || name(a).localeCompare(name(b));
}

/// A whole count off a JSON column, or null when the value is not one — not a
/// number, not finite, or below the floor a count has.
///
/// `min` is named rather than baked because it is the rule, not an accident: a
/// count of things cannot be negative, and a row that says it is has not
/// recorded a count at all.
export function finiteInt(value: unknown, { min = 0 }: { min?: number } = {}): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min ? Math.round(value) : null;
}
