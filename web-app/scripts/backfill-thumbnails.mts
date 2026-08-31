import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const { closeDb, db } = await import("../src/server/db");
const { CUT_SOURCE_BYTE_LIMIT, thumbnailOf } = await import("../src/server/references/cut");
const { attachReferenceThumbnail } = await import("../src/server/references/thumbnail-queue");
const { deleteProjectUpload, storeProjectUpload, uploadObjectPath } = await import(
  "../src/server/references/upload"
);
const { objectHead, readObject, setObjectCacheControl } = await import(
  "../src/server/google/storage"
);
const { needsDerivedCopy } = await import("../src/lib/intake/reference-derived");
const { IMMUTABLE_CACHE_CONTROL } = await import("../src/lib/intake/image-types");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const flagged = args.indexOf("--project");
const projectId = flagged >= 0 ? args[flagged + 1] : undefined;

const deps = { db, thumbnailOf, storeUpload: storeProjectUpload, deleteUpload: deleteProjectUpload };

const PAGE = 100;

async function* pages<T extends { id: string }>(
  fetch: (cursor: string | undefined) => Promise<T[]>,
) {
  let cursor: string | undefined;
  for (;;) {
    const rows = await fetch(cursor);
    if (!rows.length) return;
    cursor = rows[rows.length - 1].id;
    yield* rows;
  }
}

const said = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

async function thumbnailPass() {
  const tally = { owed: 0, attached: 0, unneeded: 0, lost: 0, skipped: 0, failed: 0 };

  const rows = pages((cursor) =>
    db.reference.findMany({
      where: { thumbGcsUri: null, ...(projectId && { projectId }) },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      select: { id: true, projectId: true, gcsUri: true, width: true, height: true },
    }),
  );

  for await (const row of rows) {
    if (!needsDerivedCopy({ width: row.width, height: row.height, hasThumbnail: false })) continue;
    tally.owed += 1;
    if (!apply) continue;

    let bytes;
    try {
      bytes = await readObject(row.gcsUri, CUT_SOURCE_BYTE_LIMIT);
    } catch (cause) {
      tally.skipped += 1;
      console.error(`  ${row.id}: could not read ${row.gcsUri} — ${said(cause)}`);
      continue;
    }

    try {
      const outcome = await attachReferenceThumbnail(deps, {
        projectId: row.projectId,
        referenceId: row.id,
        bytes,
      });
      tally[outcome] += 1;
    } catch (cause) {
      if (/decode|unsupported|input/i.test(said(cause))) {
        tally.skipped += 1;
        console.error(`  ${row.id}: not a decodable image — ${said(cause)}`);
      } else {
        tally.failed += 1;
        console.error(`  ${row.id}: attach failed — ${said(cause)}`);
      }
    }
  }

  console.log(
    apply
      ? `thumbnails: ${tally.owed} owed — ${tally.attached} attached, ${tally.unneeded} unneeded, ${tally.lost} lost, ${tally.skipped} skipped, ${tally.failed} failed`
      : `thumbnails: ${tally.owed} owed`,
  );
  return tally.failed;
}

async function cacheControlPass() {
  const tally = { already: 0, set: 0, skipped: 0, failed: 0 };
  const seen = new Set<string>();

  const rows = pages((cursor) =>
    db.reference.findMany({
      ...(projectId && { where: { projectId } }),
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      select: { id: true, projectId: true, gcsUri: true, thumbGcsUri: true },
    }),
  );

  for await (const row of rows) {
    for (const gcsUri of [row.gcsUri, row.thumbGcsUri]) {
      if (!gcsUri || seen.has(gcsUri)) continue;
      seen.add(gcsUri);

      const objectPath = uploadObjectPath(row.projectId, gcsUri);
      if (!objectPath) {
        tally.skipped += 1;
        continue;
      }

      try {
        const head = await objectHead(objectPath);
        if (!head) throw new Error("no such object");
        if (head.cacheControl === IMMUTABLE_CACHE_CONTROL) {
          tally.already += 1;
          continue;
        }
        if (apply) await setObjectCacheControl(objectPath, IMMUTABLE_CACHE_CONTROL);
        tally.set += 1;
      } catch (cause) {
        tally.failed += 1;
        console.error(`  ${gcsUri}: metadata pass failed — ${said(cause)}`);
      }
    }
  }

  console.log(
    `cache-control: ${tally.already} already set, ${tally.set} ${apply ? "set" : "to set"}, ${tally.skipped} skipped, ${tally.failed} failed`,
  );
  return tally.failed;
}

try {
  const failed = (await thumbnailPass()) + (await cacheControlPass());
  if (!apply) console.log("\ndry-run — re-run with -- --apply to write");
  if (failed) process.exit(1);
} finally {
  await closeDb();
}
