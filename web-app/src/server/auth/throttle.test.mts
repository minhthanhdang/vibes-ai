import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  JUDGE_ATTEMPT_LIMIT,
  JUDGE_WINDOW_MS,
  PASSWORD_ATTEMPT_LIMIT,
  PASSWORD_WINDOW_MS,
  forgetThrottles,
  judgeAttemptsOpen,
  passwordAttemptsOpen,
  recordJudgeFailure,
  recordPasswordFailure,
  requestIp,
  throttleKeyEmail,
} from "./throttle";

const AT = 1_700_000_000_000;

beforeEach(() => forgetThrottles());

test("an address that has failed nothing is open", () => {
  assert.equal(passwordAttemptsOpen(["1.2.3.4", "a@b.test"], AT), true);
  assert.equal(judgeAttemptsOpen("1.2.3.4", AT), true);
});

test("password failures close the door at the limit, not before it", () => {
  for (let attempt = 0; attempt < PASSWORD_ATTEMPT_LIMIT - 1; attempt += 1) {
    recordPasswordFailure(["1.2.3.4"], AT);
    assert.equal(passwordAttemptsOpen(["1.2.3.4"], AT), true, `after ${attempt + 1}`);
  }
  recordPasswordFailure(["1.2.3.4"], AT);
  assert.equal(passwordAttemptsOpen(["1.2.3.4"], AT), false);
});

test("the window is fixed — it reopens once it has run out", () => {
  for (let attempt = 0; attempt < PASSWORD_ATTEMPT_LIMIT; attempt += 1) {
    recordPasswordFailure(["1.2.3.4"], AT);
  }
  assert.equal(passwordAttemptsOpen(["1.2.3.4"], AT + PASSWORD_WINDOW_MS - 1), false);
  assert.equal(passwordAttemptsOpen(["1.2.3.4"], AT + PASSWORD_WINDOW_MS), true);
});

test("either key closing the door closes it, so a spread-out attack on one email is caught", () => {
  const email = throttleKeyEmail("Judge@Example.test");
  for (let attempt = 0; attempt < PASSWORD_ATTEMPT_LIMIT; attempt += 1) {
    recordPasswordFailure([`10.0.0.${attempt}`, email], AT);
  }
  assert.equal(passwordAttemptsOpen([`10.0.0.99`, email], AT), false);
  assert.equal(passwordAttemptsOpen(["10.0.0.99", "someone.else@example.test"], AT), true);
});

test("an email key is lowercased, so case is not a way around the counter", () => {
  assert.equal(throttleKeyEmail("  Judge@Example.TEST "), "judge@example.test");
});

test("judges-code failures are counted separately and more tightly", () => {
  for (let attempt = 0; attempt < JUDGE_ATTEMPT_LIMIT; attempt += 1) {
    recordJudgeFailure("1.2.3.4", AT);
  }
  assert.equal(judgeAttemptsOpen("1.2.3.4", AT), false);
  assert.equal(passwordAttemptsOpen(["1.2.3.4"], AT), true);
  assert.equal(judgeAttemptsOpen("5.6.7.8", AT), true);
  assert.equal(judgeAttemptsOpen("1.2.3.4", AT + JUDGE_WINDOW_MS), true);
});

test("a request with no address it can key on is not blocked by another's failures", () => {
  for (let attempt = 0; attempt < JUDGE_ATTEMPT_LIMIT; attempt += 1) {
    recordJudgeFailure("1.2.3.4", AT);
  }
  assert.equal(judgeAttemptsOpen(null, AT), true);
  assert.equal(passwordAttemptsOpen([null, undefined], AT), true);
});

test("the address is the first hop of the forwarded chain, then the real-ip header", () => {
  assert.equal(requestIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })), "1.2.3.4");
  assert.equal(requestIp(new Headers({ "x-forwarded-for": " 1.2.3.4 " })), "1.2.3.4");
  assert.equal(requestIp(new Headers({ "x-real-ip": "9.9.9.9" })), "9.9.9.9");
  assert.equal(requestIp(new Headers({ "x-forwarded-for": "" })), null);
  assert.equal(requestIp(new Headers()), null);
});
