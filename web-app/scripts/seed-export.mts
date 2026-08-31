import { config } from "dotenv";
import { writeFile } from "node:fs/promises";

import { closeDb, db } from "../src/server/db";
import { copyObject, parseGcsUri } from "../src/server/google/storage";
import { SEED_PREFIX, type SeedManifest, type SeedReference } from "../src/server/seed/seed-manifest";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

function flag(name: string) {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const projectId = flag("project");
const slug = flag("slug");
const apply = process.argv.includes("--apply");

if (!projectId || !slug) {
  console.error("usage: npm run seed:export -- --project <projectId> --slug <slug> [--apply]");
  process.exit(1);
}

function slugified(title: string, fallback: number) {
  const stem = title.replace(/\.[a-z0-9]+$/i, "");
  const cleaned = stem
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || `image-${fallback}`;
}

function extensionOf(gcsUri: string) {
  return gcsUri.split(".").pop()?.toLowerCase() ?? "png";
}

async function copyInto(gcsUri: string, object: string) {
  const { object: source } = parseGcsUri(gcsUri);
  if (source === object) return object;
  if (apply) await copyObject(source, object);
  return object;
}

try {
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { title: true, brief: true },
  });

  const originals = await db.reference.findMany({
    where: { projectId, sourceReferenceId: null },
    orderBy: { createdAt: "asc" },
    select: {
      gcsUri: true,
      thumbGcsUri: true,
      title: true,
      width: true,
      height: true,
      contentHash: true,
      origin: true,
      generationPrompt: true,
      analysis: {
        select: {
          title: true,
          colorPalette: true,
          lighting: true,
          texture: true,
          composition: true,
          subject: true,
          contrastDepth: true,
          rationale: true,
          model: true,
        },
      },
    },
  });

  const taken = new Set<string>();
  const references: SeedReference[] = [];

  for (const [index, original] of originals.entries()) {
    let name = slugified(original.title, index);
    while (taken.has(name)) name = `${name}-${index}`;
    taken.add(name);

    const prefix = `${SEED_PREFIX}${slug}/`;
    references.push({
      object: await copyInto(original.gcsUri, `${prefix}${name}.${extensionOf(original.gcsUri)}`),
      thumbObject: original.thumbGcsUri
        ? await copyInto(original.thumbGcsUri, `${prefix}${name}-thumb.${extensionOf(original.thumbGcsUri)}`)
        : null,
      title: original.title,
      width: original.width,
      height: original.height,
      contentHash: original.contentHash,
      origin: original.origin,
      generationPrompt: original.generationPrompt,
      analysis: original.analysis,
    });
    console.log(`${apply ? "copied" : "would copy"}  ${references[references.length - 1].object}`);
  }

  const manifest: SeedManifest = {
    slug,
    title: project.title,
    brief: project.brief,
    references,
  };

  const path = `src/server/seed/${slug}.json`;
  if (apply) await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\n${apply ? "wrote" : "would write"} ${path} — ${references.length} references`);
  if (!apply) console.log("re-run with --apply to copy the objects and write the manifest");
} finally {
  await closeDb();
}
