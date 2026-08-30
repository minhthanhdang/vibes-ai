import { NextResponse, type NextRequest } from "next/server";
import { PENDING_FLOW_COOKIE, identityFromCode, readPendingFlow } from "@/server/auth/google";
import { sessionCookie, startSession } from "@/server/auth/session";
import { db } from "@/server/db";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const pending = readPendingFlow(request);

  function bail(reason: string) {
    const response = NextResponse.redirect(
      new URL(`/signin?error=${reason}`, request.nextUrl.origin),
    );
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

  const user = await db.user.upsert({
    where: { googleId: identity.googleId },
    create: {
      googleId: identity.googleId,
      email: identity.email,
      name: identity.name,
      imageUrl: identity.imageUrl,
    },
    update: {
      email: identity.email,
      name: identity.name,
      imageUrl: identity.imageUrl,
    },
    select: { id: true },
  });

  const { token, expiresAt } = await startSession(user.id);

  const response = NextResponse.redirect(new URL(pending.next, request.nextUrl.origin));
  response.cookies.set(sessionCookie(token, expiresAt));
  response.cookies.delete(PENDING_FLOW_COOKIE);
  return response;
}
