import { test } from "node:test";
import assert from "node:assert/strict";

import { LayoutReaderError, readLayout } from "./layout-reader";
import type { Content } from "@/server/google/vertex";

/// The layout reader's loop, with the vision call replaced by a list of answers.
/// tech-spec §III.4 asks for the cropper's loop — validate, re-prompt with the
/// fault appended, three attempts — and each attempt re-sends the page to a PRO
/// call, so what this file is really asserting is how many of them get bought.

type Answer = { boxes?: unknown; composition?: unknown };

/// What one read of a page costs here. The page is nearly all of it, which is
/// why `attempts` and `usage` are two readings of the same loop.
const PER_READ = { promptTokenCount: 2000, candidatesTokenCount: 40, totalTokenCount: 2040 };

function answering(...answers: Answer[]) {
  const asked: Content[][] = [];
  const generate = async (_model: string, contents: Content[]) => {
    /// Copied, because the loop keeps pushing onto the same array.
    asked.push(JSON.parse(JSON.stringify(contents)) as Content[]);
    const answer = answers[asked.length - 1];
    assert.ok(answer, `the reader asked ${asked.length} times for ${answers.length} answers`);
    return {
      candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }],
      usageMetadata: PER_READ,
    };
  };
  return { asked, generate };
}

const WIDE_PAGE = { width: 1920, height: 1080 };

const ask = (generate: unknown, intention?: string) =>
  readLayout({
    gcsUri: "gs://bucket/pages/sketch.jpg",
    image: WIDE_PAGE,
    intention,
    generate: generate as never,
  });

const image = (box: number[]) => ({ box, kind: "image" });
const text = (box: number[]) => ({ box, kind: "text" });

test("a readable page on the first read costs one call", async () => {
  const { asked, generate } = answering({
    boxes: [image([100, 100, 900, 500]), image([100, 550, 900, 950])],
    composition: "a diptych, two frames side by side",
  });

  const answer = await ask(generate);
  assert.equal(asked.length, 1);
  assert.equal(answer.attempts, 1);
  assert.equal(answer.layout.id, "CUSTOM");
  assert.deepEqual(answer.layout.page, WIDE_PAGE);
  assert.equal(answer.composition, "a diptych, two frames side by side");
  assert.deepEqual(
    answer.layout.slots.map((slot) => slot.id),
    ["img-1", "img-2"],
  );
});

/// The compositor is told nothing about where a slot is beyond its shape and
/// share, so reading order is the whole of what `img-1` means to it — and the
/// order the model happened to emit boxes in is not reading order.
test("the boxes are numbered where they sit on the page, not where they were emitted", async () => {
  const { generate } = answering({
    boxes: [image([600, 50, 950, 450]), image([50, 550, 400, 950]), text([50, 50, 400, 450])],
    composition: "",
  });

  const answer = await ask(generate);
  assert.deepEqual(
    answer.layout.slots.map((slot) => slot.id),
    ["text-1", "img-1", "img-2"],
  );
  /// The bottom-left frame was emitted first and is read last.
  const last = answer.layout.slots.at(-1)!;
  assert.equal(last.id, "img-2");
  assert.ok(last.y > answer.layout.page.height / 2);
});

test("a page the reader could not read is re-prompted with what was wrong, and the second read is kept", async () => {
  const { asked, generate } = answering(
    { boxes: [image([500, 0, 508, 1000])], composition: "" },
    { boxes: [image([100, 100, 900, 900])], composition: "one frame, full bleed" },
  );

  const answer = await ask(generate);
  assert.equal(asked.length, 2);
  assert.equal(answer.attempts, 2);
  assert.equal(answer.layout.slots.length, 1);

  /// The correction is appended to the conversation, so the second read sees the
  /// page, its own last answer, and the sentence about it.
  const [, second] = asked;
  assert.equal(second.length, 3);
  assert.ok(second[0].parts.some((part) => "fileData" in part));
  assert.equal(second[1].role, "model");
  assert.equal(second[2].role, "user");
  const correction = second[2].parts[0];
  assert.ok("text" in correction && /ruled line rather than a placeholder/.test(correction.text));
});

/// The page is in the conversation once and re-sent whole on every attempt —
/// which is exactly why the attempt ceiling is the cost lever it is.
test("the page is sent once per attempt and never twice within one", async () => {
  const { asked, generate } = answering(
    { boxes: [], composition: "" },
    { boxes: [text([100, 100, 900, 900])], composition: "" },
    { boxes: [image([100, 100, 900, 900])], composition: "" },
  );

  await ask(generate);
  for (const contents of asked) {
    const pages = contents.flatMap((turn) => turn.parts.filter((part) => "fileData" in part));
    assert.equal(pages.length, 1);
  }
});

test("three unreadable pages and no more — the fourth is not bought", async () => {
  const { asked, generate } = answering(
    { boxes: [], composition: "" },
    { boxes: [text([100, 100, 900, 900])], composition: "" },
    { boxes: [{ box: [100, 100, 900, 900], kind: "logo" }], composition: "" },
    { boxes: [image([100, 100, 900, 900])], composition: "" },
  );

  await assert.rejects(ask(generate), (error: unknown) => {
    assert.ok(error instanceof LayoutReaderError);
    assert.match(error.message, /could not read that page/);
    return true;
  });
  assert.equal(asked.length, 3);
});

/// A model that answers with the boxes it was just told were wrong has said
/// everything it has to say about this page, and its remaining attempt would buy
/// the same answer again at the price of a PRO read.
test("the same unusable reading twice ends it early", async () => {
  const answer = { boxes: [image([500, 0, 505, 1000])], composition: "a strip" };
  const { asked, generate } = answering(answer, { ...answer, composition: "the same strip" });

  await assert.rejects(ask(generate), (error: unknown) => {
    assert.ok(error instanceof LayoutReaderError);
    assert.match(error.message, /same unusable way twice/);
    return true;
  });
  assert.equal(asked.length, 2);
});

/// `attempts` says how many pages were sent; this says what they came to. A
/// sketch read first time and one reached on the third read are the same layout
/// and not the same bill.
test("the tokens of every attempt are added up, not read off the last one", async () => {
  const { generate } = answering(
    { boxes: [], composition: "" },
    { boxes: [image([100, 100, 900, 900])], composition: "" },
  );

  const answer = await ask(generate);
  assert.equal(answer.attempts, 2);
  assert.deepEqual(answer.usage, {
    promptTokens: PER_READ.promptTokenCount * 2,
    outputTokens: PER_READ.candidatesTokenCount * 2,
    totalTokens: PER_READ.totalTokenCount * 2,
  });
});

/// The expensive case is the one that answers with nothing, so a refusal that
/// dropped its own usage would leave the worst afternoons looking like the
/// cheapest ones.
test("a refusal carries out the reads it already paid for", async () => {
  const { generate } = answering(
    { boxes: [], composition: "" },
    { boxes: "the whole page", composition: "" },
    { boxes: [text([100, 100, 900, 900])], composition: "" },
  );

  await assert.rejects(ask(generate), (error: unknown) => {
    assert.ok(error instanceof LayoutReaderError);
    assert.equal(error.usage.totalTokens, PER_READ.totalTokenCount * 3);
    return true;
  });
});

/// Prose in the JSON field is a safety block or a truncation, not a reading —
/// and it is refused where it lands, carrying the read it already cost.
test("an answer that is not JSON is refused with the read it cost", async () => {
  const asked: Content[][] = [];
  const generate = async (_model: string, contents: Content[]) => {
    asked.push(contents);
    return {
      candidates: [{ content: { parts: [{ text: "I cannot help with that." }] } }],
      usageMetadata: PER_READ,
    };
  };

  await assert.rejects(ask(generate), (error: unknown) => {
    assert.ok(error instanceof LayoutReaderError);
    assert.match(error.message, /non-JSON/);
    assert.equal(error.usage.totalTokens, PER_READ.totalTokenCount);
    return true;
  });
  assert.equal(asked.length, 1);
});

test("a picture that is not an image type is refused before any read", async () => {
  const { asked, generate } = answering({ boxes: [image([100, 100, 900, 900])], composition: "" });

  await assert.rejects(
    readLayout({ gcsUri: "gs://bucket/pages/sketch", generate: generate as never }),
    (error: unknown) => {
      assert.ok(error instanceof LayoutReaderError);
      assert.equal(error.usage.totalTokens, 0);
      return true;
    },
  );
  assert.equal(asked.length, 0);
});

/// The intention decides nothing about the geometry; it is context for the one
/// line of prose the reader writes.
test("what the page is for is said to the model when there is one", async () => {
  const { asked, generate } = answering({ boxes: [image([100, 100, 900, 900])], composition: "" });

  await ask(generate, "a title sequence for a cold coastal town");
  const said = asked[0]![0]!.parts.map((part) => ("text" in part ? part.text : "")).join(" ");
  assert.match(said, /cold coastal town/);
});

/// A picture nobody measured still reads: the page lands on the widest preset
/// rather than the compose refusing over a missing column.
test("a layout image with no recorded size lands on the wide page", async () => {
  const { generate } = answering({ boxes: [image([100, 100, 900, 900])], composition: "" });

  const answer = await readLayout({
    gcsUri: "gs://bucket/pages/sketch.png",
    generate: generate as never,
  });
  assert.deepEqual(answer.layout.page, WIDE_PAGE);
});
