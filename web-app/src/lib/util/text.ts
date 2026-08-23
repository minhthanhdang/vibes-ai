/// The four rules this codebase kept re-deriving about a piece of text: what it
/// looks like on one line, what makes two lines the same line, and the two ways
/// it is cut to a length.
///
/// Every one of them was written out at nine or more call sites, and three of
/// those had already reached for the same abstraction under three different
/// private names — `words`, `normalWords`, and an inline expression. Formatting
/// converging by accident is untidy; `lineKey` converging by accident is a bug
/// waiting, because it is an *identity* rule three modules have to agree on or a
/// reword silently targets nothing.
///
/// Imports nothing, as `src/lib/util/` does not: it is loaded from the browser,
/// from `server/` and from a script.

/// One line, no runs of blank space. What every title, caption, brief and board
/// line is normalized by before it is measured or matched.
export function collapsed(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/// A line as it is *matched*, which is not how it is stored: the model reads a
/// board's lines out of `inspect_board` and types one back to say which one it
/// means, so the match has to survive a retyped capital and a doubled space.
export function lineKey(text: string): string {
  return collapsed(text).toLowerCase();
}

/// The mark left where text was cut, so a reader takes a truncation for one
/// rather than for a sentence that stopped.
const ELLIPSIS = "…";

/// Cut to a length with the ellipsis *inside* it, so a cut string is never
/// longer than an uncut one, and never ending in the space the cut exposed.
export function clipped(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`;
}

/// Cut to a length without cutting a word in half, and say whether it cut. No
/// ellipsis: the callers that use this say out loud that they truncated, in
/// words the model or the user reads, rather than leaving a mark to interpret.
///
/// A first "word" longer than the whole limit has no boundary to cut at, and a
/// cut in the middle of it is still better than a string that overflows.
export function clampWords(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  const head = text.slice(0, limit);
  const boundary = head.lastIndexOf(" ");
  return { text: (boundary > 0 ? head.slice(0, boundary) : head).trimEnd(), truncated: true };
}
