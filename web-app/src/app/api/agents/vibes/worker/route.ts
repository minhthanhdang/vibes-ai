import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { NextResponse, type NextRequest } from "next/server";
import { drainVibesQueue } from "@/server/agents/vibes/vibes-queue";
import { env } from "@/env";

export const maxDuration = 800;

export async function POST(request: NextRequest) {
  const secret = env().VIBES_WORKER_SECRET;
  if (!secret) return NextResponse.json({ error: "worker disabled" }, { status: 503 });
  if (!presented(request, secret)) return new NextResponse(null, { status: 404 });

  const result = await drainVibesQueue();

  if (!result.drained) {
    try {
      after(async () => {
        try {
          await fetch(new URL("/api/agents/vibes/worker", env().APP_URL), {
            method: "POST",
            headers: { authorization: `Bearer ${secret}` },
          });
        } catch (cause) {
          console.error("vibes worker self-kick failed:", cause);
        }
      });
    } catch (cause) {
      console.error("vibes worker self-kick could not be scheduled:", cause);
    }
  }

  return NextResponse.json(result);
}

function presented(request: NextRequest, secret: string) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  const presentedBytes = Buffer.from(token);
  const expectedBytes = Buffer.from(secret);
  return (
    presentedBytes.length === expectedBytes.length &&
    timingSafeEqual(presentedBytes, expectedBytes)
  );
}
