import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, internalPath, pendingFlowCookie, pkcePair } from "@/server/auth/google";

export function GET(request: NextRequest) {
  const state = randomBytes(16).toString("base64url");
  const { codeVerifier, codeChallenge } = pkcePair();

  const response = NextResponse.redirect(authorizeUrl({ state, codeChallenge }));
  response.cookies.set(
    pendingFlowCookie({
      state,
      codeVerifier,
      next: internalPath(request.nextUrl.searchParams.get("next")),
    }),
  );
  return response;
}
