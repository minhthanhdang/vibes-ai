import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/env";
import { SESSION_COOKIE, endSession, sessionTokenFrom } from "@/server/auth/session";

export async function POST(request: NextRequest) {
  const token = sessionTokenFrom(request.headers);
  if (token) await endSession(token);

  const response = NextResponse.redirect(new URL("/", env().APP_URL), { status: 303 });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
