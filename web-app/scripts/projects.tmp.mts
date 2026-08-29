import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
const { db, closeDb } = await import("../src/server/db");
const rows = await db.project.findMany({
  select: { id: true, title: true, _count: { select: { references: true } } },
  orderBy: { updatedAt: "desc" },
  take: 10,
});
for (const r of rows) console.log(r.id, `${r._count.references} refs`, r.title);
await closeDb();
