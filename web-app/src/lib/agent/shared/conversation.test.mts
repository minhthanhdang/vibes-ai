import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RESULT_STORE_LIMIT,
  asHistory,
  forDisplay,
  forRequest,
  forStorage,
  messageSchema,
  type Emitted,
  type Message,
  type Part,
} from "./conversation";
import { historyWindow, HISTORY_TURN_LIMIT, HISTORY_TEXT_LIMIT, type ChatTurn } from "../orchestrator/history";
import { toolWindow, TOOL_ROUND_LIMIT } from "./tool-window";
import type { Content, GeneratePart } from "@/server/google/vertex";

/// The pinning tests for the one conversation format. What is asserted here is
/// that the two projections say exactly what the three shapes they replace said:
/// `forRequest` against the `Content[]` the loop builds today — assembled below
/// through the same `historyWindow` and `toolWindow` the loop uses, so the
/// expectation *is* the current code — and `forDisplay` against the table's
/// rendering column.

const message = (
  over: Partial<Message> & Pick<Message, "turnId" | "role" | "parts">,
): Message => ({
  id: "m",
  seq: 0,
  status: "sent",
  at: "2026-08-21T00:00:00.000Z",
  ...over,
});

const text = (words: string): Message["parts"][number] => ({ type: "text", text: words });

const call = (referenceId: string): Message["parts"][number] => ({
  type: "call",
  callId: `call-${referenceId}`,
  name: "crop_reference",
  args: { referenceId },
});

const result = (referenceId: string, cut: string): Message["parts"][number] => ({
  type: "result",
  callId: `call-${referenceId}`,
  name: "crop_reference",
  ok: true,
  response: { referenceId: cut },
});

/// A round as the loop pushes it: the model content carrying the call, the user
/// content carrying the answer.
const wireRound = (referenceId: string, cut: string): Content[] => [
  { role: "model", parts: [{ functionCall: { name: "crop_reference", args: { referenceId } } }] },
  { role: "user", parts: [{ functionResponse: { name: "crop_reference", response: { referenceId: cut } } }] },
];

const attached: GeneratePart[] = [
  { fileData: { fileUri: "gs://renders/cover.png", mimeType: "image/png" } },
  { text: 'Attached: page 1 of board "Lookbook".' },
];

const pagePart: Message["parts"][number] = {
  type: "page",
  boardId: "board-1",
  pageId: "page-1",
  revision: 3,
  name: "Neon-Cover-Page",
};

/// The conversation the rest of these tests slice: two answered exchanges, an
/// event, a failed ask, then a live turn with an attached page and two rounds.
const conversation: Message[] = [
  message({ id: "u1", turnId: "t1", role: "user", parts: [text("make me a moodboard of the earrings")] }),
  message({ id: "a1", turnId: "t1", role: "assistant", parts: [text("Here is the board.")] }),
  message({
    id: "e1",
    turnId: "t2",
    role: "user",
    parts: [{ type: "event", event: "board_discarded", note: 'I removed the board "Earrings".', payload: { boardId: "b1" } }],
  }),
  message({ id: "f1", turnId: "t3", role: "user", status: "failed", parts: [text("crop everything")] }),
  message({
    id: "u2",
    turnId: "t4",
    role: "user",
    status: "pending",
    parts: [pagePart, text("crop them all to squares")],
  }),
  message({
    id: "a2",
    turnId: "t4",
    role: "assistant",
    status: "pending",
    parts: [call("r1"), result("r1", "cut-1"), call("r2"), result("r2", "cut-2")],
  }),
];

/// What today's client posts for that conversation — the failed ask already
/// filtered out, an event riding as the user's words — and what today's loop
/// assembles from it. Built through the same two windows the loop uses, so this
/// expectation moves only if the current behaviour does.
const asToday = (history: ChatTurn[], user: Content, rounds: Content[]) =>
  toolWindow([
    ...historyWindow(history).map(({ role, text }) => ({ role, parts: [{ text }] })),
    user,
    ...rounds,
  ]);

test("forRequest builds the Content[] the loop builds today, down to part order and role", () => {
  const expected = asToday(
    [
      { role: "user", text: "make me a moodboard of the earrings" },
      { role: "model", text: "Here is the board." },
      { role: "user", text: 'I removed the board "Earrings".' },
    ],
    { role: "user", parts: [...attached, { text: "crop them all to squares" }] },
    [...wireRound("r1", "cut-1"), ...wireRound("r2", "cut-2")],
  );

  assert.deepEqual(forRequest(conversation, { turnId: "t4", attached }), expected);
});

/// Every bound and its behaviour, unchanged: the turn count, the per-message
/// cut, the round count, the said-out-loud mark where rounds were dropped.
test("both windows cut where they cut today, at the bounds and over them", () => {
  const chatter = Array.from({ length: HISTORY_TURN_LIMIT + 4 }, (_, at) =>
    message({
      id: `p${at}`,
      turnId: `p${at}`,
      role: at % 2 ? "assistant" : "user",
      parts: [text(at === 5 ? "long ".repeat(HISTORY_TEXT_LIMIT) : `message ${at}`)],
    }),
  );
  const rounds = Array.from({ length: TOOL_ROUND_LIMIT + 3 }, (_, at) => at + 1);
  const stored = [
    ...chatter,
    message({ id: "u", turnId: "live", role: "user", parts: [text("crop them all")] }),
    message({
      id: "a",
      turnId: "live",
      role: "assistant",
      parts: rounds.flatMap((at) => [call(`r${at}`), result(`r${at}`, `cut-${at}`)]),
    }),
  ];

  const expected = asToday(
    chatter.map((past, at) => ({
      role: at % 2 ? ("model" as const) : ("user" as const),
      text: at === 5 ? "long ".repeat(HISTORY_TEXT_LIMIT) : `message ${at}`,
    })),
    { role: "user", parts: [{ text: "crop them all" }] },
    rounds.flatMap((at) => wireRound(`r${at}`, `cut-${at}`)),
  );

  assert.equal(expected.dropped, 3);
  assert.deepEqual(forRequest(stored, { turnId: "live" }), expected);
});

test("a failed message is not history", () => {
  const { contents } = forRequest(conversation, { turnId: "t4", attached });
  assert.ok(!JSON.stringify(contents).includes("crop everything"));
});

/// Rule 1 of the request: past turns carry what was said and nothing else. The
/// calls stay behind because a turn that re-sent every previous turn's rounds
/// would grow without bound, the attachments because the model would read its
/// own work as new evidence, the page because its scene belonged to its turn.
test("a past turn's calls, results, attachments and pages stay behind", () => {
  const settled: Message[] = [
    message({ id: "u1", turnId: "t1", role: "user", parts: [pagePart, text("show me the earrings")] }),
    message({
      id: "a1",
      turnId: "t1",
      role: "assistant",
      parts: [
        call("r1"),
        result("r1", "cut-1"),
        text("Two of them, cropped."),
        {
          type: "attachment",
          attachment: { kind: "reference", referenceId: "cut-1", frameId: "r1", title: "Cut", caption: "1:1", thumbUrl: "/api/references/cut-1/image" },
        },
      ],
    }),
    message({ id: "u2", turnId: "t2", role: "user", status: "pending", parts: [text("now a board")] }),
  ];

  assert.deepEqual(forRequest(settled, { turnId: "t2" }).contents, [
    { role: "user", parts: [{ text: "show me the earrings" }] },
    { role: "model", parts: [{ text: "Two of them, cropped." }] },
    { role: "user", parts: [{ text: "now a board" }] },
  ]);
});

/// The re-roling rule, from both sides: adjacent parts of one wire role share a
/// content, and only `result` flips to `user` — so parallel calls stay one
/// emission and interleaved rounds stay distinguishable from one.
test("interleaved rounds serialize to four contents, parallel calls to two", () => {
  const turnOf = (parts: Message["parts"]) => [
    message({ id: "u", turnId: "live", role: "user", parts: [text("go")] }),
    message({ id: "a", turnId: "live", role: "assistant", parts }),
  ];

  const interleaved = forRequest(turnOf([call("r1"), result("r1", "c1"), call("r2"), result("r2", "c2")]), {
    turnId: "live",
  }).contents;
  assert.deepEqual(interleaved.slice(1).map(({ role }) => role), ["model", "user", "model", "user"]);

  const parallel = forRequest(turnOf([call("r1"), call("r2"), result("r1", "c1"), result("r2", "c2")]), {
    turnId: "live",
  }).contents;
  assert.deepEqual(parallel.slice(1).map(({ role, parts }) => [role, parts.length]), [
    ["model", 2],
    ["user", 2],
  ]);
});

/// `asHistory` is `orchestrator.send`'s read of the stored conversation, now
/// that the browser posts no history — the same window, so an answer that put
/// tiles in the column without saying a word is not a blank turn the model has
/// to read as a speaker who said nothing.
test("an answer that was only tiles is not a blank turn in history", () => {
  assert.deepEqual(
    asHistory([
      message({ id: "u1", turnId: "t1", role: "user", parts: [text("what have I got")] }),
      message({
        id: "a1",
        turnId: "t1",
        role: "assistant",
        parts: [
          {
            type: "attachment",
            attachment: { kind: "reference", referenceId: "cut-1", frameId: "r1", title: "Cut", caption: "1:1", thumbUrl: "/api/references/cut-1/image" },
          },
        ],
      }),
    ]),
    [{ role: "user", text: "what have I got" }],
  );
});

test("an attachment part never appears in a request", () => {
  const { contents } = forRequest(conversation, { turnId: "t4", attached });
  assert.ok(!JSON.stringify(contents).includes("attachment"));
});

/// A page part is a pointer. What rides is the scene the caller rebuilt, in the
/// place the pointer stands; the stored name is for the chip under the bubble
/// and a model that read it would be reading the user's description of their
/// own page.
test("a page part contributes the rebuilt scene parts, never its stored name", () => {
  const { contents } = forRequest(conversation, { turnId: "t4", attached });
  const wire = JSON.stringify(contents);
  assert.ok(wire.includes("gs://renders/cover.png"));
  assert.ok(!wire.includes("Neon-Cover-Page"));
});

/// The rebuilt block is one block in pick order — the one thing the rebuild
/// does not say per page — so however many page parts point at it, it rides
/// exactly once, where the first pointer stands.
test("two page parts spend the rebuilt block once", () => {
  const second = { ...pagePart, pageId: "page-2", name: "Back-Cover" };
  const { contents } = forRequest(
    [message({ id: "u", turnId: "live", role: "user", parts: [pagePart, second, text("compare them")] })],
    { turnId: "live", attached },
  );
  assert.deepEqual(contents, [{ role: "user", parts: [...attached, { text: "compare them" }] }]);
});

/// The read-never-rejects rule. A part from a newer build — or a known type
/// missing a field — loads verbatim, draws as nothing and is left out of the
/// request, so yesterday's conversation stays openable under tomorrow's build.
test("an unknown part type loads, draws nothing, and is not sent", () => {
  const row = {
    id: "a9",
    seq: 9,
    turnId: "t9",
    role: "assistant",
    status: "sent",
    at: "2026-08-21T00:00:00.000Z",
    parts: [
      { type: "sticker", url: "gs://stickers/yay.png" },
      { type: "text" },
      { type: "text", text: "still here" },
    ],
  };
  const loaded = messageSchema.parse(row);
  assert.deepEqual(loaded.parts, row.parts);

  assert.deepEqual(forDisplay(loaded.parts), [{ kind: "bubble", text: "still here" }]);
  assert.deepEqual(
    forRequest(
      [message({ id: "u", turnId: "t9", role: "user", parts: [text("hi")] }), loaded],
      { turnId: "t9" },
    ).contents,
    [
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ text: "still here" }] },
    ],
  );
});

test("the column draws what the table says: bubbles, notes, chips and tiles — never calls", () => {
  const tile = {
    kind: "board" as const,
    boardId: "b1",
    title: "Lookbook",
    caption: "4 images",
    thumbUrl: null,
    preview: null,
    lines: [],
    linesOver: 0,
    images: 4,
  };
  assert.deepEqual(
    forDisplay([
      text("here"),
      { type: "event", event: "cut_taken", note: "I took a cut.", payload: {} },
      pagePart,
      call("r1"),
      result("r1", "c1"),
      { type: "attachment", attachment: tile },
    ]),
    [
      { kind: "bubble", text: "here" },
      { kind: "note", text: "I took a cut." },
      { kind: "chip", boardId: "board-1", pageId: "page-1", name: "Neon-Cover-Page" },
      { kind: "tile", attachment: tile },
    ],
  );
});

test("a stored message with every known part round-trips through the schema", () => {
  const stored = message({
    id: "a1",
    seq: 4,
    turnId: "t1",
    role: "assistant",
    parts: [
      text("done"),
      { type: "event", event: "page_discarded", note: "I removed a page.", payload: { pageId: "p1" } },
      pagePart,
      call("r1"),
      { type: "result", callId: "call-r9", name: "crop_reference", ok: false, summary: ["cut-9"], truncated: true },
      {
        type: "attachment",
        attachment: { kind: "reference", referenceId: "r1", frameId: null, title: "Hoops", caption: "photo", thumbUrl: "/api/references/r1/image" },
      },
    ],
  });
  assert.deepEqual(messageSchema.parse(JSON.parse(JSON.stringify(stored))), stored);
});

test("forStorage strips the wire and drops the text that only carried one", () => {
  const emitted: Emitted[] = [
    { type: "text", text: "Let me look.", wire: { text: "Let me look." } },
    /// The carrier: a raw part that was neither text nor call, recorded by the
    /// loop as an empty text part so its `wire` rides the round. Nothing was
    /// said, so nothing is stored — a row keeping it would draw an empty bubble.
    { type: "text", text: "", wire: { fileData: { fileUri: "gs://x", mimeType: "image/png" } } },
    { ...(call("r1") as Extract<Part, { type: "call" }>), wire: { functionCall: { name: "crop_reference", args: { referenceId: "r1" } } } },
    result("r1", "cut-1") as Emitted,
  ];

  assert.deepEqual(forStorage(emitted), [
    { type: "text", text: "Let me look." },
    call("r1"),
    result("r1", "cut-1"),
  ]);
});

test("a result past RESULT_STORE_LIMIT stores the ids it filed, not the answer", () => {
  const base = { type: "result" as const, callId: "call-r1", name: "crop_reference", ok: true };
  const atLimit = {
    ...base,
    response: {
      referenceId: "cut-1",
      nudgeOf: "x".repeat(
        RESULT_STORE_LIMIT - JSON.stringify({ referenceId: "cut-1", nudgeOf: "" }).length,
      ),
    },
  };
  const over = { ...base, response: { ...atLimit.response, sourceIds: ["r1", "r2"] } };

  /// At the cap exactly, the answer is still whole — the boundary is "too big
  /// to store", not "as big as may be stored".
  assert.equal(JSON.stringify(atLimit.response).length, RESULT_STORE_LIMIT);
  assert.deepEqual(forStorage([atLimit]), [atLimit]);
  /// Past it, what survives is `idsIn`'s reading — the ids, not the sentence at
  /// `nudgeOf` — plus the mark that there was more.
  assert.deepEqual(forStorage([over]), [
    { ...base, summary: ["cut-1", "r1", "r2"], truncated: true },
  ]);
});

test("a thought summary is sent back on the next round and never stored", () => {
  /// The two halves of stage 5.4. The API rejects a later round of the same
  /// turn for dropping the signature the summary arrived with, so the request
  /// carries the part exactly as it came; the row must not keep it, because a
  /// stored `text` part is a bubble in the user's chat column.
  const thinking: Emitted = {
    type: "text",
    text: "The lower third is empty, so a wide shot goes there.",
    thought: true,
    wire: { text: "The lower third is empty…", thought: true, thoughtSignature: "opaque" },
  };
  const said: Emitted = { type: "text", text: "Done.", wire: { text: "Done." } };

  assert.deepEqual(forStorage([thinking, said]), [{ type: "text", text: "Done." }]);

  const { contents } = forRequest(
    [message({ turnId: "t1", role: "assistant", parts: [thinking, said] })],
    { turnId: "t1" },
  );
  assert.deepEqual(contents, [
    {
      role: "model",
      parts: [
        { text: "The lower third is empty…", thought: true, thoughtSignature: "opaque" },
        { text: "Done." },
      ],
    },
  ]);
});
