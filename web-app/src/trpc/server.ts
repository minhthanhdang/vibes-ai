import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { appRouter, createCaller } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";
import { createQueryClient } from "./query-client";

const createContext = cache(async () => createTRPCContext({ headers: await headers() }));

export const getQueryClient = cache(createQueryClient);

export const trpc = createTRPCOptionsProxy({
  router: appRouter,
  ctx: createContext,
  queryClient: getQueryClient,
});

export const api = createCaller(createContext);
