export function collapsed(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function lineKey(text: string): string {
  return collapsed(text).toLowerCase();
}

const ELLIPSIS = "…";

export function clipped(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`;
}

export function clampWords(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  const head = text.slice(0, limit);
  const boundary = head.lastIndexOf(" ");
  return { text: (boundary > 0 ? head.slice(0, boundary) : head).trimEnd(), truncated: true };
}
