export function mostFirst<T>(count: (row: T) => number, name: (row: T) => string) {
  return (a: T, b: T) => count(b) - count(a) || name(a).localeCompare(name(b));
}

export function finiteInt(value: unknown, { min = 0 }: { min?: number } = {}): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min ? Math.round(value) : null;
}
