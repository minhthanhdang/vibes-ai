import { boardPages } from "@/lib/pages/board-pages";
import type { Prisma } from "@/generated/prisma/client";

/// The two columns a board's scene is written as, always together.
///
/// `Moodboard.pageCount` is derived from `elements` and is only true while the
/// two are written in the same statement — a scene write that forgot it would
/// leave the row saying a spread is one page, which is exactly the lie the
/// priming would then tell the model. So there is no way to write the scene
/// without it: every `data:` in this app spreads this instead of naming
/// `elements`, and the count is taken from the array actually being stored
/// rather than from anything the caller believes about it.
///
/// The cast is the one Prisma forces on a `Json` column and is what this
/// replaces at eleven call sites, so it is written here once.
export function sceneWrite(elements: readonly unknown[]) {
  return {
    elements: elements as unknown as Prisma.InputJsonValue,
    pageCount: boardPages(elements).length,
  };
}
