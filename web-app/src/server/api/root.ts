import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { projectRouter } from "@/server/api/routers/project";
import { agentRouter } from "@/server/api/routers/agent";

export const appRouter = createTRPCRouter({
  project: projectRouter,
  agent: agentRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
