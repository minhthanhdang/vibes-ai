import "server-only";
import { after } from "next/server";
import { db } from "@/server/db";
import { analyzeReference } from "@/server/agents/analyzer/analyzer";
import {
  drainAnalyzerQueue as drain,
  type AnalyzerWorkerDeps,
} from "@/server/agents/analyzer/analyzer-worker";

export { enqueueAnalysis } from "@/server/agents/analyzer/analysis-enqueue";

const deps: AnalyzerWorkerDeps = { db, analyze: analyzeReference };

export function drainAnalyzerQueue({ limit }: { limit?: number } = {}) {
  return drain(deps, limit);
}

export function kickAnalyzerWorker(): boolean {
  try {
    after(async () => {
      try {
        await drain(deps, 1);
      } catch (cause) {
        console.error("analyzer kick failed:", cause);
      }
    });
    return true;
  } catch (cause) {
    console.error("analyzer kick could not be scheduled:", cause);
    return false;
  }
}
