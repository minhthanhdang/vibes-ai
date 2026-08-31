import { test } from "node:test";
import assert from "node:assert/strict";

import {
  exportBoardToSlides,
  type DeckExportDeps,
  type PageRenderRef,
} from "@/server/decks/deck-export";
import type { SlidesApi, SlidesRequest } from "@/server/decks/slides-api";
import { referenceFileId } from "@/lib/scene/moodboard-scene";

const pageFrame = (id: string, x: number) => ({
  id,
  type: "frame",
  x,
  y: 0,
  width: 1920,
  height: 1080,
  customData: { page: { preset: "LANDSCAPE_HD" } },
});

const picture = (id: string, referenceId: string, x: number) => ({
  id,
  type: "image",
  fileId: referenceFileId(referenceId),
  x,
  y: 100,
  width: 400,
  height: 400,
});

const board = {
  id: "board_1",
  projectId: "project_1",
  title: "Act two",
  revision: 7,
  elements: [
    pageFrame("p1", 0),
    pageFrame("p2", 3000),
    picture("i1", "ref_1", 100),
    picture("i2", "ref_2", 3100),
  ],
  appState: { viewBackgroundColor: "#101010" },
  previewOrder: ["p2", "p1"],
};

const analyses = [
  { referenceId: "ref_1", title: "Rain on glass", lighting: ["low-key"] },
  { referenceId: "ref_2", title: "Wet asphalt", texture: ["heavy-grain"] },
];

type Call = { name: string; presentationId?: string; requests?: readonly SlidesRequest[] };

function fakes(
  over: {
    credential?: DeckExportDeps["credential"];
    present?: (page: PageRenderRef) => Promise<boolean>;
    notesShapes?: () => Promise<Map<string, string>>;
    read?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  const created: Record<string, unknown>[] = [];

  const slidesApi: SlidesApi = {
    async create(title) {
      calls.push({ name: `create:${title}` });
      return { presentationId: "deck_1", firstSlideId: "default" };
    },
    async batchUpdate(presentationId, requests) {
      calls.push({ name: "batchUpdate", presentationId, requests });
    },
    notesShapes:
      over.notesShapes ??
      (async () => {
        calls.push({ name: "notesShapes" });
        return new Map([
          ["slide-0", "notes-0"],
          ["slide-1", "notes-1"],
        ]);
      }),
  };

  const deps: DeckExportDeps = {
    db: {
      moodboard: { findFirst: async () => board },
      analysis: { findMany: async () => (over.read === false ? [] : analyses) },
      deck: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: "deck_row_1" };
        },
      },
    } as unknown as DeckExportDeps["db"],
    credential: over.credential ?? (async () => ({ status: "granted", accessToken: "token" })),
    slides: () => slidesApi,
    renders: {
      present: over.present ?? (async () => true),
      readUrl: async (page) => `https://signed.test/${page.pageId}`,
    },
    onNotesFailure: () => {},
  };

  return { deps, calls, created };
}

const run = (deps: DeckExportDeps) =>
  exportBoardToSlides(deps, { userId: "user_1", boardId: "board_1" });

test("a user who has not connected Slides is asked to, before anything is created", async () => {
  const { deps, calls } = fakes({ credential: async () => ({ status: "needsConsent" }) });
  assert.deepEqual(await run(deps), { status: "needsConsent" });
  assert.deepEqual(calls, []);
});

test("a page whose picture never uploaded stops the export before a half-drawn deck exists", async () => {
  const { deps, calls } = fakes({ present: async (page) => page.pageId !== "p1" });
  assert.deepEqual(await run(deps), { status: "missingRenders", pageIds: ["p1"] });
  assert.deepEqual(calls, []);
});

test("the deck is built in four calls: create, the whole deck, read the notes shapes, the notes", async () => {
  const { deps, calls } = fakes();
  const result = await run(deps);

  assert.equal(result.status, "exported");
  assert.deepEqual(
    calls.map((call) => call.name),
    ["create:Act two", "batchUpdate", "notesShapes", "batchUpdate"],
  );
});

test("the slides are in previewOrder, each carrying its own page's picture", async () => {
  const { deps, calls } = fakes();
  await run(deps);

  const structure = calls[1]!.requests!;
  const urls = structure.flatMap((request) => {
    const image = request.createImage as { url?: string } | undefined;
    return image?.url ? [image.url] : [];
  });
  assert.deepEqual(urls, ["https://signed.test/p2", "https://signed.test/p1"]);
});

test("the default slide the API opens with is deleted, last, so nothing empty survives", async () => {
  const { deps, calls } = fakes();
  await run(deps);

  const structure = calls[1]!.requests!;
  assert.deepEqual(structure[structure.length - 1], {
    deleteObject: { objectId: "default" },
  });
});

test("the deck row names the presentation and a link the user can open", async () => {
  const { deps, created } = fakes();
  const result = await run(deps);

  assert.deepEqual(created, [
    {
      projectId: "project_1",
      moodboardId: "board_1",
      slidesFileId: "deck_1",
      webViewLink: "https://docs.google.com/presentation/d/deck_1/edit",
    },
  ]);
  assert.equal(result.status === "exported" && result.deckId, "deck_row_1");
});

test("a board whose references nobody has read is a deck with no notes and no second batch", async () => {
  const { deps, calls } = fakes({ read: false });
  const result = await run(deps);

  assert.equal(result.status === "exported" && result.notesWritten, true);
  assert.equal(calls.filter((call) => call.name === "notesShapes").length, 0);
});

test("the notes carry the analyzer's tags, one insert per slide", async () => {
  const { deps, calls } = fakes();
  await run(deps);

  assert.deepEqual(calls[3]!.requests, [
    {
      insertText: {
        objectId: "notes-0",
        insertionIndex: 0,
        text: "Wet asphalt\nTexture & grain: Heavy grain",
      },
    },
    {
      insertText: {
        objectId: "notes-1",
        insertionIndex: 0,
        text: "Rain on glass\nLighting: Low key",
      },
    },
  ]);
});

test("a deck whose notes could not be written is still a deck, and says so", async () => {
  const { deps, created } = fakes({
    notesShapes: async () => {
      throw new Error("Google Slides answered 503");
    },
  });
  const result = await run(deps);

  assert.equal(result.status === "exported" && result.notesWritten, false);
  assert.equal(created.length, 1);
});
