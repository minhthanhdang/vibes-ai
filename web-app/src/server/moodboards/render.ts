import "server-only";
import { env } from "@/env";
import { bucket, signedUploadUrl } from "@/server/google/storage";
import { BOARD_RENDER_CONTENT_TYPE, boardRenderObjectPath } from "@/lib/moodboard-render";

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

/// Deleting the board is what makes the picture unreachable; this is what stops
/// us paying to store it. Best effort — a board whose row is gone and whose
/// object is not is an orphan, not a defect the director can see.
export async function deleteBoardRender(projectId: string, boardId: string) {
  await bucket().file(boardRenderObjectPath(projectId, boardId)).delete({ ignoreNotFound: true });
}
