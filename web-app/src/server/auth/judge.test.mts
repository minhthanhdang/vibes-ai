import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";

const CODE = "aVeryLongJudgesCodeOfTwentyFourPlus";
const SECOND = "aSecondJudgesCodeAlsoLongEnough00";

async function judge(codes: string | undefined) {
  if (codes === undefined) delete process.env.JUDGE_SIGNUP_CODES;
  else process.env.JUDGE_SIGNUP_CODES = codes;
  return import("./judge");
}

test("unset means no judge signup is possible — unset is closed, not open", async () => {
  const { judgeSignupOpen, acceptsJudgeCode } = await judge(undefined);
  assert.equal(judgeSignupOpen(), false);
  assert.equal(acceptsJudgeCode(CODE), false);
  assert.equal(acceptsJudgeCode(""), false);
});

test("an empty value is unset, not a code that matches the empty string", async () => {
  const { judgeSignupOpen, acceptsJudgeCode } = await judge("   ");
  assert.equal(judgeSignupOpen(), false);
  assert.equal(acceptsJudgeCode(""), false);
  assert.equal(acceptsJudgeCode("   "), false);
});

test("the configured code is accepted and a wrong one is not", async () => {
  const { judgeSignupOpen, acceptsJudgeCode } = await judge(CODE);
  assert.equal(judgeSignupOpen(), true);
  assert.equal(acceptsJudgeCode(CODE), true);
  assert.equal(acceptsJudgeCode(`${CODE}x`), false);
  assert.equal(acceptsJudgeCode(CODE.toUpperCase()), false);
  assert.equal(acceptsJudgeCode(null), false);
});

test("surrounding whitespace is trimmed off what the judge pasted", async () => {
  const { acceptsJudgeCode } = await judge(CODE);
  assert.equal(acceptsJudgeCode(`  ${CODE}\n`), true);
});

test("every code in the list is accepted, so one can be rotated per group", async () => {
  const { acceptsJudgeCode } = await judge(`${CODE}, ${SECOND}`);
  assert.equal(acceptsJudgeCode(CODE), true);
  assert.equal(acceptsJudgeCode(SECOND), true);
  assert.equal(acceptsJudgeCode("neither of them, obviously not"), false);
});

test("the cookie carries a hash, and only a hash of a live code is accepted", async () => {
  const { judgeCodeHash, acceptsJudgeCodeHash } = await judge(CODE);
  const hash = judgeCodeHash(CODE);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash.includes(CODE), false);
  assert.equal(acceptsJudgeCodeHash(hash), true);
  assert.equal(acceptsJudgeCodeHash(judgeCodeHash("something else entirely")), false);
});

test("a forged or malformed hash is refused rather than throwing", async () => {
  const { acceptsJudgeCodeHash } = await judge(CODE);
  for (const forged of ["", "true", "0".repeat(63), "0".repeat(65), "z".repeat(64), null, undefined]) {
    assert.equal(acceptsJudgeCodeHash(forged), false, String(forged));
  }
});

test("a code rotated out stops working mid-flow, because the callback re-validates", async () => {
  const { judgeCodeHash } = await judge(CODE);
  const minted = judgeCodeHash(CODE);
  const { acceptsJudgeCodeHash } = await judge(SECOND);
  assert.equal(acceptsJudgeCodeHash(minted), false);
});

test("a judge gets tier 1 whichever door they came in, and nobody else does", async () => {
  const { tierForSignup } = await judge(CODE);
  assert.equal(tierForSignup({ judge: true, method: "google" }), "TIER_1");
  assert.equal(tierForSignup({ judge: true, method: "password" }), "TIER_1");
  assert.equal(tierForSignup({ judge: false, method: "google" }), "TIER_2");
  assert.equal(tierForSignup({ judge: false, method: "password" }), "TIER_3");
});

test("presenting a code later raises a tier and never lowers one", async () => {
  const { upgradedTier } = await judge(CODE);
  assert.equal(upgradedTier("TIER_2", { judge: true }), "TIER_1");
  assert.equal(upgradedTier("TIER_3", { judge: true }), "TIER_1");
  assert.equal(upgradedTier("TIER_1", { judge: true }), null);
  assert.equal(upgradedTier("TIER_1", { judge: false }), null);
  assert.equal(upgradedTier("TIER_2", { judge: false }), null);
});
