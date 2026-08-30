import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { drainAnalyzerQueue } from "@/server/agents/analyzer/analysis-queue";
import { requestedJobLimit } from "@/lib/analysis/analyzer-queue";
import { env } from "@/env";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const secret = env().ANALYZER_WORKER_SECRET;
  if (!secret) return NextResponse.json({ error: "worker disabled" }, { status: 503 });
  if (!presented(request, secret)) return new NextResponse(null, { status: 404 });

  const result = await drainAnalyzerQueue({
    limit: requestedJobLimit(request.nextUrl.searchParams.get("limit")),
  });

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
