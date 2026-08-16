import { NextResponse, type NextRequest } from "next/server";
import { sessionTokenFrom, userForToken } from "@/server/auth/session";
import { signedReadUrl } from "@/server/google/storage";
import { db } from "@/server/db";
import { env } from "@/env";

/// Someone else's reference is a 404, not a 403, and so is an unauthenticated
/// request — matching the routers, where the existence of a row is private.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/references/[id]/image">) {
  const user = await userForToken(sessionTokenFrom(request.headers));
  if (!user) return new NextResponse(null, { status: 404 });

  const { id } = await ctx.params;
  const reference = await db.reference.findFirst({
    where: { id, project: { userId: user.id } },
    select: { gcsUri: true },
  });
  if (!reference) return new NextResponse(null, { status: 404 });

  /// Held for half the signature's life so a cached redirect can never outlive
  /// the URL it points at; private because the object is one user's.
  return NextResponse.redirect(await signedReadUrl(reference.gcsUri), {
    status: 307,
    headers: {
      "Cache-Control": `private, max-age=${Math.floor(env().SIGNED_URL_TTL_SECONDS / 2)}`,
    },
  });
}
