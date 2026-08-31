import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/env";
import {
  PENDING_FLOW_COOKIE,
  googleSignInOpen,
  grantFromCode,
  identityFromCode,
  readPendingFlow,
  type GoogleIdentity,
} from "@/server/auth/google";
import { acceptsJudgeCodeHash, tierForSignup, upgradedTier } from "@/server/auth/judge";
import { currentUser, sessionCookie, startSession } from "@/server/auth/session";
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
  if (!googleSignInOpen()) {
    return NextResponse.redirect(new URL("/signin?error=google_closed", env().APP_URL));
  }

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

  function backToNext(next: string, deckError?: string) {
    const url = new URL(next, env().APP_URL);
    if (deckError) url.searchParams.set("deckError", deckError);
    const response = NextResponse.redirect(url);
    response.cookies.delete(PENDING_FLOW_COOKIE);
    return response;
  }

  if (pending.grant) {
    const signedIn = await currentUser();
    if (!signedIn) return bail("signin_first");

    let grant;
    try {
      grant = await grantFromCode({ code, codeVerifier: pending.codeVerifier });
    } catch (cause) {
      console.error("google grant exchange failed:", cause);
      return backToNext(pending.next, "exchange_failed");
    }

    if (!grant.refreshToken) return backToNext(pending.next, "no_refresh_token");

    await db.googleGrant.upsert({
      where: { userId: signedIn.id },
      create: { userId: signedIn.id, refreshToken: grant.refreshToken, scopes: grant.scopes },
      update: { refreshToken: grant.refreshToken, scopes: grant.scopes },
    });

    return backToNext(pending.next);
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
