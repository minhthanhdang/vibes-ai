import { NextResponse, type NextRequest } from "next/server";
import { sessionTokenFrom, userForToken } from "@/server/auth/session";
import { signedReadUrl } from "@/server/google/storage";
import { db } from "@/server/db";

/// Someone else's board is a 404, not a 403, and so is an unauthenticated
/// request — matching the routers, where the existence of a row is private.
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
  /// A board that has never been rendered is a 404 rather than a placeholder:
  /// the only caller is an `<img>` whose src the list only sets once a render
  /// exists, so this is a race with a delete, not a normal state.
  if (!board?.renderUri) return new NextResponse(null, { status: 404 });

  /// Streamed rather than redirected, for the same reason a board's photos are:
  /// a preview is drawn into the app's own pages, and a cross-origin image is
  /// one a canvas cannot read back.
  const upstream = await fetch(await signedReadUrl(board.renderUri), { cache: "no-store" });
  if (!upstream.ok || !upstream.body) return new NextResponse(null, { status: 502 });

  const headers = new Headers({
    "Content-Type": upstream.headers.get("Content-Type") ?? "image/png",
    /// The object at this path is overwritten by the next render, so what makes
    /// a day of caching safe is the revision in the query string: a re-rendered
    /// board is a different URL, and this one can never be shown for it.
    "Cache-Control": "private, max-age=86400",
  });
  const length = upstream.headers.get("Content-Length");
  if (length) headers.set("Content-Length", length);

  return new NextResponse(upstream.body, { headers });
}
