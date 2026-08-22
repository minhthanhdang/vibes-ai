import { test } from "node:test";
import assert from "node:assert/strict";

import { functionCallsIn, inlineDataOf, textOf, type GeneratePart } from "@/server/google/vertex";

/// The three readers that stand between the SDK's `Part` and every agent.
///
/// Before the swap (tech-spec §VII) a part was a union of the five shapes this
/// app builds, and `"text" in part` narrowed it — a part with a `text` field had
/// a string in it, and the compiler said so. The SDK's `Part` is one interface
/// with every field optional, so that guarantee is gone: a part can carry
/// `inlineData` with a media type and no bytes, a `functionCall` naming no tool,
/// or nothing at all, and all three typecheck. These functions are where that
/// is decided, and each one's rule is a sentence in `vertex.ts` that nothing
/// asked about until here.

const parts = (...items: GeneratePart[]) => items;

test("text is the parts' words joined, and the parts that are not words contribute none", () => {
  assert.equal(
    textOf(parts({ text: "a crop of " }, { functionCall: { name: "crop_reference" } }, { text: "the sofa" })),
    "a crop of the sofa",
  );
});

test("the answer is trimmed, because the model's leading newline is not something it said", () => {
  /// The one caller that shows this to a person is `image-generator.ts`, which
  /// puts it in the sentence the orchestrator repeats to the user; the others
  /// hand it to `JSON.parse`, which refuses a leading blank line in some of the
  /// shapes it is given.
  assert.equal(textOf(parts({ text: "\n\n  {\"crops\": []}  \n" })), '{"crops": []}');
});

test("a part with no text at all reads as no text, not as `undefined`", () => {
  assert.equal(textOf(parts({ thoughtSignature: "opaque" })), "");
  assert.equal(textOf(parts()), "");
});

test("an image needs both its bytes and its media type", () => {
  /// Either half alone is not a picture: bytes with no media type are something
  /// no bucket can be told what it is storing, and a media type with no bytes
  /// would reach `Buffer.from(undefined, "base64")`.
  assert.equal(inlineDataOf(parts({ inlineData: { mimeType: "image/png" } })), null);
  assert.equal(inlineDataOf(parts({ inlineData: { data: "aGk=" } })), null);
  assert.equal(inlineDataOf(parts({ inlineData: {} })), null);
});

test("a half-formed image part is stepped over rather than taken as the answer", () => {
  const found = inlineDataOf(
    parts(
      { text: "here it is" },
      { inlineData: { mimeType: "image/png" } },
      { inlineData: { mimeType: "image/png", data: "aGk=" } },
    ),
  );

  assert.deepEqual(found, { mimeType: "image/png", data: "aGk=" });
});

test("the first whole image is the answer, because one call asked for one picture", () => {
  const found = inlineDataOf(
    parts(
      { inlineData: { mimeType: "image/png", data: "Zmlyc3Q=" } },
      { inlineData: { mimeType: "image/png", data: "c2Vjb25k" } },
    ),
  );

  assert.equal(found?.data, "Zmlyc3Q=");
});

test("a function call that names no tool is not a call this loop could obey", () => {
  /// `FunctionCall.name` is optional on the SDK's type. A nameless call is an
  /// emission to preserve — `conversation.ts` keeps the raw part so the turn's
  /// next round can echo its thought signature back — but it is not an
  /// instruction, and handing one to the executor would look up `undefined` in
  /// the tool table.
  assert.deepEqual(functionCallsIn(parts({ functionCall: { args: { referenceId: "r1" } } })), []);
  assert.deepEqual(functionCallsIn(parts({ functionCall: {} })), []);
});

test("a named call keeps its arguments, and a call with none is still a call", () => {
  assert.deepEqual(
    functionCallsIn(
      parts(
        { text: "cropping" },
        { functionCall: { name: "crop_reference", args: { referenceId: "r1" } } },
        { functionCall: { name: "list_references" } },
      ),
    ),
    [
      { name: "crop_reference", args: { referenceId: "r1" } },
      { name: "list_references", args: undefined },
    ],
  );
});
