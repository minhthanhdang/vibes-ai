import type { NextRequest } from "next/server";
import { acceptsJudgeCode, judgeSignupOpen, upgradedTier } from "@/server/auth/judge";
import { dummyPasswordHash, verifyPassword } from "@/server/auth/password";
import { backToSignin, credentials, readPasswordForm, signedIn } from "@/server/auth/password-form";
import {
  judgeAttemptsOpen,
  passwordAttemptsOpen,
  recordJudgeFailure,
  recordPasswordFailure,
  requestIp,
  throttleKeyEmail,
} from "@/server/auth/throttle";
import { db } from "@/server/db";

export async function POST(request: NextRequest) {
  const form = await readPasswordForm(request);
  const bail = (error: string) => backToSignin({ error, next: form.next, tab: form.tab });
  const ip = requestIp(request.headers);
  const keys = [ip, throttleKeyEmail(form.email)];

  if (!passwordAttemptsOpen(keys)) return bail("too_many_attempts");

  const asked = credentials.safeParse({ email: form.email, password: form.password });
  if (!asked.success) {
    recordPasswordFailure(keys);
    return bail("invalid_credentials");
  }

  let judge = false;
  if (form.code) {
    if (!judgeAttemptsOpen(ip)) return bail("too_many_attempts");
    judge = judgeSignupOpen() && acceptsJudgeCode(form.code);
    if (!judge) {
      recordJudgeFailure(ip);
      return bail("invalid_code");
    }
  }

  const held = await db.user.findUnique({
    where: { email: asked.data.email.toLowerCase() },
    select: { id: true, passwordHash: true, tier: true },
  });

  const stored = held?.passwordHash ?? (await dummyPasswordHash());
  const matched = await verifyPassword(asked.data.password, stored);
  if (!held || !held.passwordHash || !matched) {
    recordPasswordFailure(keys);
    return bail("invalid_credentials");
  }

  const raised = upgradedTier(held.tier, { judge });
  if (raised) await db.user.update({ where: { id: held.id }, data: { tier: raised } });

  return signedIn(held.id, form.next);
}
