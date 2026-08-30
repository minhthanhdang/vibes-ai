import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RESULT_STORE_LIMIT,
  asHistory,
  forDisplay,
  forRequest,
  forStorage,
  messageSchema,
  stepsOf,
  stepsSaid,
  type Emitted,
  type Message,
  type Part,
} from "./conversation";
import { historyWindow, HISTORY_TURN_LIMIT, HISTORY_TEXT_LIMIT, type ChatTurn } from "../orchestrator/history";
import { toolWindow, TOOL_ROUND_LIMIT } from "./tool-window";
import type { Content, GeneratePart } from "@/server/google/vertex";

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

test("a page part contributes the rebuilt scene parts, never its stored name", () => {
  const { contents } = forRequest(conversation, { turnId: "t4", attached });
  const wire = JSON.stringify(contents);
  assert.ok(wire.includes("gs://renders/cover.png"));
  assert.ok(!wire.includes("Neon-Cover-Page"));
});

test("two page parts spend the rebuilt block once", () => {
  const second = { ...pagePart, pageId: "page-2", name: "Back-Cover" };
  const { contents } = forRequest(
    [message({ id: "u", turnId: "live", role: "user", parts: [pagePart, second, text("compare them")] })],
    { turnId: "live", attached },
  );
  assert.deepEqual(contents, [{ role: "user", parts: [...attached, { text: "compare them" }] }]);
});

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

  assert.equal(JSON.stringify(atLimit.response).length, RESULT_STORE_LIMIT);
  assert.deepEqual(forStorage([atLimit]), [atLimit]);
  assert.deepEqual(forStorage([over]), [
    { ...base, summary: ["cut-1", "r1", "r2"], truncated: true },
  ]);
});

test("a thought summary is sent back on the next round and never stored", () => {
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

const callPartOf = (callId: string, name: string): Part => ({ type: "call", callId, name, args: {} });
const resultPartOf = (callId: string, name: string, ok: boolean): Part => ({
  type: "result",
  callId,
  name,
  ok,
});

test("a settled turn's calls and results read back as one step per call", () => {
  assert.deepEqual(
    stepsOf([
      callPartOf("1.1", "list_references"),
      resultPartOf("1.1", "list_references", true),
      callPartOf("2.1", "compose_board"),
      resultPartOf("2.1", "compose_board", true),
      { type: "text", text: "Here it is." },
    ]),
    [
      { callId: "1.1", name: "list_references", ok: true },
      { callId: "2.1", name: "compose_board", ok: true },
    ],
  );
});

test("a call whose result never landed is a step that never settled", () => {
  assert.deepEqual(stepsOf([callPartOf("1.1", "design_page")]), [
    { callId: "1.1", name: "design_page" },
  ]);
});

test("results are matched by callId, so two calls of one name settle separately", () => {
  assert.deepEqual(
    stepsOf([
      callPartOf("1.1", "crop_reference"),
      callPartOf("1.2", "crop_reference"),
      resultPartOf("1.2", "crop_reference", false),
      resultPartOf("1.1", "crop_reference", true),
    ]),
    [
      { callId: "1.1", name: "crop_reference", ok: true },
      { callId: "1.2", name: "crop_reference", ok: false },
    ],
  );
});

test("a message with no calls has no steps", () => {
  assert.deepEqual(stepsOf([{ type: "text", text: "what have I got" }]), []);
  assert.deepEqual(stepsOf([]), []);
});

test("a result whose call is not in the message is not a step", () => {
  assert.deepEqual(stepsOf([resultPartOf("1.1", "add_board", true)]), []);
});

test("an unknown part between a call and its result changes nothing", () => {
  assert.deepEqual(
    stepsOf([
      callPartOf("1.1", "add_board"),
      { type: "handoff", to: "designer" } as unknown as Part,
      resultPartOf("1.1", "add_board", true),
    ]),
    [{ callId: "1.1", name: "add_board", ok: true }],
  );
});

test("the column still draws no call and no result of its own accord", () => {
  assert.deepEqual(
    forDisplay([
      callPartOf("1.1", "add_board"),
      resultPartOf("1.1", "add_board", true),
      { type: "text", text: "Filed." },
    ]),
    [{ kind: "bubble", text: "Filed." }],
  );
});

test("one turn's tool work says how many steps and how many failed", () => {
  assert.equal(stepsSaid([]), "0 steps");
  assert.equal(stepsSaid([{ callId: "1.1", name: "add_board", ok: true }]), "1 step");
  assert.equal(
    stepsSaid([
      { callId: "1.1", name: "add_board", ok: true },
      { callId: "1.2", name: "crop_reference", ok: false },
    ]),
    "2 steps · 1 failed",
  );
  assert.equal(stepsSaid([{ callId: "1.1", name: "design_page" }]), "1 step");
});

test("adjacent text parts of one emission are one bubble", () => {
  assert.deepEqual(
    forStorage([
      { type: "text", text: "Tell me " },
      { type: "text", text: "about the " },
      { type: "text", text: "light." },
    ]),
    [{ type: "text", text: "Tell me about the light." }],
  );
});

test("a dropped thought between two fragments does not split them", () => {
  assert.deepEqual(
    forStorage([
      { type: "text", text: "Tell me " },
      { type: "text", text: "they want a mood", thought: true },
      { type: "text", text: "about the light." },
    ]),
    [{ type: "text", text: "Tell me about the light." }],
  );
});

test("a call between two runs of text keeps them apart", () => {
  assert.deepEqual(
    forStorage([
      { type: "text", text: "Let me " },
      { type: "text", text: "look." },
      { type: "call", callId: "1.1", name: "list_references", args: {} },
      { type: "result", callId: "1.1", name: "list_references", ok: true, response: { total: 3 } },
      { type: "text", text: "Four " },
      { type: "text", text: "pictures." },
    ]),
    [
      { type: "text", text: "Let me look." },
      { type: "call", callId: "1.1", name: "list_references", args: {} },
      { type: "result", callId: "1.1", name: "list_references", ok: true, response: { total: 3 } },
      { type: "text", text: "Four pictures." },
    ],
  );
});

test("a merged run keeps the first part's other fields and drops its wire", () => {
  const stored = forStorage([
    { type: "text", text: "Tell me ", wire: { text: "Tell me ", thoughtSignature: "opaque" } },
    { type: "text", text: "about the light.", wire: { text: "about the light." } },
  ]);
  assert.deepEqual(stored, [{ type: "text", text: "Tell me about the light." }]);
  assert.equal("wire" in stored[0]!, false);
});

test("a whole emission is stored exactly as it was before streaming existed", () => {
  assert.deepEqual(
    forStorage([
      { type: "call", callId: "1.1", name: "add_board", args: {} },
      { type: "result", callId: "1.1", name: "add_board", ok: true, response: { id: "b1" } },
      { type: "text", text: "Filed." },
    ]),
    [
      { type: "call", callId: "1.1", name: "add_board", args: {} },
      { type: "result", callId: "1.1", name: "add_board", ok: true, response: { id: "b1" } },
      { type: "text", text: "Filed." },
    ],
  );
});
