import { db } from "@/server/db";
import { createCaller } from "@/server/api/root";
import { bucket } from "@/server/google/storage";

const project = await db.project.findFirst({ select: { id: true, userId: true } });
if (!project) throw new Error("no project to verify against");

const caller = createCaller({ db, headers: new Headers(), user: { id: project.userId } });
const objectOf = (uri: string) => uri.slice(`gs://${process.env.GCS_BUCKET}/`.length);
const exists = async (uri: string) => (await bucket().file(objectOf(uri)).exists())[0];

async function put(contentType: string) {
  const { url, gcsUri } = await caller.reference.uploadUrl({ projectId: project!.id, contentType });
  const response = await fetch(url, {
    method: "PUT",
    body: new Blob([new Uint8Array([1, 2, 3])], { type: contentType }),
    headers: { "Content-Type": contentType },
  });
  if (!response.ok) throw new Error(`PUT failed ${response.status}`);
  return gcsUri;
}

// 1. abandoned upload + its thumbnail
const orphan = await put("image/png");
const orphanThumb = await put("image/jpeg");
console.log("uploaded:", await exists(orphan), await exists(orphanThumb));
console.log("discard:", await caller.reference.discardUpload({
  projectId: project.id,
  gcsUris: [orphan, orphanThumb],
}));
console.log("after discard (want false false):", await exists(orphan), await exists(orphanThumb));

// 2. an object a live row points at
const live = await put("image/png");
const reference = await caller.reference.add({ projectId: project.id, gcsUri: live, title: "live" });
console.log("live discard:", await caller.reference.discardUpload({
  projectId: project.id,
  gcsUris: [live],
}));
console.log("live object survives (want true):", await exists(live));

// 3. another project's prefix
console.log("foreign discard:", await caller.reference.discardUpload({
  projectId: project.id,
  gcsUris: [`gs://${process.env.GCS_BUCKET}/projects/other/references/a.png`],
}));

await caller.reference.remove({ id: reference.id });
console.log("cleanup, live object gone (want false):", await exists(live));
await db.$disconnect();
