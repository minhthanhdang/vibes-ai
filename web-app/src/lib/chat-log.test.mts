import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_CHAT_LOG,
  chatAnswered,
  chatAsked,
  chatBoardDiscarded,
  chatCutTaken,
  chatFailed,
  chatHistory,
  chatRetried,
  chatTyped,
  shownAs,
  type ChatLog,
} from "./chat-log";
import {
  attachmentKey,
  attachmentOf,
  cropAttachmentOf,
  type BoardAttachment,
  type ChatAttachment,
} from "./agent-tools";
import type { CropOffer } from "./crop-offer";
import { takenOfferKey, type TakenCut } from "./cut-taken";
import { historyWindow } from "./chat-history";

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

test("a taken cut lands as the director's own turn, drawn as an event", () => {
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

test("an offer the director nudged is still an offer", () => {
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

test("an event note goes up as history like anything else the director said", () => {
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
  assert.equal(settled.gone?.boardId, "board-1");
  /// The tile is still drawn — it is under a reply that was about it — and the
  /// board is still the board; what changed is that there is nowhere to go.
  assert.equal(settled.attachment, OFFERED_BOARD);
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
