import "server-only";
import { env } from "@/env";
import { bucket, signedUploadUrl } from "@/server/google/storage";
import {
  BOARD_RENDER_CONTENT_TYPE,
  boardRenderObjectPath,
  pageRenderObjectPath,
} from "@/lib/scene/moodboard-render";

/// Where a board's picture lives. Unlike a reference's bytes, the locator is not
/// client input and never round-trips through the browser: the object path is
/// derived from the ids the server already checked, so the PUT the browser makes
/// can only land on the board it was signed for.
export function boardRenderGcsUri(projectId: string, boardId: string) {
  return `gs://${env().GCS_BUCKET}/${boardRenderObjectPath(projectId, boardId)}`;
}

/// The bytes go browser → GCS like a reference's, and for the same reason: a
/// 1600px PNG of a full board is past the request body limit a function accepts,
/// and there is nothing the server would do with it on the way past.
export function boardRenderUploadUrl(projectId: string, boardId: string) {
  return signedUploadUrl(boardRenderObjectPath(projectId, boardId), BOARD_RENDER_CONTENT_TYPE);
}

/// Where the picture of a page attached to a message lives, and the uri the model
/// is handed as a file part. Derived rather than taken from the browser: the
/// message carries one back, and what that uri is *for* is saying that the upload
/// happened — pointing the model at an object is the server's own decision.
export function pageRenderGcsUri(
  projectId: string,
  boardId: string,
  pageId: string,
  revision: number,
) {
  return `gs://${env().GCS_BUCKET}/${pageRenderObjectPath(projectId, boardId, pageId, revision)}`;
}

/// A duplicated board starts life with its source's scene, so it can start with
/// its source's picture too — copied inside the bucket rather than re-rendered,
/// since the only place a board can be drawn is a tab that has it open, and the
/// copy is not open yet. Best effort: a failed copy leaves the new board without
/// a preview until it is opened, which is exactly what a new board has anyway.
export async function copyBoardRender(
  projectId: string,
  sourceBoardId: string,
  targetBoardId: string,
) {
  const files = bucket();
  await files
    .file(boardRenderObjectPath(projectId, sourceBoardId))
    .copy(files.file(boardRenderObjectPath(projectId, targetBoardId)));
}

/// Deleting the board is what makes the picture unreachable; this is what stops
/// us paying to store it. Best effort — a board whose row is gone and whose
/// object is not is an orphan, not a defect the director can see.
export async function deleteBoardRender(projectId: string, boardId: string) {
  await bucket().file(boardRenderObjectPath(projectId, boardId)).delete({ ignoreNotFound: true });
}
