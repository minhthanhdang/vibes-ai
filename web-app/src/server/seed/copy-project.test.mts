import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";

const {
  ProjectOwnershipError,
  objectPathsIn,
  prodUrisRemaining,
  readProject,
  rewriteDeep,
  rewriteUri,
  rewritten,
  writeProject,
} = await import("@/server/seed/copy-project");

type Copied = Parameters<typeof rewritten>[0];

const PROD = "mtd-hackathons-artifacts";
const DEV = "vibes-dev-local";

const REFERENCE_OBJECT = "projects/p1/references/a1b2.jpg";
const BOARD_OBJECT = "projects/p1/boards/b1/render.png";

function reference(id: string, sourceReferenceId: string | null = null) {
  return {
    id,
    projectId: "p1",
    gcsUri: `gs://${PROD}/projects/p1/references/${id}.jpg`,
    thumbGcsUri: null,
    sourceReferenceId,
  };
}

function copied(overrides: Partial<Copied> = {}): Copied {
  return {
    project: {
      id: "p1",
      userId: "prod-user",
      title: "A project",
      brief: "",
      libraryItems: [{ files: { "ref:r1": { url: `gs://${PROD}/${REFERENCE_OBJECT}` } } }],
    },
    references: [reference("r1")],
    analyses: [{ id: "a1", referenceId: "r1" }],
    crops: [{ id: "c1", referenceId: "r1", gcsUri: `gs://${PROD}/${REFERENCE_OBJECT}` }],
    moodboards: [
      {
        id: "b1",
        projectId: "p1",
        renderUri: `gs://${PROD}/${BOARD_OBJECT}`,
        renderRevision: 3,
        conversationId: "conv1",
        elements: [{ type: "image", fileId: "ref:r1" }],
        appState: { viewBackgroundColor: "#fff" },
        layoutSlots: null,
        vibesBrief: null,
      },
    ],
    tiles: [{ id: "t1", moodboardId: "b1", cropId: "c1" }],
    conversations: [{ id: "conv1", projectId: "p1" }],
    messages: [
      {
        id: "m1",
        seq: 7,
        conversationId: "conv1",
        parts: [{ fileData: { fileUri: `gs://${PROD}/${REFERENCE_OBJECT}`, mimeType: "image/jpeg" } }],
      },
    ],
    ...overrides,
  } as unknown as Copied;
}

test("only the bucket segment moves — the object path is the same on both sides", () => {
  assert.equal(
    rewriteUri(`gs://${PROD}/${REFERENCE_OBJECT}`, PROD, DEV),
    `gs://${DEV}/${REFERENCE_OBJECT}`,
  );
});

test("a uri in a bucket that is not the one being copied from is left alone", () => {
  assert.equal(rewriteUri("gs://someone-elses/seed/a.png", PROD, DEV), "gs://someone-elses/seed/a.png");
  assert.equal(rewriteUri("https://example.test/a.png", PROD, DEV), "https://example.test/a.png");
  assert.equal(rewriteUri("not a uri", PROD, DEV), "not a uri");
});

test("a uri buried in a scene is swept too, wherever in the JSON it sits", () => {
  const scene = { a: [{ b: { c: `gs://${PROD}/x.png` } }], n: 3, z: null };
  assert.deepEqual(rewriteDeep(scene, PROD, DEV), {
    a: [{ b: { c: `gs://${DEV}/x.png` } }],
    n: 3,
    z: null,
  });
});

test("nothing of the production bucket survives the rewrite, in a column or in a scene", () => {
  const copy = rewritten(copied(), PROD, DEV);
  assert.deepEqual(prodUrisRemaining(copy, PROD), []);
  assert.equal(copy.references[0].gcsUri.startsWith(`gs://${DEV}/`), true);
  assert.equal(copy.crops[0].gcsUri.startsWith(`gs://${DEV}/`), true);
  assert.equal(copy.moodboards[0].renderUri?.startsWith(`gs://${DEV}/`), true);
});

test("a half-rewritten copy is visible as the uris it still carries", () => {
  const half = copied();
  const copy = { ...rewritten(half, PROD, DEV), crops: half.crops };
  assert.deepEqual(prodUrisRemaining(copy, PROD), [`gs://${PROD}/${REFERENCE_OBJECT}`]);
});

test("the objects to copy are the paths under the production bucket, deduplicated", () => {
  const paths = objectPathsIn(copied(), PROD);
  assert.deepEqual(
    [...paths].sort(),
    [BOARD_OBJECT, REFERENCE_OBJECT, "projects/p1/references/r1.jpg"].sort(),
  );
  assert.equal(new Set(paths).size, paths.length);
});

function fakeSource(project: unknown) {
  const empty = { findMany: async () => [] };
  return {
    project: {
      findUnique: async () => project,
      findUniqueOrThrow: async () => project,
    },
    reference: empty,
    analysis: empty,
    crop: empty,
    moodboard: empty,
    moodboardTile: empty,
    conversation: empty,
    chatMessage: empty,
  } as unknown as Parameters<typeof readProject>[0];
}

test("a project id that is not the caller's is refused before a single row is read", async () => {
  const client = fakeSource({ id: "p1", user: { email: "someone@else.test" } });
  await assert.rejects(
    () => readProject(client, "p1", "me@mine.test"),
    (cause: unknown) => cause instanceof ProjectOwnershipError,
  );
});

test("a project id that names nothing is refused the same way", async () => {
  await assert.rejects(
    () => readProject(fakeSource(null), "p1", "me@mine.test"),
    /no project p1/,
  );
});

function recordingClient() {
  const wrote: Record<string, unknown[]> = {};
  const record = (model: string) => ({
    create: async ({ data }: { data: unknown }) => void (wrote[model] ??= []).push(data),
    createMany: async ({ data }: { data: unknown[] }) => void ((wrote[model] ??= []).push(...data)),
    deleteMany: async () => ({ count: 0 }),
  });
  return {
    wrote,
    client: {
      project: record("project"),
      reference: record("reference"),
      analysis: record("analysis"),
      crop: record("crop"),
      moodboard: record("moodboard"),
      moodboardTile: record("tile"),
      conversation: record("conversation"),
      chatMessage: record("message"),
    } as unknown as Parameters<typeof writeProject>[0],
  };
}

test("the ids cross verbatim, because a scene addresses a reference by id", async () => {
  const { client, wrote } = recordingClient();
  await writeProject(client, rewritten(copied(), PROD, DEV), { userId: "dev-user" });

  assert.equal((wrote.project[0] as { id: string }).id, "p1");
  assert.equal((wrote.reference[0] as { id: string }).id, "r1");
  assert.equal((wrote.moodboard[0] as { id: string }).id, "b1");
});

test("the project is owned by the development account, not by whoever owns it in production", async () => {
  const { client, wrote } = recordingClient();
  await writeProject(client, rewritten(copied(), PROD, DEV), { userId: "dev-user" });
  assert.equal((wrote.project[0] as { userId: string }).userId, "dev-user");
});

test("a version is written after the reference it was cut out of", async () => {
  const copy = copied({
    references: [reference("crop-of-r1", "r1"), reference("r1")],
  } as Partial<Copied>);
  const { client, wrote } = recordingClient();
  await writeProject(client, rewritten(copy, PROD, DEV), { userId: "dev-user" });

  assert.deepEqual(
    wrote.reference.map((row) => (row as { id: string }).id),
    ["r1", "crop-of-r1"],
  );
});

test("a version whose source did not cross refuses rather than writing a broken project", async () => {
  const copy = copied({ references: [reference("crop-of-gone", "gone")] } as Partial<Copied>);
  const { client } = recordingClient();
  await assert.rejects(
    () => writeProject(client, rewritten(copy, PROD, DEV), { userId: "dev-user" }),
    /not whole/,
  );
});

test("a render that did not cross is nulled out, so the board re-renders rather than 404s", async () => {
  const { client, wrote } = recordingClient();
  await writeProject(client, rewritten(copied(), PROD, DEV), { userId: "dev-user" });

  const board = wrote.moodboard[0] as { renderUri: string | null; renderRevision: number | null };
  assert.equal(board.renderUri, null);
  assert.equal(board.renderRevision, null);
});

test("asking for renders keeps the board's own picture and its revision together", async () => {
  const { client, wrote } = recordingClient();
  await writeProject(client, rewritten(copied(), PROD, DEV), {
    userId: "dev-user",
    withRenders: true,
  });

  const board = wrote.moodboard[0] as { renderUri: string | null; renderRevision: number | null };
  assert.equal(board.renderUri, `gs://${DEV}/${BOARD_OBJECT}`);
  assert.equal(board.renderRevision, 3);
});

test("without chats a board keeps no thread, because the thread was not copied", async () => {
  const copy = copied({ conversations: [], messages: [] } as Partial<Copied>);
  const { client, wrote } = recordingClient();
  await writeProject(client, rewritten(copy, PROD, DEV), { userId: "dev-user" });

  assert.equal((wrote.moodboard[0] as { conversationId: string | null }).conversationId, null);
  assert.equal(wrote.conversation, undefined);
  assert.equal(wrote.message, undefined);
});

test("a copied message gives up its sequence number, which the database assigns", async () => {
  const { client, wrote } = recordingClient();
  await writeProject(client, rewritten(copied(), PROD, DEV), { userId: "dev-user" });

  const message = wrote.message[0] as Record<string, unknown>;
  assert.equal(message.id, "m1");
  assert.equal("seq" in message, false);
});
