import "server-only";
import { after } from "next/server";
import { db } from "@/server/db";
import { runVibesPage } from "@/server/agents/vibes/run-vibes-page";
import {
  drainVibesQueue as drain,
  type VibesWorkerDeps,
} from "@/server/agents/vibes/vibes-worker";

export { enqueueVibesPage } from "@/server/agents/vibes/vibes-enqueue";

const deps: VibesWorkerDeps = {
  db,
  runPage: (job) => runVibesPage({ db, ...job }),
};

export function drainVibesQueue() {
  return drain(deps);
}

export function kickVibesWorker(): boolean {
  try {
    after(async () => {
      try {
        await drain(deps);
      } catch (cause) {
        console.error("vibes kick failed:", cause);
      }
    });
    return true;
  } catch (cause) {
    console.error("vibes kick could not be scheduled:", cause);
    return false;
  }
}
