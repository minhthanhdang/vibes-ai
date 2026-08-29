import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

const { createCallerFactory } = await import("../src/server/api/trpc");
const { vibesRouter } = await import("../src/server/api/routers/vibes");
const { db, closeDb } = await import("../src/server/db");
const { persistableElements } = await import("../src/lib/scene/moodboard-scene");
const { boardPages, pagesInReadingOrder } = await import("../src/lib/pages/board-pages");
const { isPageBackground } = await import("../src/lib/pages/page-background");
const { canvasRead } = await import("../src/lib/canvas-objects/object-read");

const projectId = "cmtdtvbj10000lirvp8cwkxr4";
const project = await db.project.findUniqueOrThrow({
  where: { id: projectId },
  select: { userId: true },
});
const user = await db.user.findUniqueOrThrow({
  where: { id: project.userId },
  select: { id: true, email: true, name: true, imageUrl: true },
});

const conversationsBefore = await db.conversation.count({ where: { projectId } });
console.log(`conversations on this project before: ${conversationsBefore}`);

const vibes = createCallerFactory(vibesRouter)({ db, headers: new Headers(), user });
const { boards } = await vibes.startBatch({
  projectId,
  forms: [
    {
      purpose: "a three-page dinner menu for a candlelit trattoria",
      pages: 3,
      palette: ["#2E1A12", "#E8D9C0", "#B5442A"],
      vibes: "warm, candlelit, unfussy",
      preset: "PORTRAIT_HD",
      designs: 1,
    },
  ],
});

const made = boards[0]!;
console.log(`board ${made.boardId} — ${made.title} — ${made.pageIds.length} pages`);

const row = await db.moodboard.findUniqueOrThrow({
  where: { id: made.boardId },
  select: { elements: true, conversationId: true },
});
const elements = persistableElements(row.elements);
const pages = pagesInReadingOrder(boardPages(elements));

console.log(`\n--- BEFORE THE WORKER ---`);
console.log(`Moodboard.conversationId: ${row.conversationId ?? "null"}`);
console.log(`conversations on this project now: ${await db.conversation.count({ where: { projectId } })}`);
console.log(`pages: ${pages.length}`);
console.log(`page-background elements: ${elements.filter((e) => isPageBackground(e)).length}`);
const read = canvasRead(elements);
console.log(
  `canvas read: ${read?.objects.map((o) => `${o.kind}(bg=${JSON.stringify((o as { background?: unknown }).background)})`).join(", ")}`,
);
console.log(`\nBOARD_ID=${made.boardId}`);
await closeDb();
