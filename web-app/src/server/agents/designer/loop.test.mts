import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DESIGNER_PICTURE_LIMIT,
  DESIGNER_ROUND_LIMIT,
  DESIGNER_STUCK_LINE,
  SKILL_TOOL,
  designerRequest,
  pictureCeilingSaid,
  runDesigner,
  type DesignerExecutor,
  type DesignerOutcome,
} from "./loop";
import { PICTURE_WINDOW } from "@/lib/agent/picture-window";
import { TOOL_CHAR_BUDGET } from "@/lib/agent/tool-window";
import type { Content, GenerateConfig, GeneratePart } from "@/server/google/vertex";

/// Agent 8's loop with the model replaced by a script. What it alone decides is
/// the two budgets — how many rounds and how many pictures one design may buy —
/// and what the transcript looks like on the way out: the pictures beside the
/// answers they came with, the skills above the work, and both ceilings said
/// out loud rather than silently applied.

type Part = { text: string } | { functionCall: { name: string; args: Record<string, unknown> } };
type Round = Part[] | { parts?: Part[]; finish: string };

const PER_ROUND = { promptTokenCount: 3000, candidatesTokenCount: 120, totalTokenCount: 3120 };

function saying(...rounds: Round[]) {
  const sent: { model: string; contents: Content[]; config: GenerateConfig }[] = [];
  const generate = (async (model: string, contents: Content[], config: GenerateConfig = {}) => {
    sent.push({ model, contents: JSON.parse(JSON.stringify(contents)) as Content[], config });
    const round = rounds[sent.length - 1];
    assert.ok(round, `the designer asked ${sent.length} times for ${rounds.length} answers`);
    const answered = Array.isArray(round) ? { parts: round, finish: undefined } : round;
    return {
      candidates: [
        {
          content: { parts: answered.parts ?? [] },
          ...(answered.finish && { finishReason: answered.finish }),
        },
      ],
      usageMetadata: PER_ROUND,
    };
  }) as never;
  return { sent, generate };
}

const call = (name: string, args: Record<string, unknown> = {}): Part => ({
  functionCall: { name, args },
});

const picture = (uri: string): GeneratePart => ({
  fileData: { fileUri: uri, mimeType: "image/png" },
});

/// A tool that answers with one picture every time it is called, each under a
/// uri of its own so a request can be read for which look it is carrying.
function shows(): DesignerExecutor {
  let at = 0;
  return async () => {
    at += 1;
    return {
      result: { revision: at },
      pictures: [picture(`gs://b/${at}.png`)],
    } satisfies DesignerOutcome;
  };
}

const responsesIn = (contents: readonly Content[]) =>
  contents.flatMap((content) =>
    content.parts.flatMap((part) =>
      part.functionResponse?.name ? [part.functionResponse.name] : [],
    ),
  );

const picturesIn = (contents: readonly Content[]) =>
  contents.flatMap((content) => content.parts.filter((part) => Boolean(part.fileData))).length;

const textIn = (contents: readonly Content[]) =>
  contents.flatMap((content) => content.parts.map((part) => part.text ?? "")).join("\n");

test("a closing line with no tool call is the answer, and costs one model call and no rounds", async () => {
  const { sent, generate } = saying([{ text: "I put the portrait at the top." }]);
  const answer = await runDesigner({ ask: "design the welcome sign", generate });

  assert.equal(answer.line, "I put the portrait at the top.");
  assert.equal(answer.rounds, 0);
  assert.equal(answer.modelCalls, 1);
  assert.equal(sent.length, 1);
  assert.equal(answer.usage.totalTokens, PER_ROUND.totalTokenCount);
});

test("the ask is the first thing the model is sent, under the designer's own instruction", async () => {
  const { sent, generate } = saying([{ text: "done" }]);
  await runDesigner({ ask: "lay out page 2 of the album", generate });

  assert.deepEqual(sent[0]!.contents[0], {
    role: "user",
    parts: [{ text: "lay out page 2 of the album" }],
  });
  assert.match(
    sent[0]!.config.systemInstruction ?? "",
    /You are the design assistant for vibes-ai/,
  );
});

test("a tool round is the emission verbatim and then its answers, re-roled to user", async () => {
  const { sent, generate } = saying(
    [{ text: "looking" }, call("get_page", { pageId: "p1" })],
    [{ text: "done" }],
  );
  const answer = await runDesigner({
    ask: "tidy it",
    generate,
    execute: async () => ({ result: { revision: 4 } }),
  });

  assert.equal(answer.rounds, 1);
  assert.equal(answer.modelCalls, 2);
  assert.deepEqual(answer.calls, [{ name: "get_page", args: { pageId: "p1" } }]);

  const second = sent[1]!.contents;
  assert.equal(second.length, 3);
  assert.equal(second[1]!.role, "model");
  assert.deepEqual(second[1]!.parts, [
    { text: "looking" },
    { functionCall: { name: "get_page", args: { pageId: "p1" } } },
  ]);
  assert.equal(second[2]!.role, "user");
  assert.deepEqual(second[2]!.parts, [
    { functionResponse: { name: "get_page", response: { revision: 4 } } },
  ]);
});

test("a picture stands directly after the answer it came with, so the window can name its call", async () => {
  const { sent, generate } = saying(
    [call("get_page", { pageId: "p1" }), call("get_image", { imageId: "ref-2" })],
    [{ text: "done" }],
  );
  await runDesigner({
    ask: "tidy it",
    generate,
    execute: async ({ name }) => ({
      result: { of: name },
      pictures: [picture(`gs://b/${name}.png`)],
    }),
  });

  const answers = sent[1]!.contents[2]!.parts;
  assert.deepEqual(
    answers.map((part) => part.functionResponse?.name ?? part.fileData?.fileUri),
    ["get_page", "gs://b/get_page.png", "get_image", "gs://b/get_image.png"],
  );
});

test("a thrown tool is data the model can act on, not a five hundred", async () => {
  const { sent, generate } = saying(
    [call("get_page", { pageId: "nope" })],
    [{ text: "no such page" }],
  );
  const answer = await runDesigner({
    ask: "tidy it",
    generate,
    execute: async () => {
      throw new Error("that page is not on that board");
    },
  });

  assert.equal(answer.line, "no such page");
  assert.deepEqual(sent[1]!.contents[2]!.parts, [
    {
      functionResponse: {
        name: "get_page",
        response: { error: "that page is not on that board" },
      },
    },
  ]);
});

test("the loop stops at DESIGNER_ROUND_LIMIT rounds and says agent 6 was cut short", async () => {
  const asking: Round[] = Array.from({ length: DESIGNER_ROUND_LIMIT + 1 }, () => [
    call("transform_on_canvas", {}),
  ]);
  const { generate } = saying(...asking);
  const answer = await runDesigner({
    ask: "keep going",
    generate,
    execute: async () => ({ result: { ok: true } }),
  });

  assert.equal(answer.rounds, DESIGNER_ROUND_LIMIT);
  assert.equal(answer.modelCalls, DESIGNER_ROUND_LIMIT + 1);
  assert.equal(answer.stopped, "rounds");
  assert.equal(answer.line, DESIGNER_STUCK_LINE);
});

test("a model still writing prose on the last round keeps its own words", async () => {
  const asking: Round[] = Array.from({ length: DESIGNER_ROUND_LIMIT }, () => [
    call("put_on_canvas", {}),
  ]);
  const { generate } = saying(...asking, [{ text: "the sign is made." }, call("get_page", {})]);
  const answer = await runDesigner({
    ask: "keep going",
    generate,
    execute: async () => ({ result: { ok: true } }),
  });

  assert.equal(answer.line, "the sign is made.");
  assert.equal(answer.stopped, "rounds");
});

test("a tool nobody wired is a fault, not a turn that ran long", async () => {
  const { generate } = saying([call("get_page", {})]);
  const answer = await runDesigner({ ask: "tidy it", generate });

  assert.equal(answer.rounds, 0);
  assert.equal(answer.stopped, undefined);
  assert.notEqual(answer.line, DESIGNER_STUCK_LINE);
});

test("a malformed call is asked once more, and only once", async () => {
  const { sent, generate } = saying(
    { finish: "MALFORMED_FUNCTION_CALL" },
    { finish: "MALFORMED_FUNCTION_CALL" },
  );
  const answer = await runDesigner({
    ask: "tidy it",
    generate,
    execute: async () => ({ result: {} }),
  });

  assert.equal(sent.length, 2);
  assert.equal(answer.rounds, 0);
  assert.equal(answer.modelCalls, 2);
  assert.equal(answer.finish, "MALFORMED_FUNCTION_CALL");
});

test("every round's usage is on the one answer, including the rounds that only looked", async () => {
  const { generate } = saying(
    [call("get_page", {})],
    [call("read_canvas", {})],
    [{ text: "done" }],
  );
  const answer = await runDesigner({
    ask: "have a look",
    generate,
    execute: async () => ({ result: {} }),
  });

  assert.equal(answer.modelCalls, 3);
  assert.equal(answer.usage.totalTokens, 3 * PER_ROUND.totalTokenCount);
  assert.equal(answer.usage.promptTokens, 3 * PER_ROUND.promptTokenCount);
});

test("pictures ride for PICTURE_WINDOW rounds and then a line stands where they stood", async () => {
  const { sent, generate } = saying(
    [call("get_page", { pageId: "p1" })],
    [call("read_canvas", {})],
    [call("read_canvas", {})],
    [{ text: "done" }],
  );
  const answer = await runDesigner({
    ask: "look repeatedly",
    generate,
    execute: shows(),
  });

  assert.equal(picturesIn(sent[1]!.contents), 1);
  assert.equal(picturesIn(sent[2]!.contents), PICTURE_WINDOW);
  /// Four rounds' worth sent on the last request, of which the oldest has aged
  /// out — the same arithmetic `pictureWindow` states: rounds − PICTURE_WINDOW.
  assert.equal(picturesIn(sent[3]!.contents), PICTURE_WINDOW);
  assert.match(
    textIn(sent[3]!.contents),
    /The picture get_page \{"pageId":"p1"\} returned is no longer shown/,
  );
  assert.equal(answer.pictures, 3);
  assert.equal(answer.picturesDropped, 1);
});

test("the picture budget is spent where it is attached, and refuses past DESIGNER_PICTURE_LIMIT", async () => {
  const looks: Round[] = Array.from({ length: DESIGNER_PICTURE_LIMIT + 2 }, () => [
    call("get_image", { imageId: "ref-1" }),
  ]);
  const { sent, generate } = saying(...looks, [{ text: "done" }]);
  const answer = await runDesigner({
    ask: "look at everything",
    generate,
    execute: shows(),
  });

  assert.equal(answer.pictures, DESIGNER_PICTURE_LIMIT);
  assert.equal(answer.picturesRefused, 2);
  /// The refusal is in the answer the model reads, in the picture's own place —
  /// a ceiling the model cannot see it hit is a model that keeps asking.
  const refused = sent[sent.length - 1]!.contents;
  assert.match(textIn(refused), /is not shown: this design has already looked at 8 pictures/);
  /// Not a picture in the whole request: the last two rounds are the refused
  /// ones, and everything older has aged out of the window. Which is the two
  /// budgets doing different jobs — the window kept the request small all along
  /// and this is the one that stopped the fetching.
  assert.equal(picturesIn(refused), 0);
});

test("a refused picture still leaves the answer's words in front of the model", async () => {
  const looks: Round[] = Array.from({ length: DESIGNER_PICTURE_LIMIT + 1 }, () => [
    call("get_image", { imageId: "ref-1" }),
  ]);
  const { sent, generate } = saying(...looks, [{ text: "done" }]);
  await runDesigner({
    ask: "look at everything",
    generate,
    execute: shows(),
  });

  const last = sent[sent.length - 1]!.contents;
  assert.ok(responsesIn(last).includes("get_image"));
});

test("the ceiling line names the call and counts what it has refused", () => {
  assert.match(
    pictureCeilingSaid("get_image", 1),
    /^\[The picture get_image returned is not shown/,
  );
  assert.match(pictureCeilingSaid("get_image", 3), /\(3 pictures so far this call\)/);
  assert.match(pictureCeilingSaid(undefined, 1), /an earlier call returned/);
});

test("a skill round is never windowed out, however long the work runs", () => {
  const ask: Content = { role: "user", parts: [{ text: "make the sign" }] };
  const skill = {
    call: { role: "model" as const, parts: [{ functionCall: { name: SKILL_TOOL, args: {} } }] },
    result: {
      role: "user" as const,
      parts: [{ functionResponse: { name: SKILL_TOOL, response: { text: "wedding stationery" } } }],
    },
    pinned: true,
  };
  /// Enough work to spend the whole character budget several times over, which
  /// is what a real design does: three skills at SKILL_CHAR_BUDGET are most of
  /// TOOL_CHAR_BUDGET on their own, so without the pin the skill is the first
  /// thing to go.
  const heavy = Array.from({ length: 12 }, (unused, n) => ({
    call: { role: "model" as const, parts: [{ functionCall: { name: "read_canvas", args: {} } }] },
    result: {
      role: "user" as const,
      parts: [
        {
          functionResponse: {
            name: "read_canvas",
            response: { at: n, filler: "x".repeat(TOOL_CHAR_BUDGET / 2) },
          },
        },
      ],
    },
    pinned: false,
  }));

  const sent = designerRequest(ask, [skill, ...heavy]);
  assert.ok(sent.roundsDropped > 0, "the work should have been windowed");
  assert.ok(responsesIn(sent.contents).includes(SKILL_TOOL));
  assert.match(textIn(sent.contents), /no longer shown/);
});

test("the pinned skill stands above the work rather than inside it", () => {
  const ask: Content = { role: "user", parts: [{ text: "make the sign" }] };
  const round = (name: string, pinned: boolean) => ({
    call: { role: "model" as const, parts: [{ functionCall: { name, args: {} } }] },
    result: { role: "user" as const, parts: [{ functionResponse: { name, response: {} } }] },
    pinned,
  });

  const sent = designerRequest(ask, [
    round("read_canvas", false),
    round(SKILL_TOOL, true),
    round("put_on_canvas", false),
  ]);

  assert.deepEqual(responsesIn(sent.contents), [SKILL_TOOL, "read_canvas", "put_on_canvas"]);
  assert.equal(sent.contents[0]!.role, "user");
  assert.deepEqual(sent.contents[0]!.parts, [{ text: "make the sign" }]);
});

test("the transcript alternates model and user, which is the only shape Vertex reads", () => {
  const ask: Content = { role: "user", parts: [{ text: "make the sign" }] };
  const round = (name: string, pinned: boolean) => ({
    call: { role: "model" as const, parts: [{ functionCall: { name, args: {} } }] },
    result: { role: "user" as const, parts: [{ functionResponse: { name, response: {} } }] },
    pinned,
  });

  const sent = designerRequest(ask, [round(SKILL_TOOL, true), round("read_canvas", false)]);
  assert.deepEqual(
    sent.contents.map((content) => content.role),
    ["user", "model", "user", "model", "user"],
  );
});

test("a call with nothing to window is sent exactly as it was built", () => {
  const ask: Content = { role: "user", parts: [{ text: "make the sign" }] };
  const sent = designerRequest(ask, []);

  assert.deepEqual(sent.contents, [ask]);
  assert.equal(sent.roundsDropped, 0);
  assert.equal(sent.picturesDropped, 0);
});

test("declarations are omitted entirely when there are none, since Vertex rejects an empty list", async () => {
  const { sent, generate } = saying([{ text: "done" }]);
  await runDesigner({ ask: "tidy it", generate });
  assert.equal(sent[0]!.config.tools, undefined);

  const withTools = saying([{ text: "done" }]);
  await runDesigner({
    ask: "tidy it",
    generate: withTools.generate,
    tools: [
      { name: "get_page", description: "a page", parameters: { type: "OBJECT", properties: {} } },
    ],
  });
  assert.equal(withTools.sent[0]!.config.tools?.[0]?.functionDeclarations?.length, 1);
});
