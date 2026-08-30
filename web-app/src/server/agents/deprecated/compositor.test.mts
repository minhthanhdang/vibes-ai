import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CompositorError,
  assignmentsOf,
  blockBrief,
  composeMoodboard,
  pageBrief,
  type BlockBrief,
} from "./compositor";
import { MOODBOARD_LAYOUTS } from "@/lib/layout/moodboard-layouts";
import type { Content, GenerateConfig } from "@/server/google/vertex";

test("assignments are read out of the model's answer, malformed entries dropped", () => {
  assert.deepEqual(
    assignmentsOf([
      { blockId: "ref-a", slotId: "img-1" },
      { blockId: " ref-b ", slotId: " img-2 " },
      { blockId: "ref-c" },
      { slotId: "img-4" },
      { blockId: "", slotId: "img-5" },
      { blockId: "ref-d", slotId: 6 },
      "img-7",
      null,
    ]),
    [
      { blockId: "ref-a", slotId: "img-1" },
      { blockId: "ref-b", slotId: "img-2" },
    ],
  );
});

test("an answer that is not a list of pairs is no assignment at all", () => {
  assert.deepEqual(assignmentsOf(undefined), []);
  assert.deepEqual(assignmentsOf("img-1"), []);
  assert.deepEqual(assignmentsOf({ blockId: "ref-a", slotId: "img-1" }), []);
});

test("a block brief carries only what it has", () => {
  assert.deepEqual(blockBrief({ id: "ref-a", kind: "image" }), { id: "ref-a", kind: "image" });

  assert.deepEqual(
    blockBrief({ id: "ref-a", kind: "image", shape: "16:9", keeps: "the hands", tags: ["warm"] }),
    { id: "ref-a", kind: "image", shape: "16:9", keeps: "the hands", tags: ["warm"] },
  );

  assert.deepEqual(blockBrief({ id: "ref-a", kind: "image", tags: [] }), {
    id: "ref-a",
    kind: "image",
  });
});

test("only a text block carries its words", () => {
  assert.deepEqual(blockBrief({ id: "note", kind: "text", text: "act two" }), {
    id: "note",
    kind: "text",
    text: "act two",
  });
  assert.deepEqual(blockBrief({ id: "ref-a", kind: "image", text: "act two" }), {
    id: "ref-a",
    kind: "image",
  });
});

test("a page brief names the page and where it falls in the board", () => {
  assert.deepEqual(pageBrief({ name: "Act two", ordinal: 2, of: 3, board: "Cold open" }), {
    name: "Act two",
    page: "2 of 3",
    board: "Cold open",
  });
});

test("an unnamed page is a numbering and nothing else", () => {
  assert.deepEqual(pageBrief({ name: "  ", ordinal: 1, of: 2 }), { page: "1 of 2" });
  assert.deepEqual(pageBrief({ ordinal: 1, of: 2, board: "   " }), { page: "1 of 2" });
});

test("a page of its own is marked fresh", () => {
  assert.deepEqual(pageBrief({ name: "Page 3", ordinal: 3, of: 3, fresh: true }), {
    name: "Page 3",
    page: "3 of 3",
    fresh: true,
  });
  assert.equal("fresh" in pageBrief({ name: "Page 3", ordinal: 3, of: 3, fresh: false }), false);
});

const LAYOUT = MOODBOARD_LAYOUTS[0]!;

const BLOCKS: BlockBrief[] = [
  { id: "ref-a", kind: "image", shape: "landscape" },
  { id: "ref-b", kind: "image", shape: "portrait", favorite: true },
];

const USAGE = { promptTokenCount: 940, candidatesTokenCount: 120, totalTokenCount: 1060 };

type Asked = { models: string[]; contents: Content[][]; configs: (GenerateConfig | undefined)[] };

function answering(text: string) {
  const asked: Asked = { models: [], contents: [], configs: [] };
  const generate = async (model: string, contents: Content[], config?: GenerateConfig) => {
    asked.models.push(model);
    asked.contents.push(contents);
    asked.configs.push(config);
    return { candidates: [{ content: { parts: [{ text }] } }], usageMetadata: USAGE };
  };
  return { asked, generate };
}

const placed = (...pairs: { blockId: string; slotId: string }[]) =>
  JSON.stringify({ assignments: pairs, note: "  the sunflowers lead, the field sits beside them  " });

const compose = (generate: unknown, extra: Partial<Parameters<typeof composeMoodboard>[0]> = {}) =>
  composeMoodboard({
    layout: LAYOUT,
    blocks: BLOCKS,
    intention: "something warm",
    generate: generate as never,
    ...extra,
  });

test("the assignment is asked of flash, as one text turn holding the layout, the blocks and the brief", async () => {
  const { asked, generate } = answering(placed({ blockId: "ref-a", slotId: LAYOUT.slots[0]!.id }));

  await compose(generate);

  assert.equal(asked.models.length, 1);
  assert.equal(asked.models[0], "gemini-3.7-flash");
  const [turn, ...rest] = asked.contents[0]!;
  assert.deepEqual(rest, []);
  assert.equal(turn!.role, "user");
  assert.equal(turn!.parts.length, 1, "the cheapest agent in the pipeline sends no image parts");
  const said = turn!.parts[0]!.text!;
  assert.match(said, new RegExp(`Layout: .*"layout":"${LAYOUT.id}"`));
  assert.match(said, /Blocks: .*ref-b/);
  assert.match(said, /The user is after: something warm/);
});

test("no brief is said as no brief", async () => {
  const { asked, generate } = answering(placed({ blockId: "ref-a", slotId: LAYOUT.slots[0]!.id }));
  await compose(generate, { intention: "   " });
  assert.match(asked.contents[0]![0]!.parts[0]!.text!, /gave no brief — compose on the tags alone/);
});

test("what is already on the board and which page this is are both in the request", async () => {
  const { asked, generate } = answering(placed({ blockId: "ref-a", slotId: LAYOUT.slots[1]!.id }));

  await compose(generate, {
    inPlace: [{ id: "ref-z", kind: "image", slotId: LAYOUT.slots[0]!.id }],
    page: pageBrief({ name: "Dusk", ordinal: 2, of: 3 }),
  });

  const said = asked.contents[0]![0]!.parts[0]!.text!;
  assert.match(said, /Already on the board and staying where they are: .*ref-z/);
  assert.match(said, /Page: .*"page":"2 of 3"/);
  assert.match(said, /Blocks to place in the free slots:/);
});

test("an ordinary compose says neither, and says Blocks plainly", async () => {
  const { asked, generate } = answering(placed({ blockId: "ref-a", slotId: LAYOUT.slots[0]!.id }));
  await compose(generate);
  const said = asked.contents[0]![0]!.parts[0]!.text!;
  assert.doesNotMatch(said, /Page:/);
  assert.doesNotMatch(said, /Already on the board/);
  assert.match(said, /\nBlocks: /);
});

test("the assignment is asked for as JSON at a temperature two runs can agree on", async () => {
  const { asked, generate } = answering(placed({ blockId: "ref-a", slotId: LAYOUT.slots[0]!.id }));
  await compose(generate);

  const config = asked.configs[0]!;
  assert.equal(config.temperature, 0.2);
  assert.equal(config.responseMimeType, "application/json");
  assert.deepEqual((config.responseSchema as { required: string[] }).required, ["assignments", "note"]);
  assert.match(String(config.systemInstruction), /moodboard compositor/);
});

test("the pairs come back read, the note trimmed, and the tokens off the call", async () => {
  const { generate } = answering(
    placed({ blockId: "ref-a", slotId: LAYOUT.slots[0]!.id }, { blockId: "ref-b", slotId: 7 } as never),
  );

  const answer = await compose(generate);

  assert.equal(answer.model, "gemini-3.7-flash");
  assert.deepEqual(answer.assignments, [{ blockId: "ref-a", slotId: LAYOUT.slots[0]!.id }]);
  assert.equal(answer.note, "the sunflowers lead, the field sits beside them");
  assert.deepEqual(answer.usage, { promptTokens: 940, outputTokens: 120, totalTokens: 1060 });
});

test("an answer split across parts is read whole", async () => {
  const whole = placed({ blockId: "ref-a", slotId: LAYOUT.slots[0]!.id });
  const generate = async () => ({
    candidates: [{ content: { parts: [{ text: whole.slice(0, 15) }, { text: whole.slice(15) }] } }],
    usageMetadata: USAGE,
  });

  const answer = await compose(generate);
  assert.deepEqual(answer.assignments, [{ blockId: "ref-a", slotId: LAYOUT.slots[0]!.id }]);
});

test("an answer that placed nothing is a refusal, not an empty board", async () => {
  await assert.rejects(compose(answering(placed()).generate), CompositorError);
  await assert.rejects(
    compose(answering(JSON.stringify({ assignments: "img-1", note: "done" })).generate),
    /placed nothing on the board/,
  );
});

test("the two ways an answer can be no answer are told apart", async () => {
  await assert.rejects(compose(answering("").generate), /compositor returned no content/);
  await assert.rejects(
    compose(answering("I could not lay that out.").generate),
    /compositor returned non-JSON: I could not lay that out\./,
  );
});

test("a board with no blocks is refused before anything is asked", async () => {
  const { asked, generate } = answering(placed());
  await assert.rejects(compose(generate, { blocks: [] }), /no blocks to put on a board/);
  assert.deepEqual(asked.models, []);
});
