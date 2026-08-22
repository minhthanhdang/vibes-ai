import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@google/genai";

process.env.SKIP_ENV_VALIDATION = "1";

const { RETRYABLE_STATUSES, RETRY_ATTEMPTS, clientOptions, isThrottle, isThrottledCall } =
  await import("@/server/google/vertex");

/// The retry policy itself, which `vertex.test.mts` exercises but does not hold:
/// that file drives `throttleRetried` and so only ever sees the loop this app
/// wrote. The ladder handed to the SDK is the other half of the same policy and
/// nothing observed it — the SDK gives no reading of the options it was
/// constructed with, so deleting `httpOptions` left the whole suite green while
/// buying no backoff at all.

test("the client is handed a retry ladder, because absent one the SDK does not back off", () => {
  const retry = clientOptions().httpOptions?.retryOptions;

  /// Not "keep the defaults". The SDK's documented ladder (5 attempts, 1s
  /// initial, 60s cap, base 2, jitter) applies only once this object is passed;
  /// passing nothing hands back the first response whatever it says.
  assert.ok(retry, "no retryOptions: the SDK would return the first response unretried");
  assert.equal(retry.attempts, RETRY_ATTEMPTS);
});

test("the ladder the SDK gets is the one the other transport reads, not a copy", () => {
  /// By identity. A literal array written into the client options would satisfy
  /// a deepEqual forever while `vertexFetch` went on reading a different list —
  /// which is the disagreement between the two transports the shared constant
  /// exists to prevent.
  assert.equal(clientOptions().httpOptions?.retryOptions?.httpStatusCodes, RETRYABLE_STATUSES);
});

test("404 is on neither transport's ladder, on purpose", () => {
  assert.equal(RETRYABLE_STATUSES.includes(404), false);
  /// The statuses a second ask can actually help with. A missing model is not
  /// one of them: blanket-retrying 404 turns a configuration error into four
  /// wasted calls and a slower failure (infra.md §X).
  assert.deepEqual(RETRYABLE_STATUSES, [408, 429, 500, 502, 503, 504]);
});

/// The same response read by both transports. `vertexFetch` still has the
/// headers; the SDK has thrown them away by the time an `ApiError` reaches us
/// and re-wrapped a non-JSON body as `{"error":{"message":"<the raw text>",…}}`,
/// so that transport reads the first character of the text instead. Two
/// readings of one signal, and a drift between them would give one transport a
/// retry the other refuses.

const sdkError = (status: number, body: string) => {
  const json = (() => {
    try {
      JSON.parse(body);
      return true;
    } catch {
      return false;
    }
  })();
  return new ApiError({
    status,
    message: json ? body : JSON.stringify({ error: { message: body, code: status } }),
  });
};

const THROTTLING_PAGE =
  "<!DOCTYPE html>\n<html lang=en>\n<title>Error 404 (Not Found)!!1</title>\n<p>The requested URL was not found on this server.</p>\n";

const MISSING_MODEL = JSON.stringify({
  error: {
    code: 404,
    message: "Publisher Model `…/models/nope` was not found or your project does not have access.",
    status: "NOT_FOUND",
  },
});

const responses = [
  {
    what: "burst throttling, which answers HTML for a model that exists",
    status: 404,
    contentType: "text/html; charset=UTF-8",
    body: THROTTLING_PAGE,
    throttled: true,
  },
  {
    what: "a genuinely missing model, which answers JSON",
    status: 404,
    contentType: "application/json; charset=UTF-8",
    body: MISSING_MODEL,
    throttled: false,
  },
  {
    what: "an HTML 503, which is the ladder's business and not this rule's",
    status: 503,
    contentType: "text/html",
    body: "<html><title>503 Service Unavailable</title></html>",
    throttled: false,
  },
];

for (const { what, status, contentType, body, throttled } of responses) {
  test(`both transports call ${what} the same thing`, () => {
    assert.equal(isThrottle(status, contentType), throttled);
    assert.equal(isThrottledCall(sdkError(status, body)), throttled);
  });
}

test("a 404 that arrives with no content-type is read as throttling by both", () => {
  /// The rule is written as "not JSON" rather than as "HTML", so a 404 that
  /// arrives with no content-type at all falls to the retryable side. Only the
  /// JSON error body is a documented reading (infra.md §X); everything else is
  /// an edge page of some shape, and calling one of those permanent would strand
  /// a working model on a throttle.
  assert.equal(isThrottle(404, null), true);
  assert.equal(isThrottledCall(sdkError(404, THROTTLING_PAGE)), true);
});
