import { isFrameElement, pageHolding } from "@/lib/pages/board-pages";
import type { BoardPage } from "@/lib/pages/board-pages";
import type { AutosaveStatus } from "@/lib/scene/moodboard-autosave";

export type PagePicture = {
  boardId: string;
  pageId: string;
  revision: number;
  renderUri: string;
};

export function pagesToPicture<T extends { boardId: string }>(
  picked: readonly T[],
  openBoardId: string | null,
): T[] {
  if (!openBoardId) return [];
  return picked.filter((page) => page.boardId === openBoardId);
}

export function pictureIsOfStoredScene(status: AutosaveStatus) {
  return status === "idle";
}

export const PICTURE_ATTEMPTS = 2;

export function sceneStillMoving(status: AutosaveStatus) {
  return status === "pending" || status === "saving";
}

export function boardMovedUnderPicture(cause: unknown) {
  return codeOf(cause) === "CONFLICT";
}

function codeOf(cause: unknown) {
  if (typeof cause !== "object" || cause === null) return null;
  const data = (cause as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export async function pagePicture({
  flush,
  saved,
  draw,
}: {
  flush: () => Promise<void>;
  saved: () => { status: AutosaveStatus; revision: number };
  draw: (revision: number) => Promise<PagePicture | null>;
}): Promise<PagePicture | null> {
  for (let attempt = 1; attempt <= PICTURE_ATTEMPTS; attempt += 1) {
    const lastTry = attempt === PICTURE_ATTEMPTS;

    await flush();
    const { status, revision } = saved();
    if (!pictureIsOfStoredScene(status)) {
      if (lastTry || !sceneStillMoving(status)) return null;
      continue;
    }

    try {
      return await draw(revision);
    } catch (cause) {
      if (!boardMovedUnderPicture(cause)) throw cause;
      if (lastTry) return null;
    }
  }
  return null;
}

export function pageExportElements<
  T extends {
    type?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    frameId?: string | null;
  },
>(elements: readonly T[], page: BoardPage): T[] {
  return elements.map((element) =>
    !isFrameElement(element) &&
    element.frameId !== page.id &&
    pageHolding([page], element)?.id === page.id
      ? Object.assign({}, element, { frameId: page.id })
      : element,
  );
}
