import { boardPages, pagesInReadingOrder } from "@/lib/pages/board-pages";
import type { Prisma } from "@/generated/prisma/client";

/// The columns a board's scene is written as, always together.
///
/// `Moodboard.pageCount` and `pageNames` are derived from `elements` and are only
/// true while they are written in the same statement — a scene write that forgot
/// them would leave the row saying a spread is one page, or calling a page by a
/// name the user has since changed, which is exactly the lie the priming
/// would then tell the model. So there is no way to write the scene without them:
/// every `data:` in this app spreads this instead of naming `elements`, and both
/// are taken from the array actually being stored rather than from anything the
/// caller believes about it.
///
/// The names are in reading order, so the index of one is the page's ordinal, and
/// an unnamed page holds its place as "". Still not a second copy of the geometry
/// §V.1 refuses to store: a page's rectangle and contents stay in the frame, and
/// what a user can *say* is the one thing a column can carry.
///
/// The cast is the one Prisma forces on a `Json` column and is what this
/// replaces at eleven call sites, so it is written here once.
export function sceneWrite(elements: readonly unknown[]) {
  const pages = pagesInReadingOrder(boardPages(elements));
  return {
    elements: elements as unknown as Prisma.InputJsonValue,
    pageCount: pages.length,
    pageNames: pages.map((page) => page.name),
  };
}
