import type { VibesBrief } from "@/lib/vibes/vibes-brief";

/// The run, as the conversation reads it (compositor-v2.md §IX.2).
///
/// A Vibes run writes two kinds of row: the user's ask, once, from
/// `vibes.startBatch`, and one assistant row per page, from the worker's
/// `runVibesPage`. They are written minutes apart by two doors and they are
/// one account — the only account the user ever reads, because the panel is
/// gone the moment the tab is — so the sentences live together rather than
/// beside the code that happens to write each one.
///
/// No canvas, no React, no DOM.

/// The user's own row (§IX.2). Without it a board appears in the project with
/// no account of where it came from, and the next thing the user does is ask
/// agent 6 about it: agent 6 can read the board, but nothing would tell it what
/// the board was *for*.
///
/// The purpose alone, and not the rest of the form: the page count is the
/// number of pages on the board, the preset is their shape and the theme colour
/// is what they are painted — all three are readable off the board itself, and
/// a row restating them would be the only part of the record that can go stale.
export function vibesAsk(brief: VibesBrief): string {
  return `Let's Vibes — ${brief.purpose}`;
}

/// What one page came back with: agent 8's own closing line, whether anything
/// landed on the page, or the refusal that stood in for both.
export type VibesPageAccount = { line: string; empty?: boolean } | { error: string };

/// One assistant row, per page (§IX.2).
///
/// Every one of them names its page, which the line itself does not. A design
/// that runs out of rounds answers "I ran out of steps before I could finish"
/// and says nothing about *which* page ran out — so a run that hit the ceiling
/// twice left the user two identical paragraphs under an ask for six pages and
/// no way to tell which two went short, where the refusal path had been saying
/// "Page 4 was not designed" all along (§IX.5).
///
/// "of 6" rides along because the row outlives the run: read a week later, in a
/// conversation with three boards in it, "Page 3" is a page of something and
/// "Page 3 of 6" is a page of this ask.
export function vibesSaid({
  index,
  total,
  outcome,
}: {
  index: number;
  total: number;
  outcome: VibesPageAccount;
}): string {
  /// Said 1-based, as the form asked for it and as the model was told it
  /// (§IX.3). The 0-based index is the argument the browser holds and it is
  /// never the number a person reads.
  const page = `Page ${index + 1} of ${total}`;

  if ("error" in outcome) return `${page} was not designed — ${outcome.error}`;

  /// A page that answered and placed nothing is not a designed page, and this
  /// is the row that says so. The design did not fail — it ran out of rounds
  /// mid-read — so the line is still agent 8's own; what the row adds is the
  /// one fact the line cannot carry, which is that the page is still blank.
  return outcome.empty ? `${page} is still empty — ${outcome.line}` : `${page} — ${outcome.line}`;
}
