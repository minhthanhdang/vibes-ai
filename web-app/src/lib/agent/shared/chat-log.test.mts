import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_CHAT_LOG,
  chatAnswered,
  chatAsked,
  chatBoardDiscarded,
  chatPageDiscarded,
  chatCutTaken,
  chatHydrated,
  chatPagePicked,
  chatPagesListed,
  chatProgressed,
  chatReferenceDiscarded,
  chatFailed,
  chatRetried,
  chatTyped,
  discardedIn,
  goneAtLoad,
  pagesOf,
  recordedEvent,
  shownAs,
  subjectsIn,
  type ChatLog,
} from "@/lib/agent/shared/chat-log";
import { asHistory, forDisplay, spoken, stepsOf, type Message, type Part } from "@/lib/agent/shared/conversation";
import type { TurnEvent } from "@/lib/agent/shared/turn-events";
import { discardKey } from "@/lib/boards/board-discard";
import { pageDiscardKey } from "@/lib/pages/page-discard";
import { referenceDiscardKey } from "@/lib/references/reference-discard";
import { attachmentOf, type BoardAttachment, type ChatAttachment } from "@/lib/agent/shared/attachments";
import type { TakenCut } from "@/lib/crop/cut-taken";

const TAKEN: TakenCut = {
  referenceId: "cut-1",
  frameId: "frame-1",
  title: "Hall doorway (crop 2)",
  keeps: "the doorway alone",
  aspect: "2.39:1",
  thumbUrl: "/api/references/cut-1/image?variant=thumb",
};

function picture(id: string): ChatAttachment {
  return attachmentOf({ id, title: id, thumbUrl: `/${id}` });
}

/// A stored row as `chat.list` hands it over — the shape `messageSchema` reads,
/// with the store's own ids.
function row(over: Partial<Message> & { seq: number }): unknown {
  return {
    id: `stored-${over.seq}`,
    turnId: `turn-${over.seq}`,
    role: "user",
    status: "sent",
    parts: [{ type: "text", text: `stored message ${over.seq}` }],
    at: "2026-08-21T00:00:00.000Z",
    ...over,
  };
}

test("an ask trims the message, carries its pages as parts and marks the turn pending", () => {
  const failed = chatFailed(EMPTY_CHAT_LOG, "the model was unreachable");
  const log = chatAsked(failed, "  lay that out as a grid  ", [
    { boardId: "board-1", pageId: "page-1", revision: 3, name: "Act one" },
  ]);

  const asked = log.messages[0]!;
  assert.equal(asked.role, "user");
  assert.equal(asked.status, "pending");
  /// Pages ahead of the words, the order the store writes them in.
  assert.deepEqual(asked.parts, [
    { type: "page", boardId: "board-1", pageId: "page-1", revision: 3, name: "Act one" },
    { type: "text", text: "lay that out as a grid" },
  ]);
  assert.equal(log.asking, true);
  assert.equal(log.error, null);
  assert.deepEqual(log.attached, []);
});

test("a half-written message is kept, and emptied by the ask that sends it", () => {
  const typed = chatTyped(EMPTY_CHAT_LOG, "low-key light, deep");
  assert.equal(typed.draft, "low-key light, deep");

  /// The box is cleared because the message left — one transition, so the two
  /// cannot disagree about whether it was sent.
  assert.equal(chatAsked(typed, typed.draft).draft, "");
});

test("an answer settles the question and shares its turnId, with the tiles as parts", () => {
  const shown = [picture("ref-1")];
  const log = chatAnswered(chatAsked(EMPTY_CHAT_LOG, "show me the hall"), {
    reply: "Here it is.",
    attachments: shown,
  });

  const [asked, answered] = log.messages;
  assert.equal(log.messages.length, 2);
  assert.equal(asked!.status, "sent");
  assert.equal(answered!.role, "assistant");
  assert.equal(answered!.turnId, asked!.turnId);
  assert.deepEqual(answered!.parts, [
    { type: "text", text: "Here it is." },
    { type: "attachment", attachment: shown[0] },
  ]);
  assert.equal(log.asking, false);
});

test("a failed turn keeps the question, marks it unsent and stops the flight", () => {
  const log = chatFailed(chatAsked(EMPTY_CHAT_LOG, "compose a board"), "Too many requests");

  /// The question stays: dropping it would leave the error standing under
  /// whatever was said before it. Marked, because the box it was typed in has
  /// already been emptied and the model never saw a word of it.
  assert.equal(log.messages[0]?.status, "failed");
  assert.equal(spoken(log.messages[0]!.parts), "compose a board");
  assert.equal(log.asking, false);
  assert.equal(log.error, "Too many requests");
  /// And the step list goes with the flight: a turn that broke has its steps in
  /// no row, so there is nothing to expand to.
  assert.equal(log.progress, null);
});

test("a message the model never saw does not go up as history", () => {
  const answered = chatAnswered(chatAsked(EMPTY_CHAT_LOG, "what have I got"), {
    reply: "Two photographs.",
    attachments: [],
  });
  const log = chatFailed(chatAsked(answered, "compose a board"), "Too many requests");

  assert.deepEqual(
    asHistory(log.messages).map((turn) => turn.text),
    ["what have I got", "Two photographs."],
  );
});

test("the failure marks the question rather than whatever is at the bottom", () => {
  /// A cut taken in the properties panel lands as an event while the turn is in
  /// flight, so the question that failed is not the last message in the column.
  const asked = chatAsked(EMPTY_CHAT_LOG, "crop the doorway");
  const log = chatFailed(chatCutTaken(asked, TAKEN), "Too many requests");

  assert.equal(log.messages[0]?.status, "failed");
  assert.equal(log.messages[1]?.status, "sent");
  /// And the event is still history — it happened, whatever the turn did.
  assert.equal(asHistory(log.messages).length, 1);
  assert.equal(log.progress, null);
});

test("a failure after an answered turn marks nothing", () => {
  const answered = chatAnswered(chatAsked(EMPTY_CHAT_LOG, "what have I got"), {
    reply: "Two photographs.",
    attachments: [],
  });
  const log = chatFailed(answered, "Too many requests");

  assert.equal(log.messages.some((message) => message.status === "failed"), false);
  assert.equal(log.error, "Too many requests");
  assert.equal(log.progress, null);
});

test("a retry drops the message with that id when two messages have the same text", () => {
  const once = chatFailed(chatAsked(EMPTY_CHAT_LOG, "compose a board"), "Too many requests");
  const twice = chatFailed(chatAsked(once, "compose a board"), "Too many requests");
  const [first, second] = twice.messages;

  /// The *second* copy, deliberately: a retry that reached for the first failed
  /// message, or the first with this text, would pass on the first copy too.
  const retried = chatRetried(twice, second!.id);
  assert.deepEqual(retried.messages, [first]);
  assert.equal(retried.error, null);
});

test("only a failed message can be sent again", () => {
  const asked = chatAsked(EMPTY_CHAT_LOG, "compose a board");

  assert.equal(chatRetried(asked, asked.messages[0]!.id), asked);
  assert.equal(chatRetried(asked, "no-such-id"), asked);
});

test("a retried question carries the pages the failed message carried", () => {
  const pages = [{ boardId: "board-1", pageId: "page-1", revision: 3, name: "Act one" }];
  const log = chatFailed(chatAsked(EMPTY_CHAT_LOG, "make this warmer", pages), "Down");

  assert.deepEqual(pagesOf(log.messages[0]!), pages);
});

test("a taken cut lands as the user's own turn: a note over the model's shoulder, a tile under it", () => {
  const log = chatCutTaken(EMPTY_CHAT_LOG, TAKEN);
  const message = log.messages[0]!;

  assert.equal(message.role, "user");
  assert.equal(message.status, "sent");
  const drawn = forDisplay(message.parts);
  assert.equal(drawn[0]?.kind, "note");
  assert.match(drawn[0]!.kind === "note" ? drawn[0]!.text : "", /cut-1/);
  /// The cut itself under the note, as a reference the click opens the frame at.
  assert.equal(drawn[1]?.kind, "tile");
});

test("the event a message carries is read back whole, for the record the store keeps", () => {
  const cut = recordedEvent(chatCutTaken(EMPTY_CHAT_LOG, TAKEN).messages[0]!);
  assert.equal(cut?.event, "cut_taken");
  assert.match(cut!.note, /cut-1/);
  assert.equal(cut?.attachment?.kind, "reference");

  const board = recordedEvent(
    chatBoardDiscarded(EMPTY_CHAT_LOG, { boardId: "board-1", title: "Act two" }).messages[0]!,
  );
  assert.equal(board?.event, "board_discarded");
  assert.deepEqual(board?.payload, { boardId: "board-1", title: "Act two" });
  assert.equal(board?.attachment, undefined);

  /// A plain word from the user is not an event and must not be posted as one.
  assert.equal(recordedEvent(chatAsked(EMPTY_CHAT_LOG, "hello").messages[0]!), null);
});

test("the log is a value, so nothing that draws it can be the thing that holds it", () => {
  const first: ChatLog = chatAsked(EMPTY_CHAT_LOG, "hello");
  const second = chatAnswered(first, { reply: "hi", attachments: [] });

  /// Every transition returns a new log and leaves the old one alone — which is
  /// what lets the store keep one per project and hand it to a column that
  /// mounts and unmounts underneath it.
  assert.equal(first.messages.length, 1);
  assert.equal(second.messages.length, 2);
  assert.notEqual(first, second);
  assert.equal(EMPTY_CHAT_LOG.messages.length, 0);
});

test("an event note goes up as history like anything else the user said", () => {
  const log = chatCutTaken(
    chatAnswered(chatAsked(EMPTY_CHAT_LOG, "crop the doorway"), {
      reply: "Here is a cut to look at.",
      attachments: [],
    }),
    TAKEN,
  );

  const window = asHistory(log.messages);
  assert.equal(window.length, 3);
  assert.equal(window[2]?.role, "user");
  assert.match(window[2]!.text, /cut-1/);
});

const OFFERED_BOARD: BoardAttachment = {
  kind: "board",
  boardId: "board-1",
  title: "Act two",
  caption: "6 photographs · Grid 3×3",
  thumbUrl: null,
  preview: null,
  lines: [],
  linesOver: 0,
  images: 6,
  discard: true,
};

test("a discarded board becomes a note in the conversation and a tile that is no longer a way in", () => {
  const answered = chatAnswered(chatAsked(EMPTY_CHAT_LOG, "bin act two"), {
    reply: "Here it is — discard it and it is gone.",
    attachments: [OFFERED_BOARD],
  });
  const log = chatBoardDiscarded(answered, {
    boardId: "board-1",
    title: "Act two",
    pictures: 6,
  });

  const note = log.messages.at(-1)!;
  assert.equal(note.role, "user");
  const drawn = forDisplay(note.parts);
  assert.equal(drawn.length, 1);
  assert.match(drawn[0]!.kind === "note" ? drawn[0]!.text : "", /Act two/);

  const settled = shownAs(discardedIn(log.messages), OFFERED_BOARD);
  assert.equal(settled.gone && "boardId" in settled.gone ? settled.gone.boardId : null, "board-1");
  /// The tile is still drawn — it is under a reply that was about it — and the
  /// board is still the board; what changed is that there is nowhere to go.
  assert.equal(settled.attachment, OFFERED_BOARD);
});

/// A page going leaves the board standing, so the tile it settles
/// cannot be keyed by the board — every later tile of that board would be
/// behind the same mark — and the note has to say the boardId is still good.
test("a discarded page settles its own tile and tells the conversation the board is still there", () => {
  const offered: BoardAttachment = {
    ...OFFERED_BOARD,
    discardPage: { pageId: "page-2", name: "Act two" },
  };
  const log = chatPageDiscarded(EMPTY_CHAT_LOG, {
    boardId: "board-1",
    pageId: "page-2",
    boardTitle: "Cold open",
    title: "Act two",
    pictures: 3,
    pagesLeft: 1,
  });

  const note = spoken(log.messages.at(-1)!.parts);
  assert.match(note, /“Act two” \(page-2\)/);
  assert.match(note, /board itself is still there and board-1 still works/);

  const discarded = discardedIn(log.messages);
  const settled = shownAs(discarded, offered).gone;
  assert.equal(settled && "pageId" in settled ? settled.pageId : null, "page-2");
  /// The board's own tile in the same reply is untouched: the board is still a
  /// way in, and it is a different rectangle now rather than a dead one.
  assert.equal(shownAs(discarded, OFFERED_BOARD).gone, undefined);
});

test("a board thrown away settles the tiles of its pages as well as its own", () => {
  const offered: BoardAttachment = {
    ...OFFERED_BOARD,
    discardPage: { pageId: "page-2", name: "Act two" },
  };
  const log = chatBoardDiscarded(EMPTY_CHAT_LOG, {
    boardId: "board-1",
    title: "Act two",
    pictures: 6,
  });

  assert.equal(shownAs(discardedIn(log.messages), offered).gone?.title, "Act two");
});

test("another board in the same reply is untouched by a discard, and a picture never is", () => {
  const other: BoardAttachment = {
    ...OFFERED_BOARD,
    boardId: "board-2",
    discard: undefined,
  };
  const log = chatBoardDiscarded(EMPTY_CHAT_LOG, {
    boardId: "board-1",
    title: "Act two",
    pictures: 6,
  });

  const discarded = discardedIn(log.messages);
  assert.equal(shownAs(discarded, other).gone, undefined);
  assert.equal(shownAs(discarded, OFFERED_BOARD).gone?.title, "Act two");
  assert.equal(shownAs(discarded, picture("ref-1")).gone, undefined);
});

test("a removed picture becomes a note and a tile that is no longer a way in", () => {
  const offered = attachmentOf(
    { id: "ref-1", title: "Ridge study", thumbUrl: "/ref-1" },
    { cuts: 2, boards: [{ id: "board-7", title: "Act one" }] },
  );
  const log = chatReferenceDiscarded(EMPTY_CHAT_LOG, {
    referenceId: "ref-1",
    title: "Ridge study",
    cuts: 2,
    boards: [{ id: "board-7", title: "Act one" }],
  });

  const note = spoken(log.messages.at(-1)!.parts);
  assert.match(note, /Ridge study/);
  assert.match(note, /2 cuts made of it/);

  const discarded = discardedIn(log.messages);
  assert.equal(shownAs(discarded, offered).gone?.title, "Ridge study");
  assert.equal(shownAs(discarded, picture("ref-2")).gone, undefined);
  /// And the note goes up as the user's own turn, so the next message is
  /// answered by a model that knows the id is dead.
  assert.equal(asHistory(log.messages).at(-1)?.role, "user");
});

/// The spec's own test: the map is not state any more, it is the events read
/// back — so the fold over what a session did must equal the map that session
/// would have built by hand, key for key.
test("the discarded map rebuilt from event parts equals the map the session built by hand", () => {
  const board = { boardId: "board-1", title: "Act two", pictures: 6 };
  const page = {
    boardId: "board-2",
    pageId: "page-2",
    boardTitle: "Cold open",
    title: "Act two",
    pictures: 3,
    pagesLeft: 1,
  };
  const reference = { referenceId: "ref-1", title: "Ridge study", cuts: 2 };
  const log = chatReferenceDiscarded(
    chatPageDiscarded(chatBoardDiscarded(chatCutTaken(EMPTY_CHAT_LOG, TAKEN), board), page),
    reference,
  );

  assert.deepEqual(discardedIn(log.messages), {
    [discardKey("board-1")]: board,
    [pageDiscardKey("board-2", "page-2")]: page,
    [referenceDiscardKey("ref-1")]: reference,
  });
});

test("the fold reads stored rows the same as the session's own messages, and skips what it cannot", () => {
  const board = { boardId: "board-1", title: "Act two" };
  const rows = [
    row({
      seq: 1,
      parts: [{ type: "event", event: "board_discarded", note: "I discarded it.", payload: board }],
    }),
    /// A payload a newer build shaped differently — the record without the id
    /// the key is made of — settles nothing: kept as a message, folded past,
    /// the same terms as an unknown part.
    row({
      seq: 2,
      parts: [
        { type: "event", event: "reference_discarded", note: "I removed it.", payload: { ref: "ref-1" } },
      ],
    }),
    row({
      seq: 3,
      parts: [
        { type: "event", event: "page_discarded", note: "I took it off.", payload: { boardId: "board-9" } },
      ],
    }),
  ];
  const log = chatHydrated(EMPTY_CHAT_LOG, rows);

  assert.equal(log.messages.length, 3);
  assert.deepEqual(discardedIn(log.messages), { [discardKey("board-1")]: board });
});

/// The existence read is asked about every subject the stored tiles name —
/// once each, however many replies showed it — and about nothing a part this
/// build cannot read.
test("the subjects the tiles name are collected once each, and an unknown part names nothing", () => {
  const rows = [
    {
      parts: [
        { type: "attachment", attachment: OFFERED_BOARD },
        { type: "attachment", attachment: picture("ref-1") },
      ],
    },
    {
      parts: [
        { type: "attachment", attachment: picture("ref-1") },
        { type: "vignette", attachment: picture("ref-9") },
        { type: "text", text: "and the words between them" },
      ],
    },
    { parts: "not even an array" },
  ];

  assert.deepEqual(subjectsIn(rows), { boardIds: ["board-1"], referenceIds: ["ref-1"] });
});

/// The fold covers what was done through the conversation's own offers. A
/// subject deleted by another door left no event to replay, so its tile is
/// settled by the store's existence answer — under the same key the fold would
/// have used, with a record synthesized off the snapshot the chat kept, because
/// after the delete that snapshot is the only place the title survives.
test("gone-ness at load settles exactly the tiles whose subjects the store says are dead", () => {
  const answered = chatAnswered(chatAsked(EMPTY_CHAT_LOG, "show me"), {
    reply: "Two pictures and a board.",
    attachments: [OFFERED_BOARD, picture("ref-1"), picture("ref-2")],
  });

  const discarded = goneAtLoad(answered.messages, {
    boardIds: ["board-1"],
    referenceIds: ["ref-2"],
  });

  assert.deepEqual(discarded, {
    [discardKey("board-1")]: { boardId: "board-1", title: "Act two" },
    [referenceDiscardKey("ref-2")]: {
      referenceId: "ref-2",
      title: "ref-2",
      frameId: null,
      origin: null,
    },
  });
  /// The living tile is untouched, and the dead ones settle through `shownAs`
  /// exactly as an event's record would.
  assert.equal(shownAs(discarded, picture("ref-1")).gone, undefined);
  assert.equal(shownAs(discarded, OFFERED_BOARD).gone?.title, "Act two");
  /// A dead id no tile names settles nothing — the map is of tiles, not of ids.
  assert.deepEqual(goneAtLoad(answered.messages, { boardIds: ["board-9"], referenceIds: [] }), {});
});

test("hydration puts the stored conversation under what the session has already said", () => {
  const asked = chatAsked(EMPTY_CHAT_LOG, "and now?");
  const log = chatHydrated(asked, [row({ seq: 1 }), row({ seq: 2, role: "assistant" })]);

  assert.deepEqual(
    log.messages.map((message) => `${message.role}:${message.status}`),
    ["user:sent", "assistant:sent", "user:pending"],
  );
  /// And what was loaded is history on the next message — under the wire's
  /// roles, not the store's — which is the point of loading it.
  assert.deepEqual(
    asHistory(log.messages).map((turn) => `${turn.role}: ${turn.text}`),
    ["user: stored message 1", "model: stored message 2"],
  );
});

test("a row carrying a part this build does not know loads, draws as nothing and stays out of history", () => {
  const log = chatHydrated(EMPTY_CHAT_LOG, [
    row({
      seq: 1,
      parts: [{ type: "hologram", beam: "wide" }, { type: "text", text: "and these words" }],
    }),
  ]);

  assert.equal(log.messages.length, 1);
  assert.deepEqual(forDisplay(log.messages[0]!.parts), [{ kind: "bubble", text: "and these words" }]);
  assert.deepEqual(asHistory(log.messages).map((turn) => turn.text), ["and these words"]);
});

const PAGE = { boardId: "board-1", pageId: "page-1", revision: 3, name: "Act one" };

test("a page picked for the message being written is held beside the draft", () => {
  const log = chatPagePicked(chatTyped(EMPTY_CHAT_LOG, "put the stairwell on"), PAGE);

  assert.deepEqual(log.attached, [PAGE]);
  assert.equal(log.draft, "put the stairwell on");
});

test("the message carries the pages that were picked, and the picker is emptied by the send", () => {
  const picked = chatPagePicked(EMPTY_CHAT_LOG, PAGE);
  const log = chatAsked(picked, "make this one warmer", picked.attached);

  assert.deepEqual(pagesOf(log.messages.at(-1)!), [PAGE]);
  /// Per-message, not sticky: the next question is about a page only if the
  /// user says so again.
  assert.deepEqual(log.attached, []);
});

test("a message sent with nothing attached carries no page parts at all", () => {
  const asked = chatAsked(EMPTY_CHAT_LOG, "what have I got");
  assert.deepEqual(pagesOf(asked.messages.at(-1)!), []);
  assert.deepEqual(asked.messages.at(-1)!.parts, [{ type: "text", text: "what have I got" }]);
});

test("a page the board no longer lists stops being attached", () => {
  const picked = chatPagePicked(EMPTY_CHAT_LOG, PAGE);
  const log = chatPagesListed(picked, { boardId: "board-1", revision: 4, pages: [] });

  assert.deepEqual(log.attached, []);
});

test("a list that changes nothing about the selection is the same log", () => {
  const picked = chatPagePicked(EMPTY_CHAT_LOG, PAGE);
  const listed = chatPagesListed(picked, {
    boardId: "board-1",
    revision: 3,
    pages: [{ pageId: "page-1", name: "Act one" }],
  });

  assert.equal(listed, picked);
});

/// The live turn, folded into the log one event at a time. `chatProgressed` is
/// the only writer of `progress` and is total — every case below that changes
/// nothing returns the *same object*, because this runs tens of times per turn
/// and a new object each time is a re-render of the column per round.

const round = (
  calls: { callId: string; name: string }[],
  agent = "orchestrator",
  under: string[] = [],
): TurnEvent => ({
  kind: "calling",
  agent,
  under,
  seq: 1,
  calls: calls.map((call) => ({ ...call, args: {} })),
});

const back = (
  results: { callId: string; name: string; ok: boolean }[],
  agent = "orchestrator",
  under: string[] = [],
): TurnEvent => ({ kind: "called", agent, under, seq: 2, results });

const thinking = (text: string): TurnEvent => ({
  kind: "thinking",
  agent: "orchestrator",
  under: [],
  seq: 1,
  text,
});

test("an ask opens the progress the turn will be filled in against", () => {
  const log = chatAsked(EMPTY_CHAT_LOG, "what have I got");
  assert.equal(log.progress?.turnId, log.messages[0]?.turnId);
  assert.deepEqual(log.progress?.steps, []);
  assert.equal(log.progress?.thought, null);
  /// The question's own timestamp, not a second clock reading.
  assert.equal(log.progress?.startedAt, log.messages[0]?.at);
});

test("a round names its calls as steps, in the order the model made them", () => {
  const log = chatProgressed(
    chatAsked(EMPTY_CHAT_LOG, "crop them"),
    round([
      { callId: "1.1", name: "list_references" },
      { callId: "1.2", name: "crop_reference" },
    ]),
  );
  assert.deepEqual(log.progress?.steps, [
    { callId: "1.1", name: "list_references" },
    { callId: "1.2", name: "crop_reference" },
  ]);
});

test("a round announced twice is one step, and costs no re-render", () => {
  const once = chatProgressed(chatAsked(EMPTY_CHAT_LOG, "go"), round([{ callId: "1.1", name: "add_board" }]));
  const twice = chatProgressed(once, round([{ callId: "1.1", name: "add_board" }]));
  assert.equal(twice, once, "the same log object comes back");
});

test("a round finished settles each step by its callId, not by its name", () => {
  /// Two parallel crops: matched by name, one result would settle the other's
  /// step and the column would say the wrong picture failed.
  const asked = chatProgressed(
    chatAsked(EMPTY_CHAT_LOG, "crop them both"),
    round([
      { callId: "1.1", name: "crop_reference" },
      { callId: "1.2", name: "crop_reference" },
    ]),
  );
  const log = chatProgressed(
    asked,
    back([
      { callId: "1.1", name: "crop_reference", ok: true },
      { callId: "1.2", name: "crop_reference", ok: false },
    ]),
  );
  assert.deepEqual(log.progress?.steps, [
    { callId: "1.1", name: "crop_reference", ok: true },
    { callId: "1.2", name: "crop_reference", ok: false },
  ]);
});

test("a result for a call nobody announced is not a step", () => {
  const asked = chatAsked(EMPTY_CHAT_LOG, "go");
  const log = chatProgressed(asked, back([{ callId: "9.9", name: "add_board", ok: true }]));
  assert.equal(log, asked, "nothing matched, so nothing changed");
});

test("a nested agent's steps carry the agent that ran them", () => {
  /// Agent 8's calls are numbered independently of agent 6's, so the key has to
  /// carry the agent or the designer's result settles the orchestrator's step.
  const asked = chatProgressed(
    chatAsked(EMPTY_CHAT_LOG, "design me a page"),
    round([{ callId: "1.1", name: "design_page" }]),
  );
  const nested = chatProgressed(asked, round([{ callId: "1.1", name: "put_on_canvas" }], "designer", ["orchestrator"]));

  assert.deepEqual(nested.progress?.steps, [
    { callId: "1.1", name: "design_page" },
    { callId: "designer/1.1", name: "put_on_canvas", agent: "designer" },
  ]);

  /// And the designer's own result settles the designer's step alone.
  const settled = chatProgressed(
    nested,
    back([{ callId: "1.1", name: "put_on_canvas", ok: true }], "designer", ["orchestrator"]),
  );
  assert.equal(settled.progress?.steps[0]?.ok, undefined);
  assert.equal(settled.progress?.steps[1]?.ok, true);
});

test("a thought summary replaces the last one rather than piling up", () => {
  const first = chatProgressed(chatAsked(EMPTY_CHAT_LOG, "go"), thinking("they want a mood"));
  assert.equal(first.progress?.thought, "they want a mood");

  const second = chatProgressed(first, thinking("the hall is the one"));
  assert.equal(second.progress?.thought, "the hall is the one");

  const same = chatProgressed(second, thinking("the hall is the one"));
  assert.equal(same, second, "an unchanged thought costs nothing");
});

test("an event that lands after the answer changes nothing", () => {
  const answered = chatAnswered(chatAsked(EMPTY_CHAT_LOG, "go"), { reply: "done", attachments: [] });
  const log = chatProgressed(answered, round([{ callId: "1.1", name: "add_board" }]));
  assert.equal(log, answered);
});

test("an event of a kind this build does not know changes nothing", () => {
  const asked = chatAsked(EMPTY_CHAT_LOG, "go");
  const log = chatProgressed(asked, { kind: "nonsense" } as unknown as TurnEvent);
  assert.equal(log, asked);
});

test("an answer clears the progress with the flight", () => {
  const asked = chatProgressed(chatAsked(EMPTY_CHAT_LOG, "go"), round([{ callId: "1.1", name: "add_board" }]));
  const log = chatAnswered(asked, { reply: "Filed.", attachments: [] });
  assert.equal(log.progress, null);
  assert.equal(log.asking, false);
});

test("a failed turn clears the progress it will never finish", () => {
  const asked = chatProgressed(chatAsked(EMPTY_CHAT_LOG, "go"), round([{ callId: "1.1", name: "add_board" }]));
  const log = chatFailed(asked, "Too many requests");
  assert.equal(log.progress, null);
});

test("an answer carrying the turn's own parts stores them, calls and all", () => {
  /// Without this the session that ran the turn holds a message synthesized
  /// from the reply alone, and the summary under it is empty until the page
  /// reloads — the wrong way round.
  const parts: Part[] = [
    { type: "call", callId: "1.1", name: "list_references", args: {} },
    { type: "result", callId: "1.1", name: "list_references", ok: true },
    { type: "text", text: "Four pictures." },
  ];
  const log = chatAnswered(chatAsked(EMPTY_CHAT_LOG, "what have I got"), {
    reply: "Four pictures.",
    attachments: [],
    parts,
  });

  assert.deepEqual(log.messages[1]?.parts, parts);
  assert.deepEqual(stepsOf(log.messages[1]!.parts), [
    { callId: "1.1", name: "list_references", ok: true },
  ]);
});

test("an answer with no parts is the reply and its tiles, as it always was", () => {
  /// The fallback an older server, or a stream that ended early, degrades to.
  const log = chatAnswered(chatAsked(EMPTY_CHAT_LOG, "show me"), {
    reply: "Here it is.",
    attachments: [],
  });
  assert.deepEqual(log.messages[1]?.parts, [{ type: "text", text: "Here it is." }]);
});

/// The reply typing itself out. Nothing here is ever retracted: a round's text
/// is either superseded by the step it was introducing, or by the answer it was.

const delta = (text: string): TurnEvent => ({
  kind: "delta",
  agent: "orchestrator",
  under: [],
  seq: 1,
  text,
});

test("deltas accumulate into the sentence being written", () => {
  const asked = chatAsked(EMPTY_CHAT_LOG, "hello");
  assert.equal(asked.progress?.said, "");

  const said = [delta("Tell me "), delta("about the "), delta("light.")].reduce(chatProgressed, asked);
  assert.equal(said.progress?.said, "Tell me about the light.");
});

test("a round handing over to its tools clears what it was narrating", () => {
  /// Text on a round that turns out to call tools was narration about work that
  /// is now happening — it stays in the row as a bubble, and repeating it above
  /// the step it introduced would be the column saying it twice.
  const narrated = chatProgressed(chatAsked(EMPTY_CHAT_LOG, "go"), delta("Let me look."));
  const calling = chatProgressed(narrated, round([{ callId: "1.1", name: "list_references" }]));

  assert.equal(calling.progress?.said, "");
  assert.deepEqual(calling.progress?.steps, [{ callId: "1.1", name: "list_references" }]);
});

test("a round coming back leaves the next sentence alone", () => {
  const asked = chatProgressed(chatAsked(EMPTY_CHAT_LOG, "go"), round([{ callId: "1.1", name: "add_board" }]));
  const returned = chatProgressed(asked, back([{ callId: "1.1", name: "add_board", ok: true }]));
  const writing = chatProgressed(returned, delta("Filed it."));
  assert.equal(writing.progress?.said, "Filed it.");
});

test("an empty delta costs no re-render", () => {
  const asked = chatAsked(EMPTY_CHAT_LOG, "go");
  assert.equal(chatProgressed(asked, delta("")), asked);
});

test("the answer replaces whatever was being typed", () => {
  const writing = chatProgressed(chatAsked(EMPTY_CHAT_LOG, "go"), delta("Tell me about the "));
  const log = chatAnswered(writing, { reply: "Tell me about the light.", attachments: [] });
  assert.equal(log.progress, null);
  assert.equal(spoken(log.messages[1]!.parts), "Tell me about the light.");
});
