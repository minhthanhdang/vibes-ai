import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { drainAnalyzerQueue } from "@/server/agents/analyzer/analysis-queue";
import { requestedJobLimit } from "@/lib/analysis/analyzer-queue";
import { env } from "@/env";

/// The analyzer worker's wake-up. Called by Cloud Scheduler (infra.md §XIII) on
/// a short interval, and by `reference.add` right after it queues a job so the
/// user does not wait a whole tick for the first one.
///
/// It carries no session — the caller is a machine, so the shared secret is the
/// entire authorization. Kept out of tRPC for that reason: `protectedProcedure`
/// would demand a user, and this has none.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const secret = env().ANALYZER_WORKER_SECRET;
  /// Unset means nobody deployed the scheduler yet. Open-by-default here would
  /// be an unauthenticated endpoint that spends money on Vertex calls.
  if (!secret) return NextResponse.json({ error: "worker disabled" }, { status: 503 });
  if (!presented(request, secret)) return new NextResponse(null, { status: 404 });

  /// No `?limit` means "take the cap", not "take one" — see `requestedJobLimit`.
  const result = await drainAnalyzerQueue({
    limit: requestedJobLimit(request.nextUrl.searchParams.get("limit")),
  });

  /// Carries the drain's own `drained`, which says whether the queue emptied
  /// inside this invocation — the scheduler's cue to come back sooner.
  return NextResponse.json(result);
}

function presented(request: NextRequest, secret: string) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  const presentedBytes = Buffer.from(token);
  const expectedBytes = Buffer.from(secret);
  /// `timingSafeEqual` throws on a length mismatch, which would itself leak the
  /// length — compare against a padded copy and fold the length into the answer.
  return (
    presentedBytes.length === expectedBytes.length &&
    timingSafeEqual(presentedBytes, expectedBytes)
  );
}
