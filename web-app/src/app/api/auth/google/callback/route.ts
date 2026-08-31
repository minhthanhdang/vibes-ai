import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/env";
import {
  PENDING_FLOW_COOKIE,
  identityFromCode,
  readPendingFlow,
  type GoogleIdentity,
} from "@/server/auth/google";
import { acceptsJudgeCodeHash, tierForSignup, upgradedTier } from "@/server/auth/judge";
import { sessionCookie, startSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { seedJudgeProjects } from "@/server/seed/seed-projects";

async function resolveUser(identity: GoogleIdentity, judge: boolean) {
  const profile = {
    email: identity.email,
    name: identity.name,
    imageUrl: identity.imageUrl,
  };

  const byGoogleId = await db.user.findUnique({
    where: { googleId: identity.googleId },
    select: { id: true, tier: true },
  });
  if (byGoogleId) {
    const raised = upgradedTier(byGoogleId.tier, { judge });
    return db.user.update({
      where: { id: byGoogleId.id },
      data: { ...profile, ...(raised ? { tier: raised } : {}) },
      select: { id: true },
    });
  }

  const byEmail = await db.user.findUnique({
    where: { email: identity.email },
    select: { id: true, tier: true },
  });
  if (byEmail) {
    const raised = upgradedTier(byEmail.tier, { judge });
    return db.user.update({
      where: { id: byEmail.id },
      data: { ...profile, googleId: identity.googleId, ...(raised ? { tier: raised } : {}) },
      select: { id: true },
    });
  }

  return db.user.create({
    data: {
      ...profile,
      googleId: identity.googleId,
      tier: tierForSignup({ judge, method: "google" }),
    },
    select: { id: true },
  });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const pending = readPendingFlow(request);

  function bail(reason: string) {
    const response = NextResponse.redirect(new URL(`/signin?error=${reason}`, env().APP_URL));
    response.cookies.delete(PENDING_FLOW_COOKIE);
    return response;
  }

  const denial = params.get("error");
  if (denial) return bail(/^[a-z_]+$/.test(denial) ? denial : "unknown");

  const code = params.get("code");
  if (!code || !pending || params.get("state") !== pending.state) {
    return bail("invalid_request");
  }

  let identity;
  try {
    identity = await identityFromCode({ code, codeVerifier: pending.codeVerifier });
  } catch (cause) {
    console.error("google token exchange failed:", cause);
    return bail("exchange_failed");
  }

  const judge = acceptsJudgeCodeHash(pending.judgeCodeHash);
  const user = await resolveUser(identity, judge);
  if (judge) await seedJudgeProjects(db, user.id);

  const { token, expiresAt } = await startSession(user.id);

  const response = NextResponse.redirect(new URL(pending.next, env().APP_URL));
  response.cookies.set(sessionCookie(token, expiresAt));
  response.cookies.delete(PENDING_FLOW_COOKIE);
  return response;
}
