import { notFound, redirect } from "next/navigation";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { getQueryClient, trpc } from "@/trpc/server";
import { currentUser } from "@/server/auth/session";
import { ProjectWorkspace } from "./_workspace/components/project-workspace";

export default async function ProjectPage(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;
  if (!(await currentUser())) redirect(`/signin?next=/projects/${id}`);

  const queryClient = getQueryClient();
  const project = await queryClient
    .fetchQuery(trpc.project.byId.queryOptions({ id }))
    .catch(() => null);
  if (!project) notFound();

  /// Both lists the workspace paints from, so the column and the grid arrive in
  /// one round trip. The threads are here rather than in the column because the
  /// column resolves which one is open before it can ask for its messages, and a
  /// waterfall of two fetches is two frames of an empty sidebar.
  await Promise.all([
    queryClient.prefetchQuery(trpc.reference.listByProject.queryOptions({ projectId: id })),
    queryClient.prefetchQuery(trpc.chat.conversations.queryOptions({ projectId: id })),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProjectWorkspace projectId={id} title={project.title} brief={project.brief} />
    </HydrationBoundary>
  );
}
