import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync, mkdirSync } from "node:fs";
const { db } = await import("./src/server/db");
const { persistableElements } = await import("./src/lib/scene/moodboard-scene");
const { boardPages, pagesInReadingOrder } = await import("./src/lib/pages/board-pages");
const { readObject } = await import("./src/server/google/storage");
const { RENDER_SOURCE_BYTE_LIMIT, renderForModel } = await import(
  "./src/server/render/for-model"
);
const boardId = "cmtcep3ba0002r0rvxy76m8d7";
const after = await db.moodboard.findUniqueOrThrow({
  where: { id: boardId },
  select: { title: true, elements: true, appState: true },
});
const pages = pagesInReadingOrder(boardPages(persistableElements(after.elements)));
mkdirSync("tmp-takes", { recursive: true });
for (const [i, page] of pages.entries()) {
  const drawn = await renderForModel({ boardId, pageId: page.id, scene: after });
  if ("failed" in drawn) { console.log(`page ${i + 1}: ${drawn.reason}`); continue; }
  writeFileSync(`tmp-takes/board-1-page-${i + 1}.png`, await readObject(drawn.uri, RENDER_SOURCE_BYTE_LIMIT));
  console.log(`wrote tmp-takes/board-1-page-${i + 1}.png`);
}
process.exit(0);
