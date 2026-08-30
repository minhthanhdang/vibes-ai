import { test } from "node:test";
import assert from "node:assert/strict";

import {
  functionCallsIn,
  inlineDataOf,
  textOf,
  thoughtsOf,
  type GeneratePart,
} from "@/server/google/vertex";

const parts = (...items: GeneratePart[]) => items;

test("text is the parts' words joined, and the parts that are not words contribute none", () => {
  assert.equal(
    textOf(parts({ text: "a crop of " }, { functionCall: { name: "crop_reference" } }, { text: "the sofa" })),
    "a crop of the sofa",
  );
});

test("the answer is trimmed, because the model's leading newline is not something it said", () => {
  assert.equal(textOf(parts({ text: "\n\n  {\"crops\": []}  \n" })), '{"crops": []}');
});

test("a part with no text at all reads as no text, not as `undefined`", () => {
  assert.equal(textOf(parts({ thoughtSignature: "opaque" })), "");
  assert.equal(textOf(parts()), "");
});

test("an image needs both its bytes and its media type", () => {
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

test("a thought summary is not what the model said, and is what it thought", () => {
  const emission = parts(
    { text: "The lower third is empty, so a wide shot goes there.", thought: true },
    { text: "I've placed the wide shot along the bottom edge." },
  );

  assert.equal(textOf(emission), "I've placed the wide shot along the bottom edge.");
  assert.deepEqual(thoughtsOf(emission), [
    "The lower third is empty, so a wide shot goes there.",
  ]);
});

test("an emission with no summaries in it thinks nothing — the ordinary call", () => {
  assert.deepEqual(thoughtsOf(parts({ text: "the sofa" }, { functionCall: { name: "crop_reference" } })), []);
});
