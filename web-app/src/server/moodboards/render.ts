import "server-only";
import { bucketName } from "@/env";
import { copyObject, deleteObject, signedUploadUrl } from "@/server/google/storage";
import {
  BOARD_RENDER_CONTENT_TYPE,
  boardRenderObjectPath,
  pageRenderObjectPath,
} from "@/lib/scene/moodboard-render";

export function boardRenderGcsUri(projectId: string, boardId: string) {
  return `gs://${bucketName()}/${boardRenderObjectPath(projectId, boardId)}`;
}

export function boardRenderUploadUrl(projectId: string, boardId: string) {
  return signedUploadUrl(boardRenderObjectPath(projectId, boardId), BOARD_RENDER_CONTENT_TYPE);
}

export function pageRenderGcsUri(
  projectId: string,
  boardId: string,
  pageId: string,
  revision: number,
) {
  return `gs://${bucketName()}/${pageRenderObjectPath(projectId, boardId, pageId, revision)}`;
}

export function pageRenderUploadUrl(
  projectId: string,
  boardId: string,
  pageId: string,
  revision: number,
) {
  return signedUploadUrl(
    pageRenderObjectPath(projectId, boardId, pageId, revision),
    BOARD_RENDER_CONTENT_TYPE,
  );
}

export async function copyBoardRender(
  projectId: string,
  sourceBoardId: string,
  targetBoardId: string,
) {
  await copyObject(
    boardRenderObjectPath(projectId, sourceBoardId),
    boardRenderObjectPath(projectId, targetBoardId),
  );
}

export async function deleteBoardRender(projectId: string, boardId: string) {
  await deleteObject(boardRenderObjectPath(projectId, boardId));
}
