import { redirect } from "next/navigation";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { getQueryClient, trpc } from "@/trpc/server";
import { currentUser } from "@/server/auth/session";
import { ProjectList } from "./project-list";
import { SiteHeader } from "../site-header";

export default async function ProjectsPage() {
  if (!(await currentUser())) redirect("/signin?next=/projects");

  const queryClient = getQueryClient();
  await queryClient.prefetchQuery(trpc.project.list.queryOptions({ limit: 20 }));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <HydrationBoundary state={dehydrate(queryClient)}>
          <ProjectList />
        </HydrationBoundary>
      </main>
    </>
  );
}
