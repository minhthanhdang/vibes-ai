import "server-only";
import { bucketName } from "@/env";
import type { RenderTally } from "@/lib/agent/designer/design-runs";
import { boardPages, pageById } from "@/lib/pages/board-pages";
import { contrastRead, type ContrastRead } from "@/lib/render/contrast";
import { bandOccupancy, type OccupancyRead } from "@/lib/render/occupancy";
import {
  boardRenderPlan,
  pageRenderPlan,
  type RenderPlan,
  type Undrawn,
} from "@/lib/render/render-plan";
import {
  BOARD_RENDER_CONTENT_TYPE,
  modelBoardRenderObjectPath,
  modelPageRenderObjectPath,
} from "@/lib/scene/moodboard-render";
import { persistableElements } from "@/lib/scene/moodboard-scene";
import { db } from "@/server/db";
import { objectHead, readObject, saveObject } from "@/server/google/storage";
import { rasterise, type RasterOptions, type ReferenceBytes } from "@/server/render/rasterise";

export const RENDER_TIMEOUT_MS = 8_000;

export const RENDER_SOURCE_BYTE_LIMIT = 25_000_000;

export type ModelRenderScene = {
  projectId: string;
  revision: number;
  elements: unknown;
  appState?: unknown;
};

export type ModelRenderRequest = {
  boardId: string;
  pageId?: string;
  scene: ModelRenderScene;
};

export type ModelRenderDrawn = {
  uri: string;
  revision: number;
  drawn: "cached" | "made";
  undrawn: Undrawn[];
  occupancy: OccupancyRead;
  contrast: ContrastRead;
};

export type ModelRenderFailed = {
  failed: true;
  reason: string;
  occupancy?: OccupancyRead;
  contrast?: ContrastRead;
};

export type ModelRender = ModelRenderDrawn | ModelRenderFailed;

export type RenderStore = {
  head(objectPath: string): Promise<{ undrawn: Undrawn[] } | null>;
  put(objectPath: string, bytes: Uint8Array, undrawn: readonly Undrawn[]): Promise<void>;
};

const UNDRAWN_METADATA_KEY = "undrawn";

export function undrawnFromMetadata(value: unknown): Undrawn[] {
  if (typeof value !== "string") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    const item = entry as { id?: unknown; type?: unknown } | null;
    return typeof item?.id === "string" && typeof item.type === "string"
      ? [{ id: item.id, type: item.type }]
      : [];
  });
}

export function objectRenderStore(): RenderStore {
  return {
    async head(objectPath) {
      const found = await objectHead(objectPath);
      return found && { undrawn: undrawnFromMetadata(found.metadata[UNDRAWN_METADATA_KEY]) };
    },
    async put(objectPath, bytes, undrawn) {
      await saveObject(objectPath, bytes, {
        contentType: BOARD_RENDER_CONTENT_TYPE,
        metadata: { [UNDRAWN_METADATA_KEY]: JSON.stringify(undrawn) },
      });
    },
  };
}

export type ReferenceRow = { id: string; gcsUri: string; thumbGcsUri: string | null };

export type ReferenceSource = {
  rows(projectId: string): Promise<ReferenceRow[]>;
  read(gcsUri: string): Promise<Uint8Array>;
};

export const projectReferences: ReferenceSource = {
  rows: (projectId) =>
    db.reference.findMany({
      where: { projectId },
      select: { id: true, gcsUri: true, thumbGcsUri: true },
    }),
  read: async (gcsUri) => new Uint8Array(await readObject(gcsUri, RENDER_SOURCE_BYTE_LIMIT)),
};

export function projectReferenceBytes(
  projectId: string,
  source: ReferenceSource = projectReferences,
): ReferenceBytes {
  let rows: Promise<Map<string, ReferenceRow>> | undefined;
  const bytes = new Map<string, Promise<Uint8Array | null>>();

  const load = async () => {
    const found = await source.rows(projectId);
    return new Map(found.map((row) => [row.id, row]));
  };

  const download = async (uri: string) => {
    try {
      return await source.read(uri);
    } catch {
      return null;
    }
  };

  return async (referenceId, variant) => {
    const reference = (await (rows ??= load())).get(referenceId);
    if (!reference) return null;

    const uri = (variant === "thumb" ? reference.thumbGcsUri : null) ?? reference.gcsUri;
    let pending = bytes.get(uri);
    if (!pending) {
      pending = download(uri);
      bytes.set(uri, pending);
    }
    return pending;
  };
}

export type ModelRenderOptions = {
  bytesOf?: ReferenceBytes;
  store?: RenderStore;
  timeoutMs?: number;
  fonts?: RasterOptions["fonts"];
};

type Within<T> = { done: T } | { late: true } | { threw: unknown };

function within<T>(work: Promise<T>, ms: number): Promise<Within<T>> {
  return new Promise<Within<T>>((resolve) => {
    const timer = setTimeout(() => resolve({ late: true }), ms);
    work.then(
      (done) => {
        clearTimeout(timer);
        resolve({ done });
      },
      (threw: unknown) => {
        clearTimeout(timer);
        resolve({ threw });
      },
    );
  });
}

function planFor(request: ModelRenderRequest): RenderPlan | ModelRenderFailed {
  const elements = persistableElements(request.scene.elements);
  const background = (request.scene.appState as { viewBackgroundColor?: unknown } | null)
    ?.viewBackgroundColor;

  if (request.pageId === undefined) {
    const plan = boardRenderPlan(elements, { background });
    return (
      plan ?? {
        failed: true,
        reason: "that board has nothing on it yet, so there is nothing to draw",
      }
    );
  }

  const page = pageById(boardPages(elements), request.pageId);
  if (!page) {
    return {
      failed: true,
      reason: `there is no page called ${request.pageId} on that board`,
    };
  }
  return pageRenderPlan(elements, page, { background });
}

export async function renderForModel(
  request: ModelRenderRequest,
  {
    bytesOf,
    store = objectRenderStore(),
    timeoutMs = RENDER_TIMEOUT_MS,
    fonts,
  }: ModelRenderOptions = {},
): Promise<ModelRender> {
  const { boardId, pageId, scene } = request;
  const objectPath =
    pageId === undefined
      ? modelBoardRenderObjectPath(boardId, scene.revision)
      : modelPageRenderObjectPath(pageId, scene.revision);
  const uri = `gs://${bucketName()}/${objectPath}`;

  const plan = planFor(request);
  if ("failed" in plan) return plan;

  const occupancy = bandOccupancy(plan);
  const contrast = contrastRead(plan);

  const outcome = await within(
    (async () => {
      const cached = await store.head(objectPath).catch(() => null);
      if (cached) return { drawn: "cached" as const, undrawn: cached.undrawn };

      const raster = await rasterise(plan, bytesOf ?? projectReferenceBytes(scene.projectId), {
        fonts,
      });
      await store.put(objectPath, raster.bytes, raster.undrawn);
      return { drawn: "made" as const, undrawn: raster.undrawn };
    })(),
    timeoutMs,
  );

  const subject = pageId === undefined ? "that board" : "that page";
  if ("late" in outcome) {
    return {
      failed: true,
      reason: `the renderer did not finish drawing ${subject} within ${Math.round(timeoutMs / 1000)} seconds — answer from the text alone and say the picture is missing`,
      occupancy,
      contrast,
    };
  }
  if ("threw" in outcome) {
    const said = outcome.threw instanceof Error ? outcome.threw.message : String(outcome.threw);
    return {
      failed: true,
      reason: `the renderer failed to draw ${subject}: ${said}`,
      occupancy,
      contrast,
    };
  }

  return { uri, revision: scene.revision, occupancy, contrast, ...outcome.done };
}

export type { RenderTally };

export function countedRenders(draw: typeof renderForModel = renderForModel): {
  render: typeof renderForModel;
  drew(): RenderTally;
} {
  const tally: RenderTally = { made: 0, cached: 0, failed: 0 };
  return {
    render: async (request, options) => {
      const outcome = await draw(request, options);
      if ("failed" in outcome) tally.failed += 1;
      else if (outcome.drawn === "cached") tally.cached += 1;
      else tally.made += 1;
      return outcome;
    },
    drew: () => ({ ...tally }),
  };
}
