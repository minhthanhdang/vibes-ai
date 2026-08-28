import { test } from "node:test";
import assert from "node:assert/strict";

import {
  VIBES_SETTLED_WINDOW_MS,
  vibesBatchProgress,
  vibesSettledCutoff,
  type VibesBatchBoard,
  type VibesQueueRow,
} from "@/lib/vibes/vibes-batch";

/// multi-vibes-and-preview-prd §II.6. The behaviours here are the loop tests'
/// behaviours read off rows instead of off a held value — which page is being
/// designed, what the last one answered, the sentence the user is owed, what
/// stopping leaves behind — because the panel that draws them carries over.

function stamp(second: number): Date {
  return new Date(Date.UTC(2026, 7, 28, 12, 0, second));
}

function row(
  index: number,
  status: VibesQueueRow["status"],
  over: Partial<VibesQueueRow> & { boardId?: string } = {},
): VibesQueueRow {
  const { boardId = "board", ...rest } = over;
  return {
    status,
    input: { boardId, pageId: `page-${index}`, index },
    output: null,
    error: null,
    startedAt: stamp(index),
    ...rest,
  };
}

const designed = (index: number, over: Parameters<typeof row>[2] = {}) =>
  row(index, "SUCCEEDED", { output: { outcome: "designed", runId: `run-${index}` }, ...over });
const empty = (index: number) =>
  row(index, "SUCCEEDED", { output: { outcome: "empty", runId: `run-${index}` } });
const refused = (index: number, reason: string, over: Parameters<typeof row>[2] = {}) =>
  row(index, "SUCCEEDED", { output: { outcome: "refused", reason }, ...over });

function board(total: number, over: Partial<VibesBatchBoard> = {}): VibesBatchBoard {
  return { boardId: "board", title: "A welcome sign", total, ...over };
}

function one(rows: VibesQueueRow[], of = board(6)) {
  const cards = vibesBatchProgress(rows, [of]);
  assert.equal(cards.length, 1);
  return cards[0]!;
}

test("a walking run says which page it is on and how many were asked for", () => {
  const card = one([designed(0), designed(1), row(2, "RUNNING")]);

  assert.equal(card.label, "Designing page 3 of 6…");
  assert.equal(card.designed, 2);
  assert.equal(card.settled, 2);
  assert.equal(card.live, true);
  assert.equal(card.finished, false);
  assert.deepEqual(
    card.pages.map((page) => page.state),
    ["designed", "designed", "designing", "waiting", "waiting", "waiting"],
  );
});

test("a queued chain head reads as designing, not as a pause", () => {
  /// The head is QUEUED only for the moment between a settle and the
  /// self-kick's claim; a run that just started is the same moment.
  const card = one([row(0, "QUEUED")], board(3));

  assert.equal(card.live, true);
  assert.equal(card.label, "Designing page 1 of 3…");
  assert.deepEqual(
    card.pages.map((page) => page.state),
    ["designing", "waiting", "waiting"],
  );
});

test("a refusal at page four keeps pages one to three", () => {
  const card = one([designed(0), designed(1), designed(2), refused(3, "no pictures left to place")]);

  assert.equal(card.designed, 3);
  assert.equal(card.refusal, "no pictures left to place");
  assert.equal(card.label, "Page 4 was not designed — no pictures left to place");
  assert.equal(card.live, false);
  assert.equal(card.finished, false);
  assert.equal(card.pages[3]?.state, "refused");
});

test("a FAILED row is said the way a refusal is", () => {
  /// One vocabulary on purpose: the loop folded a network error into a refusal
  /// because to the run they are the same event, and the panel says them the
  /// same way.
  const card = one([row(0, "FAILED", { error: "the board went away" })], board(3));

  assert.equal(card.refusal, "the board went away");
  assert.equal(card.label, "Page 1 was not designed — the board went away");
});

test("a stopped run is blank pages with nobody walking them", () => {
  /// `vibes.stop` deletes the chain's live row, so what remains is settled
  /// rows and silence — the halt the loop held as a flag, read off the queue.
  const card = one([designed(0), designed(1)]);

  assert.equal(card.live, false);
  assert.equal(card.finished, false);
  assert.equal(card.refusal, null);
  assert.equal(card.label, "Stopped — 2 pages of 6 designed");
});

test("a finished run reads as its count", () => {
  const card = one([designed(0), designed(1), designed(2)], board(3));

  assert.equal(card.finished, true);
  assert.equal(card.label, "3 pages designed");
});

test("one page reads as one page", () => {
  assert.equal(one([designed(0)], board(1)).label, "1 page designed");
  assert.equal(one([designed(0)], board(2)).label, "Stopped — 1 page of 2 designed");
});

test("a page that came back empty does not stop the run and does not count", () => {
  const card = one([designed(0), empty(1), row(2, "RUNNING")], board(3));

  assert.equal(card.designed, 1);
  assert.equal(card.empty, 1);
  assert.equal(card.refusal, null);
  assert.equal(card.live, true);
  assert.equal(card.pages[1]?.state, "empty");
});

test("a run that walked every page and came up short says so", () => {
  const card = one([designed(0), designed(1), empty(2)], board(3));

  assert.equal(card.finished, true);
  assert.equal(card.label, "2 pages of 3 designed — 1 page came back empty");
});

test("a resumed run counts the pages it never got a row for", () => {
  /// Three of six carried designs when the run was resumed, so the chain's
  /// head is page four and the gaps before it are the finished pages —
  /// `vibesLoopPages` made the same inference from the gaps in its steps.
  const card = one([row(3, "RUNNING")]);

  assert.equal(card.designed, 3);
  assert.equal(card.label, "Designing page 4 of 6…");
  assert.deepEqual(
    card.pages.map((page) => page.state),
    ["designed", "designed", "designed", "designing", "waiting", "waiting"],
  );
});

test("a resume inside the settled window outranks the refusal it answers", () => {
  /// The refusal's row is still within the window when the user presses the
  /// offer; the new live row for the same page is the run that is true now.
  const card = one([
    designed(0),
    designed(1),
    designed(2),
    refused(3, "no pictures left to place"),
    row(3, "QUEUED", { startedAt: stamp(30) }),
  ]);

  assert.equal(card.refusal, null);
  assert.equal(card.label, "Designing page 4 of 6…");
  assert.equal(card.pages[3]?.state, "designing");
});

test("when one page has two settled rows the newer claim wins, whatever the order read", () => {
  const rows = [refused(3, "quota ran out", { startedAt: stamp(10) }), designed(3, { startedAt: stamp(40) })];
  for (const read of [rows, [...rows].reverse()]) {
    const card = one([designed(0), designed(1), designed(2), ...read]);
    assert.equal(card.refusal, null);
    assert.equal(card.pages[3]?.state, "designed");
  }
});

test("a row that cannot name its page is not drawn", () => {
  assert.deepEqual(vibesBatchProgress([{ ...designed(0), input: { boardId: "board" } }], [board(3)]), []);

  const card = one([designed(0), { ...designed(1), input: "not a job" }, row(1, "RUNNING")], board(3));
  assert.equal(card.pages[1]?.state, "designing");
});

test("a board with no rows gets no card, and a page past the ask is ignored", () => {
  assert.deepEqual(vibesBatchProgress([], [board(3)]), []);
  assert.deepEqual(vibesBatchProgress([designed(5)], [board(3)]), []);

  /// A page discarded after the ask leaves rows past the run's own end;
  /// they change nothing about the pages the user is counting.
  const card = one([designed(0), designed(1), designed(2), designed(5)], board(3));
  assert.equal(card.finished, true);
});

test("an unreadable settle is a designed page, because SUCCEEDED means it ran to its answer", () => {
  const card = one([row(0, "SUCCEEDED")], board(1));
  assert.equal(card.pages[0]?.state, "designed");
  assert.equal(card.label, "1 page designed");
});

test("cards come one per board, in the order the boards were handed in", () => {
  const cards = vibesBatchProgress(
    [row(0, "RUNNING", { boardId: "second" }), row(1, "RUNNING", { boardId: "first" }), designed(0, { boardId: "first" })],
    [board(3, { boardId: "first", title: "First" }), board(2, { boardId: "second", title: "Second" })],
  );

  assert.deepEqual(
    cards.map((card) => [card.boardId, card.label]),
    [
      ["first", "Designing page 2 of 3…"],
      ["second", "Designing page 1 of 2…"],
    ],
  );
});

test("the settled window is the cutoff's whole arithmetic", () => {
  const now = stamp(0);
  assert.equal(now.getTime() - vibesSettledCutoff(now).getTime(), VIBES_SETTLED_WINDOW_MS);
});
