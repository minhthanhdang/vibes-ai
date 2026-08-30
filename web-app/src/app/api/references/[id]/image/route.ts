import { NextResponse, type NextRequest } from "next/server";
import { sessionTokenFrom, userForToken } from "@/server/auth/session";
import { signedReadUrl } from "@/server/google/storage";
import { db } from "@/server/db";
import { env } from "@/env";
import { needsDerivedCopy } from "@/lib/intake/reference-derived";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/references/[id]/image">) {
  const user = await userForToken(sessionTokenFrom(request.headers));
  if (!user) return new NextResponse(null, { status: 404 });

  const { id } = await ctx.params;
  const reference = await db.reference.findFirst({
    where: { id, project: { userId: user.id } },
    select: { gcsUri: true, thumbGcsUri: true, width: true, height: true },
  });
  if (!reference) return new NextResponse(null, { status: 404 });

  const wantsThumb = request.nextUrl.searchParams.get("variant") === "thumb";
  const gcsUri = (wantsThumb ? reference.thumbGcsUri : null) ?? reference.gcsUri;
  const signed = await signedReadUrl(gcsUri);

  const provisional =
    wantsThumb &&
    !reference.thumbGcsUri &&
    needsDerivedCopy({ width: reference.width, height: reference.height, hasThumbnail: false });

  if (request.nextUrl.searchParams.get("stream") === "1") {
    return streamed(signed, provisional ? PROVISIONAL_MAX_AGE : STREAM_MAX_AGE);
  }

  return NextResponse.redirect(signed, {
    status: 307,
    headers: {
      "Cache-Control": `private, max-age=${Math.floor(env().SIGNED_URL_TTL_SECONDS / 2)}`,
    },
  });
}

const STREAM_MAX_AGE = 86400;

const PROVISIONAL_MAX_AGE = 300;

async function streamed(signedUrl: string, maxAge: number) {
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
