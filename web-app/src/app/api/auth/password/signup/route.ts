import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { acceptsJudgeCode, judgeSignupOpen, tierForSignup } from "@/server/auth/judge";
import { hashPassword } from "@/server/auth/password";
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
import { seedJudgeProjects } from "@/server/seed/seed-projects";

export async function POST(request: NextRequest) {
  const form = await readPasswordForm(request);
  const bail = (error: string) => backToSignin({ error, next: form.next, tab: form.tab });
  const ip = requestIp(request.headers);
  const keys = [ip, throttleKeyEmail(form.email)];

  if (!passwordAttemptsOpen(keys)) return bail("too_many_attempts");

  const asked = credentials.safeParse({ email: form.email, password: form.password });
  if (!asked.success) {
    const said = asked.error.issues.some((issue) => issue.path[0] === "email");
    return bail(said ? "invalid_email" : "weak_password");
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

  const email = asked.data.email.toLowerCase();
  const passwordHash = await hashPassword(asked.data.password);

  let user;
  try {
    user = await db.user.create({
      data: { email, passwordHash, tier: tierForSignup({ judge, method: "password" }) },
      select: { id: true },
    });
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
      recordPasswordFailure(keys);
      return bail("email_taken");
    }
    throw cause;
  }

  if (judge) await seedJudgeProjects(db, user.id);

  return signedIn(user.id, form.next);
}
