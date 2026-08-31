import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const { bucketName, developing, devSignupTier } = await import("../src/env");
const { closeDb, db } = await import("../src/server/db");
const { saveObject } = await import("../src/server/google/storage");
const { hashPassword } = await import("../src/server/auth/password");
const { contentTypeOfUri, IMMUTABLE_CACHE_CONTROL } = await import("../src/lib/intake/image-types");
const {
  ProjectOwnershipError,
  counted,
  objectPathsIn,
  prodUrisRemaining,
  readProject,
  removeProject,
  rewritten,
  writeProject,
} = await import("../src/server/seed/copy-project");
const { prodSource, readProdConfig } = await import("./prod-source.mjs");

const USAGE = `usage: APP_ENV=development npm run seed:from-prod -- \\
  --project <prodProjectId> --owner-email <owner@…> --as <me@dev> \\
  [--password <pw>] [--with-chats] [--with-renders] [--reset] [--apply]`;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const projectId = flag("project");
const ownerEmail = flag("owner-email");
const asEmail = flag("as");
const password = flag("password");
const withChats = args.includes("--with-chats");
const withRenders = args.includes("--with-renders");
const reset = args.includes("--reset");
const apply = args.includes("--apply");

if (!projectId || !ownerEmail || !asEmail) {
  console.error(USAGE);
  process.exit(1);
}

if (!developing()) {
  console.error("this copies production down into a development database — run it under APP_ENV=development");
  process.exit(1);
}
const tier = devSignupTier() ?? "TIER_1";

const said = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const prod = await prodSource(readProdConfig());

try {
  const read = await readProject(prod.db, projectId, ownerEmail, { withChats });
  const copy = rewritten(read, prod.bucket, bucketName());

  const remaining = prodUrisRemaining(copy, prod.bucket);
  if (remaining.length) {
    console.error(`${remaining.length} uris still name ${prod.bucket} — refusing a half-rewritten copy:`);
    for (const uri of remaining.slice(0, 10)) console.error(`  ${uri}`);
    process.exit(1);
  }

  const objects = objectPathsIn(read, prod.bucket).filter(
    (objectPath) => withRenders || !objectPath.includes("/boards/"),
  );

  console.log(`project ${projectId} owned by ${ownerEmail}, copying to ${asEmail} at ${tier}`);
  console.log(Object.entries(counted(copy)).map(([model, n]) => `  ${model}: ${n}`).join("\n"));
  console.log(`  objects: ${objects.length}`);
  if (withChats) {
    console.log("  --with-chats: conversations and messages carry the user's own words across");
  }

  if (!apply) {
    console.log("\ndry run — nothing written. Add --apply.");
  } else {
    if (reset) await removeProject(db, projectId);

    const user =
      (await db.user.findUnique({ where: { email: asEmail }, select: { id: true } })) ??
      (await db.user.create({
        data: {
          email: asEmail,
          tier,
          ...(password ? { passwordHash: await hashPassword(password) } : {}),
        },
        select: { id: true },
      }));

    let copied = 0;
    let missed = 0;
    for (const objectPath of objects) {
      try {
        const bytes = await prod.read(objectPath);
        await saveObject(objectPath, bytes, {
          contentType: contentTypeOfUri(objectPath) ?? "application/octet-stream",
          ...(objectPath.includes("/references/") && { cacheControl: IMMUTABLE_CACHE_CONTROL }),
        });
        copied += 1;
      } catch (cause) {
        missed += 1;
        console.error(`  ${objectPath}: not copied — ${said(cause)}`);
      }
    }
    console.log(`objects: ${copied} copied, ${missed} missed`);

    const wrote = await writeProject(db, copy, { userId: user.id, withRenders });
    console.log(Object.entries(wrote).map(([model, n]) => `  ${model}: ${n}`).join("\n"));
    console.log(`\nsigned in as ${asEmail}, project ${projectId} is there.`);
  }
} catch (cause) {
  if (cause instanceof ProjectOwnershipError) console.error(said(cause));
  else console.error(cause);
  process.exitCode = 1;
} finally {
  await prod.close();
  await closeDb();
}
