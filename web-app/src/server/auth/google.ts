import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import type { NextRequest } from "next/server";
import { cloudEnv, developing, env } from "@/env";

const SCOPES = ["openid", "email", "profile"];

export const PENDING_FLOW_COOKIE = "da_oauth";
const PENDING_FLOW_TTL_SECONDS = 600;

export function redirectUri() {
  return `${env().APP_URL}/api/auth/google/callback`;
}

export function googleOauth(): { clientId: string; clientSecret: string } | null {
  if (developing()) return null;
  return {
    clientId: cloudEnv().GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: cloudEnv().GOOGLE_OAUTH_CLIENT_SECRET,
  };
}

export function googleSignInOpen(): boolean {
  return googleOauth() !== null;
}

function credentials() {
  const oauth = googleOauth();
  if (!oauth) throw new Error("the Google door is closed — every route checks googleSignInOpen first");
  return oauth;
}

function client(oauth = credentials()) {
  return new OAuth2Client({ ...oauth, redirectUri: redirectUri() });
}

export function pkcePair() {
  const codeVerifier = randomBytes(32).toString("base64url");
  return {
    codeVerifier,
    codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
  };
}

export function authorizeUrl(opts: { state: string; codeChallenge: string }) {
  return client().generateAuthUrl({
    scope: SCOPES,
    state: opts.state,
    code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: opts.codeChallenge,
    prompt: "select_account",
  });
}

export type GoogleIdentity = {
  googleId: string;
  email: string;
  name: string;
  imageUrl: string | null;
};

export async function identityFromCode(opts: {
  code: string;
  codeVerifier: string;
}): Promise<GoogleIdentity> {
  const signedUpWith = credentials();
  const oauth = client(signedUpWith);
  const { tokens } = await oauth.getToken({
    code: opts.code,
    codeVerifier: opts.codeVerifier,
  });
  if (!tokens.id_token) throw new Error("Google returned no id_token");

  const ticket = await oauth.verifyIdToken({
    idToken: tokens.id_token,
    audience: signedUpWith.clientId,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error("id_token carried no subject or email");
  }
  if (!payload.email_verified) {
    throw new Error("Google account has an unverified email");
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name ?? "",
    imageUrl: payload.picture ?? null,
  };
}

export type PendingFlow = {
  state: string;
  codeVerifier: string;
  next: string;
  judgeCodeHash?: string;
};

export function pendingFlowCookie(flow: PendingFlow) {
  return {
    name: PENDING_FLOW_COOKIE,
    value: Buffer.from(JSON.stringify(flow)).toString("base64url"),
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env().APP_URL.startsWith("https://"),
    path: "/",
    maxAge: PENDING_FLOW_TTL_SECONDS,
  };
}

export function readPendingFlow(request: NextRequest): PendingFlow | null {
  const raw = request.cookies.get(PENDING_FLOW_COOKIE)?.value;
  if (!raw) return null;
  try {
    const flow = JSON.parse(Buffer.from(raw, "base64url").toString()) as PendingFlow;
    if (!flow.state || !flow.codeVerifier) return null;
    return { ...flow, next: internalPath(flow.next) };
  } catch {
    return null;
  }
}

export function internalPath(candidate: string | null | undefined) {
  if (!candidate?.startsWith("/") || candidate.startsWith("//")) return "/home";
  return candidate;
}
