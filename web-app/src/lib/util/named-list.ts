import { collapsed } from "@/lib/util/text";

export function normalizedTitle(raw: string, limit: number): string | null {
  const said = collapsed(raw);
  if (!said) return null;
  return said.slice(0, limit).trim();
}

export function withTitle<T extends { id: string; title: string }>(
  rows: readonly T[],
  id: string,
  title: string,
): T[] {
  return rows.map((row) => (row.id === id ? { ...row, title } : row));
}
