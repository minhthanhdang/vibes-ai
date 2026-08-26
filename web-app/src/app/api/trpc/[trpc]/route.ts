import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";

/// How long the platform lets this function run before killing it. Every tRPC
/// call in the app comes through here, including the longest thing the product
/// does: a chat turn that designs a page runs two to three minutes, and a
/// "Let's Vibes" page can run longer still.
///
/// Without this the route ran under the platform default, and a turn killed at
/// the ceiling is the worst failure the app has — the tools have already
/// written their boards and pictures, but the `ChatMessage` rows are written
/// after the turn returns, so the user is left with "Send again" under a
/// question whose work actually happened.
///
/// 300 is the Hobby cap and the fluid-compute default on every plan; raise it
/// on a plan that allows more rather than lowering what the turn is allowed to
/// take.
export const maxDuration = 300;

function handler(req: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ headers: req.headers }),
    onError({ path, error }) {
      console.error(`tRPC failed on ${path ?? "<no-path>"}:`, error.message);
    },
  });
}

export { handler as GET, handler as POST };
