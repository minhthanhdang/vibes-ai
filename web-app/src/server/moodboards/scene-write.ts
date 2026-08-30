import { boardPages, pagesInReadingOrder } from "@/lib/pages/board-pages";
import type { Prisma } from "@/generated/prisma/client";

export function sceneWrite(elements: readonly unknown[]) {
  const pages = pagesInReadingOrder(boardPages(elements));
  return {
    elements: elements as unknown as Prisma.InputJsonValue,
    pageCount: pages.length,
    pageNames: pages.map((page) => page.name),
  };
}
