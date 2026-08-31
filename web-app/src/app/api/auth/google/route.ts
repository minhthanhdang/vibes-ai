import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  DECK_SCOPES,
  authorizeUrl,
  googleSignInOpen,
  internalPath,
  pendingFlowCookie,
  pkcePair,
} from "@/server/auth/google";
import { currentUser } from "@/server/auth/session";
import { acceptsJudgeCode, judgeCodeHash, judgeSignupOpen } from "@/server/auth/judge";
import { backToSignin, readPasswordForm } from "@/server/auth/password-form";
import { judgeAttemptsOpen, recordJudgeFailure, requestIp } from "@/server/auth/throttle";

function bounce({
  next,
  judgeCode,
  grant,
}: {
  next: string;
  judgeCode?: string;
  grant?: true;
}) {
  const state = randomBytes(16).toString("base64url");
  const { codeVerifier, codeChallenge } = pkcePair();

  const url = authorizeUrl({
    state,
    codeChallenge,
    ...(grant ? { scopes: DECK_SCOPES, offline: true } : {}),
  });

  const response = NextResponse.redirect(url, { status: 303 });
  response.cookies.set(
    pendingFlowCookie({
      state,
      codeVerifier,
      next,
      ...(judgeCode ? { judgeCodeHash: judgeCodeHash(judgeCode) } : {}),
      ...(grant ? { grant } : {}),
    }),
  );
  return response;
}

export async function GET(request: NextRequest) {
  const next = internalPath(request.nextUrl.searchParams.get("next"));
  if (!googleSignInOpen()) return backToSignin({ error: "google_closed", next, tab: "normal" });

  if (request.nextUrl.searchParams.get("intent") !== "deck") return bounce({ next });

  const user = await currentUser();
  if (!user) return backToSignin({ error: "signin_first", next, tab: "normal" });
  return bounce({ next, grant: true });
}

export async function POST(request: NextRequest) {
  const form = await readPasswordForm(request);
  const ip = requestIp(request.headers);

  if (!googleSignInOpen()) {
    return backToSignin({ error: "google_closed", next: form.next, tab: form.tab });
  }

  if (!form.code) return bounce({ next: form.next });

  if (!judgeAttemptsOpen(ip)) {
    return backToSignin({ error: "too_many_attempts", next: form.next, tab: form.tab });
  }
  if (!judgeSignupOpen() || !acceptsJudgeCode(form.code)) {
    recordJudgeFailure(ip);
    return backToSignin({ error: "invalid_code", next: form.next, tab: form.tab });
  }

  return bounce({ next: form.next, judgeCode: form.code });
}
