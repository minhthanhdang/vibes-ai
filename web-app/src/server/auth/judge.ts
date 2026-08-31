import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { AccountTier } from "@/generated/prisma/enums";
import { env } from "@/env";

function accepted(): string[] {
  return (env().JUDGE_SIGNUP_CODES ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
}

export function judgeSignupOpen(): boolean {
  return accepted().length > 0;
}

export function judgeCodeHash(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

export function acceptsJudgeCodeHash(hash: string | null | undefined): boolean {
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return false;

  const offered = Buffer.from(hash, "hex");
  let matched = false;
  for (const code of accepted()) {
    matched = timingSafeEqual(Buffer.from(judgeCodeHash(code), "hex"), offered) || matched;
  }
  return matched;
}

export function acceptsJudgeCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return acceptsJudgeCodeHash(judgeCodeHash(code));
}

export type SignupMethod = "google" | "password";

export function tierForSignup({
  judge,
  method,
}: {
  judge: boolean;
  method: SignupMethod;
}): AccountTier {
  if (judge) return "TIER_1";
  return method === "google" ? "TIER_2" : "TIER_3";
}

export function upgradedTier(held: AccountTier, { judge }: { judge: boolean }): AccountTier | null {
  return judge && held !== "TIER_1" ? "TIER_1" : null;
}
