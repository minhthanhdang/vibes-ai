import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { NextResponse, type NextRequest } from "next/server";
import { drainVibesQueue } from "@/server/agents/vibes/vibes-queue";
import { env } from "@/env";

/// The vibes worker's wake-up — the analyzer route's twin
/// (multi-vibes-and-preview-prd §II.5). Called by Cloud Scheduler every minute
/// as the backstop that clears a dead lease and a cold queue, by the mutation
/// that enqueued a chain head, and by itself: one settled page enqueues the
/// next, and the self-kick below is what advances a chain at design speed
/// rather than at cron cadence.
///
/// It carries no session — the caller is a machine, so the shared secret is
/// the entire authorization. Kept out of tRPC for that reason:
/// `protectedProcedure` would demand a user, and this has none.
///
/// No `?limit` param, unlike the analyzer: the job cap is one, because one
/// design page runs to minutes and two can exceed this duration.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const secret = env().VIBES_WORKER_SECRET;
  /// Unset means nobody deployed the scheduler yet. Open-by-default here would
  /// be an unauthenticated endpoint that spends money on design calls.
  if (!secret) return NextResponse.json({ error: "worker disabled" }, { status: 503 });
  if (!presented(request, secret)) return new NextResponse(null, { status: 404 });

  const result = await drainVibesQueue();

  /// The self-kick: this invocation took its one job, so anything still
  /// QUEUED — the page its settle just chain-enqueued, or another board's
  /// chain head — waits a cron tick unless a fresh invocation starts now. A
  /// fetch rather than draining again in `after`, because the point is a
  /// fresh `maxDuration`: this invocation may have spent minutes on its page
  /// already. Lost kicks are fine — the cron is what guarantees eventual
  /// drain, same division of labour as the analyzer's two drains.
  ///
  /// `APP_URL` rather than the PRD's `VERCEL_URL` pointer: it is already
  /// required, validated, and deployment-exact (the OAuth redirect depends on
  /// it), where `VERCEL_URL` is unset locally.
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
  /// `timingSafeEqual` throws on a length mismatch, which would itself leak the
  /// length — compare against a padded copy and fold the length into the answer.
  return (
    presentedBytes.length === expectedBytes.length &&
    timingSafeEqual(presentedBytes, expectedBytes)
  );
}
