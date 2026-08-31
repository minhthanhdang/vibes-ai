import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { projectRouter } from "@/server/api/routers/project";
import { agentRouter } from "@/server/api/routers/agent";
import { referenceRouter } from "@/server/api/routers/reference";
import { moodboardRouter } from "@/server/api/routers/moodboard";
import { orchestratorRouter } from "@/server/api/routers/orchestrator";
import { chatRouter } from "@/server/api/routers/chat";
import { vibesRouter } from "@/server/api/routers/vibes";
import { accountRouter } from "@/server/api/routers/account";
import { deckRouter } from "@/server/api/routers/deck";

export const appRouter = createTRPCRouter({
  project: projectRouter,
  agent: agentRouter,
  reference: referenceRouter,
  moodboard: moodboardRouter,
  orchestrator: orchestratorRouter,
  chat: chatRouter,
  vibes: vibesRouter,
  account: accountRouter,
  deck: deckRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
