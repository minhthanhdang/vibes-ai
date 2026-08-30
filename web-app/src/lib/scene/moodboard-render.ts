import type { AutosaveStatus } from "@/lib/scene/moodboard-autosave";

export const BOARD_RENDER_MAX_DIMENSION = 1600;

export const BOARD_RENDER_PADDING = 24;

export const BOARD_RENDER_CONTENT_TYPE = "image/png";

export const BOARD_RENDER_DELAY_MS = 20_000;

export function boardRenderObjectPath(projectId: string, boardId: string) {
  return `projects/${projectId}/boards/${boardId}/render.png`;
}

export function pageRenderObjectPath(
  projectId: string,
  boardId: string,
  pageId: string,
  revision: number,
) {
  return `projects/${projectId}/boards/${boardId}/pages/${pageId}@${revision}.png`;
}

export function boardRenderIsCurrent(board: {
  renderUri: string | null;
  renderRevision: number | null;
  revision: number;
}) {
  return board.renderUri !== null && board.renderRevision === board.revision;
}

export type BoardRenderNeed = {
  status: AutosaveStatus;
  revision: number;
  renderedRevision: number | null;
  attemptedRevision: number | null;
  elementCount: number;
};

export function boardRenderNeeded({
  status,
  revision,
  renderedRevision,
  attemptedRevision,
  elementCount,
}: BoardRenderNeed) {
  if (status !== "idle") return false;
  if (elementCount === 0) return false;
  if (renderedRevision === revision) return false;
  return attemptedRevision !== revision;
}

export const MODEL_RENDER_PREFIX = "renders/";

export const MODEL_RENDER_LIFECYCLE_DAYS = 7;

export const MODEL_RENDER_DIALECT = "910f1230";

export function modelPageRenderObjectPath(pageId: string, revision: number) {
  return `${MODEL_RENDER_PREFIX}${MODEL_RENDER_DIALECT}/pages/${pageId}@${revision}.png`;
}

export function modelBoardRenderObjectPath(boardId: string, revision: number) {
  return `${MODEL_RENDER_PREFIX}${MODEL_RENDER_DIALECT}/boards/${boardId}@${revision}.png`;
}
