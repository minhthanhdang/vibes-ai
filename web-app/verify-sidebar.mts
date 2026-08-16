import { createHash } from "node:crypto";
import { db } from "@/server/db";

const TOKEN = "verify-sidebar-token";
const id = createHash("sha256").update(TOKEN).digest("hex");
const mode = process.argv[2];

if (mode === "seed") {
  const project = await db.project.findFirst({ orderBy: { createdAt: "desc" } });
  if (!project) throw new Error("no project to open");
  await db.session.create({
    data: {
      id,
      userId: project.userId,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  console.log(JSON.stringify({ projectId: project.id, token: TOKEN }));
} else {
  await db.session.deleteMany({ where: { id } });
  console.log("cleaned");
}
