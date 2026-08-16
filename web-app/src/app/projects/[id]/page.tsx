import { notFound, redirect } from "next/navigation";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { getQueryClient, trpc } from "@/trpc/server";
import { currentUser } from "@/server/auth/session";
import { ProjectWorkspace } from "./project-workspace";

export default async function ProjectPage(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;
  if (!(await currentUser())) redirect(`/signin?next=/projects/${id}`);

  const queryClient = getQueryClient();
  const project = await queryClient
    .fetchQuery(trpc.project.byId.queryOptions({ id }))
    .catch(() => null);
  if (!project) notFound();

  await queryClient.prefetchQuery(trpc.reference.listByProject.queryOptions({ projectId: id }));

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProjectWorkspace projectId={id} title={project.title} brief={project.brief} />
    </HydrationBoundary>
  );
}
