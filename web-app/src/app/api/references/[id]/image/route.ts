import { NextResponse, type NextRequest } from "next/server";
import { sessionTokenFrom, userForToken } from "@/server/auth/session";
import { signedReadUrl } from "@/server/google/storage";
import { db } from "@/server/db";
import { env } from "@/env";
import { needsDerivedCopy } from "@/lib/reference-derived";

/// Someone else's reference is a 404, not a 403, and so is an unauthenticated
/// request — matching the routers, where the existence of a row is private.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/references/[id]/image">) {
  const user = await userForToken(sessionTokenFrom(request.headers));
  if (!user) return new NextResponse(null, { status: 404 });

  const { id } = await ctx.params;
  const reference = await db.reference.findFirst({
    where: { id, project: { userId: user.id } },
    select: { gcsUri: true, thumbGcsUri: true, width: true, height: true },
  });
  if (!reference) return new NextResponse(null, { status: 404 });

  /// A reference has no thumbnail when its original was already small, so the
  /// grid asking for one has to be answered with the original rather than a 404.
  const wantsThumb = request.nextUrl.searchParams.get("variant") === "thumb";
  const gcsUri = (wantsThumb ? reference.thumbGcsUri : null) ?? reference.gcsUri;
  const signed = await signedReadUrl(gcsUri);

  /// The URL says which copy was *asked for*, so an answer that is not that copy
  /// must not be held for a day: a web-imported reference has no thumbnail until
  /// a browser reads its bytes back and makes one, and the request for it is
  /// often the very board open that triggers the derivation. Cached long, that
  /// board would keep pulling the original from this URL until tomorrow. A row
  /// whose original is already inside the thumbnail box will never gain one, so
  /// its fallback is the final answer and keeps the full lifetime.
  const provisional =
    wantsThumb &&
    !reference.thumbGcsUri &&
    needsDerivedCopy({ width: reference.width, height: reference.height, hasThumbnail: false });

  /// The moodboard asks for the bytes rather than the redirect. A redirect to
  /// the bucket makes the image cross-origin, and a canvas that has drawn a
  /// cross-origin image cannot be read back — which is what exporting a board
  /// is. See `referenceCanvasImagePath`.
  if (request.nextUrl.searchParams.get("stream") === "1") {
    return streamed(signed, provisional ? PROVISIONAL_MAX_AGE : STREAM_MAX_AGE);
  }

  /// Held for half the signature's life so a cached redirect can never outlive
  /// the URL it points at; private because the object is one user's.
  return NextResponse.redirect(signed, {
    status: 307,
    headers: {
      "Cache-Control": `private, max-age=${Math.floor(env().SIGNED_URL_TTL_SECONDS / 2)}`,
    },
  });
}

/// Piped, not buffered: an original is megabytes and there is no reason for the
/// whole of it to sit in the function's memory on the way past. What is cached
/// here is the bytes rather than a redirect, so the signature's lifetime does
/// not bound it — a reference's pixels never change, since a new upload is a
/// new row.
const STREAM_MAX_AGE = 86400;

/// Long enough that the images of one board open are fetched once, short enough
/// that the derivation running behind that same open is picked up on the next.
const PROVISIONAL_MAX_AGE = 300;

async function streamed(signedUrl: string, maxAge: number) {
  /// Uncached on purpose: the URL carries a fresh signature, so a framework
  /// cache keyed on it could never hit and would only store megabytes twice.
  const upstream = await fetch(signedUrl, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) return new NextResponse(null, { status: 502 });

  const headers = new Headers({
    "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
    "Cache-Control": `private, max-age=${maxAge}`,
  });
  const length = upstream.headers.get("Content-Length");
  if (length) headers.set("Content-Length", length);

  return new NextResponse(upstream.body, { headers });
}
