import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_CHAT_LOG,
  chatAnswered,
  chatAsked,
  chatBoardDiscarded,
  chatPageDiscarded,
  chatCutTaken,
  chatPagePicked,
  chatPagesListed,
  chatReferenceDiscarded,
  chatFailed,
  chatHistory,
  chatRetried,
  chatTyped,
  shownAs,
  type ChatLog,
} from "@/lib/agent/chat-log";
import {
  attachmentKey,
  attachmentOf,
  cropAttachmentOf,
  type BoardAttachment,
  type ChatAttachment,
} from "@/lib/agent/agent-tools";
import type { CropOffer } from "@/lib/crop/crop-offer";
import { takenOfferKey, type TakenCut } from "@/lib/crop/cut-taken";
import { historyWindow } from "@/lib/agent/chat-history";

const OFFER: CropOffer = {
  referenceId: "frame-1",
  region: { x: 0.2, y: 0.1, width: 0.7, height: 0.5 },
  cropBox: [100, 200, 600, 900],
  editIntent: "the doorway alone",
  editRationale: "the doorway is the shot",
  aspect: "2.39:1",
};

const TAKEN: TakenCut = {
  referenceId: "cut-1",
  frameId: "frame-1",
  title: "Hall doorway (crop 2)",
  keeps: "the doorway alone",
  aspect: "2.39:1",
  thumbUrl: "/api/references/cut-1/image?variant=thumb",
  cropBox: [100, 200, 600, 900],
};

function picture(id: string): ChatAttachment {
  return attachmentOf({ id, title: id, thumbUrl: `/${id}` });
}

test("an ask trims the message, marks the turn in flight and clears the last error", () => {
  const failed = chatFailed(EMPTY_CHAT_LOG, "the model was unreachable");
  const log = chatAsked(failed, "  lay that out as a grid  ");

  assert.deepEqual(log.messages, [{ role: "user", text: "lay that out as a grid" }]);
  assert.equal(log.asking, true);
  assert.equal(log.error, null);
});

test("a half-written message is kept, and emptied by the ask that sends it", () => {
  const typed = chatTyped(EMPTY_CHAT_LOG, "low-key light, deep");
  assert.equal(typed.draft, "low-key light, deep");

  /// The box is cleared because the message left — one transition, so the two
  /// cannot disagree about whether it was sent.
  assert.equal(chatAsked(typed, typed.draft).draft, "");
});

test("an answer keeps its attachments on the same message and ends the flight", () => {
  const shown = [picture("ref-1")];
  const log = chatAnswered(chatAsked(EMPTY_CHAT_LOG, "show me the hall"), {
    reply: "Here it is.",
    attachments: shown,
  });

  assert.equal(log.messages.length, 2);
  assert.deepEqual(log.messages[1], {
    role: "model",
    text: "Here it is.",
    attachments: shown,
  });
  assert.equal(log.asking, false);
});

test("a failed turn keeps the question, marks it unsent and stops the flight", () => {
  const log = chatFailed(chatAsked(EMPTY_CHAT_LOG, "compose a board"), "Too many requests");

  /// The question stays: dropping it would leave the error standing under
  /// whatever was said before it. Marked, because the box it was typed in has
  /// already been emptied and the model never saw a word of it.
  assert.deepEqual(log.messages, [
    { role: "user", text: "compose a board", kind: "failed" as const },
  ]);
  assert.equal(log.asking, false);
  assert.equal(log.error, "Too many requests");
});

test("a message the model never saw does not go up as history", () => {
  const answered = chatAnswered(chatAsked(EMPTY_CHAT_LOG, "what have I got"), {
    reply: "Two photographs.",
    attachments: [],
  });
  const log = chatFailed(chatAsked(answered, "compose a board"), "Too many requests");

  const window = chatHistory(log);
  assert.deepEqual(
    window.map((turn) => turn.text),
    ["what have I got", "Two photographs."],
  );
});

test("the failure marks the question rather than whatever is at the bottom", () => {
  /// A cut taken in the properties panel lands as an event while the turn is in
  /// flight, so the question that failed is not the last message in the column.
  const asked = chatAsked(EMPTY_CHAT_LOG, "crop the doorway");
  const log = chatFailed(chatCutTaken(asked, TAKEN), "Too many requests");

  assert.equal(log.messages[0]?.kind, "failed");
  assert.equal(log.messages[1]?.kind, "event");
  /// And the event is still history — it happened, whatever the turn did.
  assert.equal(chatHistory(log).length, 1);
});

test("a failure after an answered turn marks nothing", () => {
  const answered = chatAnswered(chatAsked(EMPTY_CHAT_LOG, "what have I got"), {
    reply: "Two photographs.",
    attachments: [],
  });
  const log = chatFailed(answered, "Too many requests");

  assert.equal(log.messages.some((message) => message.kind === "failed"), false);
  assert.equal(log.error, "Too many requests");
});

test("sending a failed message again drops it, so the column shows it once", () => {
  const failed = chatFailed(chatAsked(EMPTY_CHAT_LOG, "compose a board"), "Too many requests");
  const retried = chatRetried(failed, 0);

  assert.deepEqual(retried.messages, []);
  assert.equal(retried.error, null);
  /// And the ask that follows puts it back as the question it is.
  assert.deepEqual(chatAsked(retried, "compose a board").messages, [
    { role: "user", text: "compose a board" },
  ]);
});

test("only a failed message can be sent again", () => {
  const asked = chatAsked(EMPTY_CHAT_LOG, "compose a board");

  assert.equal(chatRetried(asked, 0), asked);
  assert.equal(chatRetried(asked, 4), asked);
});

test("a taken cut lands as the user's own turn, drawn as an event", () => {
  const log = chatCutTaken(EMPTY_CHAT_LOG, TAKEN);
  const message = log.messages[0]!;

  assert.equal(message.role, "user");
  assert.equal(message.kind, "event");
  assert.match(message.text, /cut-1/);
  /// The cut itself under the note, as a reference the click opens the frame at.
  assert.equal(message.attachments?.length, 1);
  assert.equal(message.attachments?.[0]?.kind, "reference");
});

test("a cut made for a board carries the board beside it", () => {
  const board: BoardAttachment = {
    kind: "board",
    boardId: "board-1",
    title: "Ridge study",
    caption: "2 photographs · Split",
    thumbUrl: null,
    preview: null,
    lines: [],
    linesOver: 0,
    images: 2,
  };
  const log = chatCutTaken(EMPTY_CHAT_LOG, { ...TAKEN, board });

  assert.deepEqual(log.messages[0]?.attachments?.[1], board);
});

test("a taken cut settles the offer its own tile is drawn under", () => {
  const offered = cropAttachmentOf({ id: "frame-1", thumbUrl: "/f" }, OFFER);
  const log = chatCutTaken(EMPTY_CHAT_LOG, TAKEN);

  const settled = shownAs(log, offered);
  assert.equal(settled.filed, TAKEN);
  /// It stops being an offer: the tile becomes the cut, so the click goes to the
  /// filed row rather than back to the review that would file it again.
  assert.equal(settled.attachment.kind, "reference");
  assert.equal(settled.attachment.kind === "reference" && settled.attachment.referenceId, "cut-1");
});

test("an offer the user nudged is still an offer", () => {
  const nudged = cropAttachmentOf(
    { id: "frame-1", thumbUrl: "/f" },
    { ...OFFER, cropBox: [110, 200, 600, 900] },
  );
  const log = chatCutTaken(EMPTY_CHAT_LOG, TAKEN);

  const settled = shownAs(log, nudged);
  assert.equal(settled.filed, undefined);
  assert.equal(settled.attachment, nudged);
  /// The box on that tile is not the box that was filed, so its key is not the
  /// key the taking settled.
  assert.notEqual(attachmentKey(nudged), takenOfferKey(TAKEN));
});

test("anything that is not a crop is drawn as itself", () => {
  const shown = picture("ref-1");
  const settled = shownAs(chatCutTaken(EMPTY_CHAT_LOG, TAKEN), shown);

  assert.equal(settled.attachment, shown);
  assert.equal(settled.filed, undefined);
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

  const window = historyWindow(log.messages);
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
  assert.equal(note.kind, "event");
  assert.match(note.text, /Act two/);
  /// No attachment: the one thing this message is about is the one thing in the
  /// project that is not there any more.
  assert.equal(note.attachments, undefined);

  const settled = shownAs(log, OFFERED_BOARD);
  assert.equal(settled.gone && "boardId" in settled.gone ? settled.gone.boardId : null, "board-1");
  /// The tile is still drawn — it is under a reply that was about it — and the
  /// board is still the board; what changed is that there is nowhere to go.
  assert.equal(settled.attachment, OFFERED_BOARD);
});

/// tech-spec §V: a page going leaves the board standing, so the tile it settles
/// cannot be keyed by the board — every later tile of that board would be behind
/// the same mark — and the note has to say the boardId is still good.
test("a discarded page settles its own tile and tells the conversation the board is still there", () => {
  const offered: BoardAttachment = {
    ...OFFERED_BOARD,
    discardPage: { pageId: "page-2", name: "Act two" },
  };
  const answered = chatAnswered(chatAsked(EMPTY_CHAT_LOG, "lose the second page"), {
    reply: "Here is that page — discard it and the rest stays.",
    attachments: [offered],
  });
  const log = chatPageDiscarded(answered, {
    boardId: "board-1",
    pageId: "page-2",
    boardTitle: "Cold open",
    title: "Act two",
    pictures: 3,
    pagesLeft: 1,
  });

  const note = log.messages.at(-1)!;
  assert.equal(note.role, "user");
  assert.equal(note.kind, "event");
  assert.match(note.text, /“Act two” \(page-2\)/);
  assert.match(note.text, /board itself is still there and board-1 still works/);
  assert.match(note.text, /down to one page/);
  assert.match(note.text, /3 photographs that were on it are still in the gallery/);

  const settled = shownAs(log, offered).gone;
  assert.equal(settled && "pageId" in settled ? settled.pageId : null, "page-2");
  /// The board's own tile in the same reply is untouched: the board is still a
  /// way in, and it is a different rectangle now rather than a dead one.
  assert.equal(shownAs(log, OFFERED_BOARD).gone, undefined);
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

  assert.equal(shownAs(log, offered).gone?.title, "Act two");
});

test("the board's only page going says the board has none left rather than that it went", () => {
  const log = chatPageDiscarded(EMPTY_CHAT_LOG, {
    boardId: "board-1",
    pageId: "page-1",
    boardTitle: "Cold open",
    title: "",
    pictures: 0,
    pagesLeft: 0,
  });

  const note = log.messages.at(-1)!.text;
  assert.match(note, /I took a page \(page-1\)/);
  assert.match(note, /no page on it at all/);
  assert.match(note, /add_page/);
  assert.doesNotMatch(note, /gallery/);
});

test("another board in the same reply is untouched by a discard", () => {
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

  assert.equal(shownAs(log, other).gone, undefined);
  assert.equal(shownAs(log, OFFERED_BOARD).gone?.title, "Act two");
  /// And nothing that is not a board is ever settled by one.
  assert.equal(shownAs(log, picture("ref-1")).gone, undefined);
});

test("the discard rides up as history, so the next message is not answered from a board that is gone", () => {
  const log = chatBoardDiscarded(
    chatAnswered(chatAsked(EMPTY_CHAT_LOG, "bin act two"), {
      reply: "Here it is.",
      attachments: [OFFERED_BOARD],
    }),
    { boardId: "board-1", title: "Act two", pictures: 6 },
  );

  const window = historyWindow(log.messages);
  assert.equal(window.at(-1)?.role, "user");
  assert.match(window.at(-1)!.text, /board-1/);
});

/// The picture half of the same settling. It matters more here than for a board,
/// because the failure it prevents is quieter: the tab row at least opens *a*
/// board for an id it does not hold, while `inspectReference` on a picture the
/// gallery no longer lists moves nothing at all.
test("a removed picture becomes a note and a tile that is no longer a way in", () => {
  const offered = attachmentOf(
    { id: "ref-1", title: "Ridge study", thumbUrl: "/ref-1" },
    { cuts: 2, boards: [{ id: "board-7", title: "Act one" }] },
  );
  const answered = chatAnswered(chatAsked(EMPTY_CHAT_LOG, "bin the ridge study"), {
    reply: "Here it is — remove it and it is gone.",
    attachments: [offered],
  });

  const log = chatReferenceDiscarded(answered, {
    referenceId: "ref-1",
    title: "Ridge study",
    cuts: 2,
    boards: [{ id: "board-7", title: "Act one" }],
  });

  const note = log.messages.at(-1)!;
  assert.equal(note.role, "user");
  assert.equal(note.kind, "event");
  assert.match(note.text, /Ridge study/);
  assert.match(note.text, /2 cuts made of it/);
  assert.equal(note.attachments, undefined);

  const settled = shownAs(log, offered);
  assert.equal(settled.gone?.title, "Ridge study");
  assert.equal(settled.attachment, offered);
  /// And the note goes up as the user's own turn, so the next message is
  /// answered by a model that knows the id is dead.
  assert.equal(chatHistory(log).at(-1)?.role, "user");
});

test("another picture in the same reply is untouched, and a board is never settled by a picture", () => {
  const log = chatReferenceDiscarded(EMPTY_CHAT_LOG, {
    referenceId: "ref-1",
    title: "Ridge study",
  });

  assert.equal(shownAs(log, picture("ref-2")).gone, undefined);
  assert.equal(shownAs(log, picture("ref-1")).gone?.title, "Ridge study");
  assert.equal(shownAs(log, OFFERED_BOARD).gone, undefined);
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

  assert.deepEqual(log.messages.at(-1)?.pages, [PAGE]);
  /// Per-message, not sticky: the next question is about a page only if the
  /// user says so again.
  assert.deepEqual(log.attached, []);
});

test("a message sent with nothing attached carries no pages at all", () => {
  assert.equal(chatAsked(EMPTY_CHAT_LOG, "what have I got").messages.at(-1)?.pages, undefined);
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
