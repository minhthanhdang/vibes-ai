import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { projectRouter } from "@/server/api/routers/project";
import { agentRouter } from "@/server/api/routers/agent";
import { referenceRouter } from "@/server/api/routers/reference";
import { orchestratorRouter } from "@/server/api/routers/orchestrator";

export const appRouter = createTRPCRouter({
  project: projectRouter,
  agent: agentRouter,
  reference: referenceRouter,
  orchestrator: orchestratorRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
