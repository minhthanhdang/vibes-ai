import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, endSession, sessionTokenFrom } from "@/server/auth/session";

/// POST only: a GET sign-out is a one-pixel-image CSRF away from logging
/// everyone out.
export async function POST(request: NextRequest) {
  const token = sessionTokenFrom(request.headers);
  if (token) await endSession(token);

  const response = NextResponse.redirect(new URL("/", request.nextUrl.origin), { status: 303 });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
