import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@/server/db";
import { env } from "@/env";

export const SESSION_COOKIE = "da_session";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

function digest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.session.create({ data: { id: digest(token), userId, expiresAt } });
  return { token, expiresAt };
}

export async function endSession(token: string) {
  await db.session.deleteMany({ where: { id: digest(token) } });
}

export function sessionCookie(token: string, expiresAt: Date) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env().APP_URL.startsWith("https://"),
    path: "/",
    expires: expiresAt,
  };
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  imageUrl: string | null;
};

export function sessionTokenFrom(headers: Headers) {
  return headers
    .get("cookie")
    ?.split(";")
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
}

export async function userForToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { id: digest(token) },
    select: {
      expiresAt: true,
      user: { select: { id: true, email: true, name: true, imageUrl: true } },
    },
  });
  if (!session) return null;

  if (session.expiresAt <= new Date()) {
    await endSession(token);
    return null;
  }
  return session.user;
}

export const currentUser = cache(async () =>
  userForToken((await cookies()).get(SESSION_COOKIE)?.value),
);
