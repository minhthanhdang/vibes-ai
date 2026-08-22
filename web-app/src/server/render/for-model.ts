import "server-only";
import { env } from "@/env";
import { boardPages, pageById } from "@/lib/pages/board-pages";
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
import { bucket, readObject } from "@/server/google/storage";
import { rasterise, type ReferenceBytes } from "@/server/render/rasterise";

/// Drawing a page or a board on demand, for a model to look at (§III.2).
///
/// The two halves either side of this are already built and tested: the plan
/// (`src/lib/render/render-plan.ts`) and the raster (`rasterise.ts`). What is
/// left is the part that touches the world — the object name, the HEAD, the
/// bytes of the photographs, the write and the clock — and it is the part with
/// no arithmetic in it at all.
///
/// **The scene comes in; it is not read here.** §III.3's invariant is that no
/// vision tool sends a picture of a revision other than the one it read the
/// scene at, and the cheapest way to hold a rule like that is to make breaking
/// it unspellable: a caller that has already read the board row hands that read
/// over, and there is no second read to disagree with it. The spec writes this
/// as `renderForModel({ boardId, pageId? })` and a read inside — that version
/// reads the row twice per `get_page`, and the two reads are exactly the race
/// the invariant is about.
///
/// **The cache is a HEAD and a maybe-draw.** The object is named per revision
/// and never overwritten, so an object that exists is of this scene by
/// construction. Two calls in one round race to write identical bytes to one
/// name, which is why the write is unconditional rather than guarded.

/// One draw's wall clock. Past it the caller answers text-only and *says the
/// renderer failed* — a missing picture is an error here rather than the
/// ordinary case, and a model told nothing about it answers about a page it
/// never saw.
export const RENDER_TIMEOUT_MS = 8_000;

/// How large a photograph may be to be composited into a render.
///
/// Far below `CUT_SOURCE_BYTE_LIMIT`, and the difference is arity: a cut holds
/// one original, and a board render holds every image placed on it at once. Past
/// this the picture gets the outline and the naming a freedraw gets, which is a
/// far better answer than the function dying with the whole turn inside it — and
/// the resolution ladder means the ordinary placement asks for a thumbnail
/// anyway.
export const RENDER_SOURCE_BYTE_LIMIT = 25_000_000;

/// The board row as the caller already read it. `elements` is the raw `Json`
/// column, parsed here through the same `persistableElements` every other reader
/// uses, so a caller cannot hand this a scene it cleaned up differently.
export type ModelRenderScene = {
  projectId: string;
  revision: number;
  elements: unknown;
  appState?: unknown;
};

export type ModelRenderRequest = {
  boardId: string;
  /// Absent for a picture of the whole board.
  pageId?: string;
  scene: ModelRenderScene;
};

export type ModelRenderDrawn = {
  /// A `gs://` locator, handed to the model as a file part.
  uri: string;
  revision: number;
  drawn: "cached" | "made";
  /// What is on the page but not in the picture, for the tool's own text
  /// (`undrawnNote`). Carried through a cache hit as well as a fresh draw — see
  /// `RenderStore`.
  undrawn: Undrawn[];
};

export type ModelRenderFailed = {
  failed: true;
  /// A sentence, not a code: it goes into the tool's text as the reason the
  /// answer has no picture on it.
  reason: string;
};

export type ModelRender = ModelRenderDrawn | ModelRenderFailed;

/// The bucket, behind the two calls this makes of it.
///
/// `head` answers with the *undrawn list* rather than a boolean, because that
/// list is the one thing a cache hit would otherwise lose: an image whose bytes
/// the bucket refused was drawn as an outline into the stored PNG, and a second
/// call that found the object and said nothing would show a hole the text no
/// longer accounts for. So it rides along as object metadata and comes back with
/// the hit.
export type RenderStore = {
  head(objectPath: string): Promise<{ undrawn: Undrawn[] } | null>;
  put(objectPath: string, bytes: Uint8Array, undrawn: readonly Undrawn[]): Promise<void>;
};

const UNDRAWN_METADATA_KEY = "undrawn";

/// Exported for its own test: it is the one parser here, it reads a string
/// written by an older deploy or by nobody, and the only other way to reach it
/// is through a bucket.
export function undrawnFromMetadata(value: unknown): Undrawn[] {
  if (typeof value !== "string") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    /// Metadata nobody here wrote, or wrote in an older shape. The picture is
    /// still the picture; the list is the part that is unknown, and an empty one
    /// says less than a wrong one.
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

export function gcsRenderStore(): RenderStore {
  return {
    async head(objectPath) {
      /// The metadata call *is* the HEAD, so existence and the list come back
      /// together — asking `exists()` first would be two round trips inside a
      /// budget that is one draw wide.
      try {
        const [metadata] = await bucket().file(objectPath).getMetadata();
        return { undrawn: undrawnFromMetadata(metadata.metadata?.[UNDRAWN_METADATA_KEY]) };
      } catch (cause) {
        if ((cause as { code?: unknown } | null)?.code === 404) return null;
        throw cause;
      }
    },
    async put(objectPath, bytes, undrawn) {
      await bucket()
        .file(objectPath)
        .save(Buffer.from(bytes), {
          contentType: BOARD_RENDER_CONTENT_TYPE,
          resumable: false,
          metadata: {
            metadata: { [UNDRAWN_METADATA_KEY]: JSON.stringify(undrawn) },
          },
        });
    },
  };
}

/// The photographs, out of the project's own reference rows.
///
/// One query for the whole project rather than one per placement: a board render
/// asks for every image on it, and the rows are small next to the bytes. The
/// bytes themselves are memoised per copy, so a photograph placed twice is
/// downloaded once — and a promise is what is memoised, so two draws asking at
/// the same moment share one download rather than starting two.
///
/// Scoped by project for the reason every other reference read is: an element's
/// `fileId` is scene data, and scene data is not a licence to read a row from
/// somewhere else.
export type ReferenceRow = { id: string; gcsUri: string; thumbGcsUri: string | null };

export type ReferenceSource = {
  rows(projectId: string): Promise<ReferenceRow[]>;
  read(gcsUri: string): Promise<Uint8Array>;
};

/// The real one. Named apart from its use so a test of the ladder and the
/// memoising below needs neither a database nor a bucket.
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
      /// A photograph the bucket would not give up, or one too large to hold
      /// beside the others. Not swallowed: the rasteriser draws a null as an
      /// outline and names it undrawn, so it reaches the tool's text — and the
      /// rest of the arrangement, which is what the model was asked about, is
      /// still drawn.
      return null;
    }
  };

  return async (referenceId, variant) => {
    const reference = (await (rows ??= load())).get(referenceId);
    if (!reference) return null;

    /// The thumbnail when the ladder asked for one and the row has one; the
    /// original otherwise, which is the safe direction to be wrong in and the
    /// same fallback `sceneFiles` makes.
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
  fontsLoad?: () => Promise<boolean>;
};

/// Waiting on a draw for as long as it is worth waiting.
///
/// The draw is not cancelled — nothing in sharp takes a signal, and there is
/// nothing to undo: the write it may still make is to the name this call would
/// have written, with the bytes this call would have written, so a slow draw
/// that lands after the timeout fills the cache for the next round instead of
/// being wasted. What comes back says which of the three happened, because the
/// caller's sentence differs: a draw that ran out of clock and a codec that
/// threw are one thing to the model — no picture — and two things to whoever
/// reads the answer afterwards.
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
    /// A board with nothing on it is not drawn at all, which is
    /// `boardRenderNeeded`'s standing answer: a blank picture is worse than no
    /// picture because a reader cannot tell the two apart. The caller says it in
    /// words instead.
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
    store = gcsRenderStore(),
    timeoutMs = RENDER_TIMEOUT_MS,
    fontsLoad,
  }: ModelRenderOptions = {},
): Promise<ModelRender> {
  const { boardId, pageId, scene } = request;
  const objectPath =
    pageId === undefined
      ? modelBoardRenderObjectPath(boardId, scene.revision)
      : modelPageRenderObjectPath(pageId, scene.revision);
  const uri = `gs://${env().GCS_BUCKET}/${objectPath}`;

  /// The plan before the HEAD, though only a miss needs it: it is arithmetic
  /// over an array already in hand, it costs no I/O, and it is what turns "there
  /// is no such page" into a sentence rather than into a 404 on an object name
  /// nobody would recognise.
  const plan = planFor(request);
  if ("failed" in plan) return plan;

  /// One deadline over the HEAD and the draw together, rather than one each: the
  /// budget is what a tool call may spend on looking, and a bucket that is slow
  /// to answer whether the object exists has already spent it.
  const outcome = await within(
    (async () => {
      /// A HEAD that fails is a miss. Drawing is idempotent — the name holds one
      /// revision's bytes and this call would write the same ones — so the
      /// expensive branch is the safe answer to not knowing.
      const cached = await store.head(objectPath).catch(() => null);
      if (cached) return { drawn: "cached" as const, undrawn: cached.undrawn };

      const raster = await rasterise(plan, bytesOf ?? projectReferenceBytes(scene.projectId), {
        fontsLoad,
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
    };
  }
  if ("threw" in outcome) {
    const said = outcome.threw instanceof Error ? outcome.threw.message : String(outcome.threw);
    return {
      failed: true,
      reason: `the renderer failed to draw ${subject}: ${said}`,
    };
  }

  return { uri, revision: scene.revision, ...outcome.done };
}

/// What a design's draws came to, for the run row (§VIII).
///
/// The cache is the whole of the answer to "eight seconds, several times, in a
/// twelve-round turn", and the risk it answers is written down as one worth
/// measuring: the hit rate before the render time. A look that follows a look
/// with no write between it is a HEAD, so a design whose `made` climbs with its
/// rounds is a design writing every round — which is the ordinary case here and
/// the reason the number is worth having rather than assuming.
///
/// `failed` is on the same tally because a picture that did not arrive is the
/// one case the model was told about and nobody else was: the tool says the
/// renderer failed in its own text, and without this the row of a design that
/// reasoned blind for twelve rounds reads exactly like the row of one that saw.
export type RenderTally = { made: number; cached: number; failed: number };

/// Counts what `renderForModel` answered without changing any of it.
///
/// A decorator rather than a counter inside the render: two toolsets draw and
/// each holds its own default, and what is being counted here is one design's
/// looking rather than the process's. Handed the real one by default so the
/// count is of the draws that really happen — a wrapper the caller has to
/// remember to inject is a wrapper that is absent in production and present in
/// the test.
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
