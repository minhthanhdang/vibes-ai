import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@google/genai";

import { VertexError, throttleRetried } from "@/server/google/vertex";

/// The one retry the SDK cannot be asked for (infra.md §X). Burst throttling
/// answers with an HTML 404 page for every model including working ones, and a
/// genuine missing model answers with JSON — so 404 is deliberately absent from
/// the status ladder the SDK is given, and told apart here instead.
///
/// Against the real `ApiError`, and against the real body the SDK builds: it
/// reads the response before we see it and re-wraps a non-JSON one as
/// `{"error":{"message":"<the raw text>",…}}`, which is the only reason the
/// signal survives at all.

const apiErrorFor = (status: number, body: unknown) =>
  new ApiError({ message: JSON.stringify(body), status });

const throttled = () =>
  apiErrorFor(404, {
    error: {
      message: '<!DOCTYPE html>\n<html lang=en>\n<title>Error 404 (Not Found)!!1</title>\n',
      code: 404,
      status: "Not Found",
    },
  });

const missingModel = () =>
  apiErrorFor(404, {
    error: {
      code: 404,
      message: "Publisher Model `projects/p/locations/global/publishers/google/models/nope` was not found or your project does not have access to it.",
      status: "NOT_FOUND",
    },
  });

/// No sleeping between attempts: `retries` is passed so the ladder is one step
/// long, and one step is enough to say whether a step was taken.
const failing = (errors: unknown[]) => {
  let attempts = 0;
  const call = async () => {
    const error = errors[attempts++];
    if (error) throw error;
    return "answered";
  };
  return { call, attempts: () => attempts };
};

test("a throttling 404 is asked again, because its body is the HTML page", async () => {
  const { call, attempts } = failing([throttled()]);

  assert.equal(await throttleRetried(call, 1), "answered");
  assert.equal(attempts(), 2);
});

test("a missing model's 404 is JSON and is not asked again", async () => {
  const { call, attempts } = failing([missingModel(), missingModel()]);

  await assert.rejects(throttleRetried(call, 1), (error: unknown) => {
    assert.ok(error instanceof VertexError);
    assert.equal(error.status, 404);
    /// The distinction the whole function exists for: a config error told as
    /// one, rather than as a service that was busy four times.
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(attempts(), 1);
});

test("throttling that never lets up comes back as retryable", async () => {
  const { call, attempts } = failing([throttled(), throttled()]);

  await assert.rejects(throttleRetried(call, 1), (error: unknown) => {
    assert.ok(error instanceof VertexError);
    assert.equal(error.retryable, true);
    return true;
  });
  assert.equal(attempts(), 2);
});

test("a 503 has already had the SDK's backoff, and says so", async () => {
  const { call, attempts } = failing([apiErrorFor(503, { error: { code: 503 } })]);

  await assert.rejects(throttleRetried(call, 1), (error: unknown) => {
    assert.ok(error instanceof VertexError);
    assert.equal(error.status, 503);
    assert.equal(error.retryable, true);
    return true;
  });
  /// Not retried here. The ladder handed to the SDK covers this status, so a
  /// second loop around it would be the backoff run twice.
  assert.equal(attempts(), 1);
});

test("a request the model refused to parse is not a busy service", async () => {
  const { call } = failing([apiErrorFor(400, { error: { code: 400, message: "Invalid JSON" } })]);

  await assert.rejects(throttleRetried(call, 1), (error: unknown) => {
    assert.ok(error instanceof VertexError);
    assert.equal(error.retryable, false);
    return true;
  });
});

test("anything that is not an ApiError is left exactly as it was thrown", async () => {
  const thrown = new TypeError("fetch failed");
  const { call, attempts } = failing([thrown, thrown]);

  await assert.rejects(throttleRetried(call, 1), (error: unknown) => {
    assert.equal(error, thrown);
    return true;
  });
  assert.equal(attempts(), 1);
});
