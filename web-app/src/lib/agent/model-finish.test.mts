import { test } from "node:test";
import assert from "node:assert/strict";
import { FinishReason } from "@google/genai";

import { emptyReply, finishReasonOf, retryableEmpty } from "@/lib/agent/model-finish";

/// What a turn says when the model said nothing. The subject is a real turn:
/// "take that picture off the board, and crop the landscape" came back with no
/// text, no call and 851 output tokens, and the user was shown "…".

test("a candidate that answered has no reason to give", () => {
  assert.equal(finishReasonOf({ candidates: [{ finishReason: "STOP" }] }), undefined);
  assert.equal(finishReasonOf({ candidates: [{}] }), undefined);
  assert.equal(finishReasonOf({}), undefined);
});

test("the reason comes off the first candidate", () => {
  assert.equal(
    finishReasonOf({ candidates: [{ finishReason: "MAX_TOKENS" }, { finishReason: "STOP" }] }),
    "MAX_TOKENS",
  );
});

test("every empty answer is a sentence with a next step in it, never '…'", () => {
  for (const reason of [
    "MALFORMED_FUNCTION_CALL",
    "MAX_TOKENS",
    "SAFETY",
    "PROHIBITED_CONTENT",
    "RECITATION",
    "IMAGE_SAFETY",
    "SOMETHING_NEW",
    undefined,
  ]) {
    const reply = emptyReply(reason);
    assert.ok(reply.length > 20, `${reason} is not a sentence`);
    assert.ok(!reply.includes("…"), `${reason} still trails off`);
  }
});

test("a reason we know is answered by name and one we do not falls back", () => {
  assert.match(emptyReply("MALFORMED_FUNCTION_CALL"), /one thing at a time/);
  assert.match(emptyReply("MAX_TOKENS"), /ran out of room/);
  assert.equal(emptyReply("A_REASON_ADDED_NEXT_YEAR"), emptyReply(undefined));
});

/// The line between "ask again" and "asking again buys the same no".
test("only a malformed call is worth a second try", () => {
  assert.equal(retryableEmpty("MALFORMED_FUNCTION_CALL"), true);
  for (const reason of ["MAX_TOKENS", "SAFETY", "RECITATION", "PROHIBITED_CONTENT", undefined]) {
    assert.equal(retryableEmpty(reason), false, reason);
  }
});

/// Against the SDK's own enum, not against a string spelled the same way. The
/// reason arrives as `FinishReason` now, and every decision in this module is a
/// literal comparison — a value renamed under us would not fail to compile, it
/// would quietly answer `false`, and the round-trip retry the orchestrator
/// counts on is exactly what that `false` costs.
test("the reasons this module decides on are the SDK's, spelled its way", () => {
  assert.equal(retryableEmpty(FinishReason.MALFORMED_FUNCTION_CALL), true);
  assert.equal(retryableEmpty(FinishReason.MAX_TOKENS), false);

  assert.equal(finishReasonOf({ candidates: [{ finishReason: FinishReason.STOP }] }), undefined);
  assert.equal(
    finishReasonOf({ candidates: [{ finishReason: FinishReason.MAX_TOKENS }] }),
    FinishReason.MAX_TOKENS,
  );

  for (const reason of [
    FinishReason.MALFORMED_FUNCTION_CALL,
    FinishReason.MAX_TOKENS,
    FinishReason.SAFETY,
    FinishReason.PROHIBITED_CONTENT,
    FinishReason.BLOCKLIST,
    FinishReason.SPII,
    FinishReason.RECITATION,
    FinishReason.IMAGE_SAFETY,
  ]) {
    assert.notEqual(emptyReply(reason), emptyReply(undefined), reason);
  }
});
