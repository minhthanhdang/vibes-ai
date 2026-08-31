import { NextResponse, type NextRequest } from "next/server";
import { developing, devBlobDir, devSigningSecret } from "@/env";
import { grantRefused, verifyGrant, type GrantMethod } from "@/server/storage/dev-signing";
import { readObjectAt, writeObjectAt } from "@/server/storage/local-store";

type Ctx = RouteContext<"/api/dev-storage/[...object]">;

const NOT_FOUND = new NextResponse(null, { status: 404 });

async function addressed(ctx: Ctx) {
  const { object } = await ctx.params;
  const [bucket, ...rest] = object;
  return bucket && rest.length ? { bucket, object: rest.join("/") } : null;
}

function granted(request: NextRequest, at: { bucket: string; object: string }, method: GrantMethod) {
  return verifyGrant(request.nextUrl.searchParams.get("t"), devSigningSecret(), {
    ...at,
    method,
    headers: request.headers,
  });
}

export async function GET(request: NextRequest, ctx: Ctx) {
  if (!developing()) return NOT_FOUND;

  const at = await addressed(ctx);
  if (!at) return new NextResponse(null, { status: 404 });

  const grant = granted(request, at, "GET");
  if (grantRefused(grant)) return new NextResponse(grant.refused, { status: 403 });

  const found = await readObjectAt(devBlobDir(), at.bucket, at.object);
  if (!found) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(found.bytes), {
    headers: {
      "Content-Type": found.sidecar.contentType ?? "application/octet-stream",
      "Cache-Control": found.sidecar.cacheControl ?? "private, max-age=0",
      "Content-Length": String(found.bytes.byteLength),
    },
  });
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  if (!developing()) return NOT_FOUND;

  const at = await addressed(ctx);
  if (!at) return new NextResponse(null, { status: 404 });

  const grant = granted(request, at, "PUT");
  if (grantRefused(grant)) return new NextResponse(grant.refused, { status: 403 });

  await writeObjectAt(devBlobDir(), at.bucket, at.object, new Uint8Array(await request.arrayBuffer()), {
    ...(grant.contentType && { contentType: grant.contentType }),
    ...(grant.cacheControl && { cacheControl: grant.cacheControl }),
    metadata: {},
  });

  return new NextResponse(null, { status: 200 });
}
