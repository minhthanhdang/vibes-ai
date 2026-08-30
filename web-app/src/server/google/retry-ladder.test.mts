import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@google/genai";

process.env.SKIP_ENV_VALIDATION = "1";

const { RETRYABLE_STATUSES, RETRY_ATTEMPTS, clientOptions, isThrottle, isThrottledCall } =
  await import("@/server/google/vertex");

test("the client is handed a retry ladder, because absent one the SDK does not back off", () => {
  const retry = clientOptions().httpOptions?.retryOptions;

  assert.ok(retry, "no retryOptions: the SDK would return the first response unretried");
  assert.equal(retry.attempts, RETRY_ATTEMPTS);
});

test("the ladder the SDK gets is the one the other transport reads, not a copy", () => {
  assert.equal(clientOptions().httpOptions?.retryOptions?.httpStatusCodes, RETRYABLE_STATUSES);
});

test("404 is on neither transport's ladder, on purpose", () => {
  assert.equal(RETRYABLE_STATUSES.includes(404), false);
  assert.deepEqual(RETRYABLE_STATUSES, [408, 429, 500, 502, 503, 504]);
});

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
  assert.equal(isThrottle(404, null), true);
  assert.equal(isThrottledCall(sdkError(404, THROTTLING_PAGE)), true);
});
