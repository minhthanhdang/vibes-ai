import { NextResponse, type NextRequest } from "next/server";
import { sessionTokenFrom, userForToken } from "@/server/auth/session";
import { signedReadUrl } from "@/server/google/storage";
import { db } from "@/server/db";

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/moodboards/[id]/render">,
) {
  const user = await userForToken(sessionTokenFrom(request.headers));
  if (!user) return new NextResponse(null, { status: 404 });

  const { id } = await ctx.params;
  const board = await db.moodboard.findFirst({
    where: { id, project: { userId: user.id } },
    select: { renderUri: true },
  });
  if (!board?.renderUri) return new NextResponse(null, { status: 404 });

  const upstream = await fetch(await signedReadUrl(board.renderUri), { cache: "no-store" });
  if (!upstream.ok || !upstream.body) return new NextResponse(null, { status: 502 });

  const headers = new Headers({
    "Content-Type": upstream.headers.get("Content-Type") ?? "image/png",
    "Cache-Control": "private, max-age=86400",
  });
  const length = upstream.headers.get("Content-Length");
  if (length) headers.set("Content-Length", length);

  return new NextResponse(upstream.body, { headers });
}
