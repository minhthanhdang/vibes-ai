export function boardRenderPath(id: string, renderRevision: number) {
  return `/api/moodboards/${id}/render?r=${renderRevision}`;
}
