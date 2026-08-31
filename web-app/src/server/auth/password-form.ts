import "server-only";
import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/env";
import { internalPath } from "@/server/auth/google";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/limits/password-rules";
import { sessionCookie, startSession } from "@/server/auth/session";

export const SIGNIN_TABS = ["judges", "normal"] as const;
export type SigninTab = (typeof SIGNIN_TABS)[number];

export const credentials = z.object({
  email: z.email(),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

export type PasswordForm = {
  email: string;
  password: string;
  code: string;
  next: string;
  tab: SigninTab;
};

export async function readPasswordForm(request: NextRequest): Promise<PasswordForm> {
  const body = await request.formData().catch(() => new FormData());
  const said = (key: string) => {
    const value = body.get(key);
    return typeof value === "string" ? value : "";
  };
  const tab = said("tab");
  return {
    email: said("email").trim(),
    password: said("password"),
    code: said("code").trim(),
    next: internalPath(said("next")),
    tab: SIGNIN_TABS.includes(tab as SigninTab) ? (tab as SigninTab) : "normal",
  };
}

export function backToSignin({
  error,
  next,
  tab,
}: {
  error: string;
  next: string;
  tab: SigninTab;
}) {
  const url = new URL("/signin", env().APP_URL);
  url.searchParams.set("tab", tab);
  url.searchParams.set("error", error);
  if (next !== "/home") url.searchParams.set("next", next);
  return NextResponse.redirect(url, { status: 303 });
}

export async function signedIn(userId: string, next: string) {
  const { token, expiresAt } = await startSession(userId);
  const response = NextResponse.redirect(new URL(next, env().APP_URL), { status: 303 });
  response.cookies.set(sessionCookie(token, expiresAt));
  return response;
}
