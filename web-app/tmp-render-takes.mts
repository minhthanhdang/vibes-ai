import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const { db } = await import("./src/server/db");
const { persistableElements } = await import("./src/lib/scene/moodboard-scene");
const { boardPages, pagesInReadingOrder } = await import("./src/lib/pages/board-pages");
const { readObject } = await import("./src/server/google/storage");
const { RENDER_SOURCE_BYTE_LIMIT, renderForModel } = await import(
  "./src/server/render/for-model"
);

const boardIds = ["cmtcep3ba0002r0rvxy76m8d7", "cmtcep4i30006r0rv31j3khdu"];
const out = "tmp-takes";
mkdirSync(out, { recursive: true });

for (const [take, boardId] of boardIds.entries()) {
  const after = await db.moodboard.findUniqueOrThrow({
    where: { id: boardId },
    select: { title: true, revision: true, elements: true, appState: true },
  });
  const elements = persistableElements(after.elements);
  const drawnPages = pagesInReadingOrder(boardPages(elements));
  console.log(`board ${take + 1} "${after.title}": ${drawnPages.length} pages`);
  for (const [order, page] of drawnPages.entries()) {
    const drawn = await renderForModel({ boardId, pageId: page.id, scene: after });
    if ("failed" in drawn) {
      console.log(`  page ${order + 1} not drawn: ${drawn.reason}`);
      continue;
    }
    const file = join(out, `board-${take + 1}-page-${order + 1}.png`);
    writeFileSync(file, await readObject(drawn.uri, RENDER_SOURCE_BYTE_LIMIT));
    console.log(`  wrote ${file}`);
  }
}
process.exit(0);
