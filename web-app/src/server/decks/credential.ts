import "server-only";
import { OAuth2Client } from "google-auth-library";
import { googleOauth, redirectUri } from "@/server/auth/google";
import type { PrismaClient } from "@/generated/prisma/client";

export type GrantDb = {
  googleGrant: Pick<PrismaClient["googleGrant"], "findUnique" | "deleteMany">;
};

export type DeckCredential =
  | { status: "granted"; accessToken: string }
  | { status: "needsConsent" };

export function grantRejected(cause: unknown): boolean {
  const said = [
    (cause as { message?: unknown } | null)?.message,
    (cause as { response?: { data?: { error?: unknown } } } | null)?.response?.data?.error,
  ];
  return said.some((value) => typeof value === "string" && value.includes("invalid_grant"));
}

function credentialClient(refreshToken: string) {
  const oauth = googleOauth();
  if (!oauth) {
    throw new Error("the Google door is closed — the deck router checks googleSignInOpen first");
  }
  const client = new OAuth2Client({ ...oauth, redirectUri: redirectUri() });
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export async function deckCredential(db: GrantDb, userId: string): Promise<DeckCredential> {
  const grant = await db.googleGrant.findUnique({
    where: { userId },
    select: { refreshToken: true },
  });
  if (!grant) return { status: "needsConsent" };

  let refreshed;
  try {
    refreshed = await credentialClient(grant.refreshToken).refreshAccessToken();
  } catch (cause) {
    if (!grantRejected(cause)) throw cause;
    await db.googleGrant.deleteMany({ where: { userId } });
    return { status: "needsConsent" };
  }

  const token = refreshed.credentials.access_token;
  if (!token) throw new Error("Google refreshed the grant into no token at all");
  return { status: "granted", accessToken: token };
}
