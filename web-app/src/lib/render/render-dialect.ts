import {
  boardRenderPlan,
  drawnBounds,
  pageRenderPlan,
  textOverflow,
} from "@/lib/render/render-plan";
import { boardPages } from "@/lib/pages/board-pages";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// What this renderer draws, said in eight characters (§III.2.1).
///
/// A picture drawn for a model is named per revision and never overwritten, and
/// that name is a promise about the *scene*: the bytes behind it are of this
/// board as it stood at this revision. It was never a promise about the
/// *renderer*, and seven fixes into a re-implementation of excalidraw's export
/// that is the gap that matters — a board nobody has edited keeps being handed
/// the picture whichever renderer was in the process the day it was last looked
/// at, for as long as the object survives (`MODEL_RENDER_LIFECYCLE_DAYS` 7).
/// Measured on this database the day the eighth fix landed: **24 of 24** stored
/// pictures still named at a live revision disagreed with what the renderer
/// draws now, five of them by up to 6.1% of the comparison grid and by a whole
/// frame band of crop.
///
/// So the renderer signs its own output. `MODEL_RENDER_DIALECT` goes in the
/// object name, and this is the fingerprint that says when it is stale: the
/// plan of one canonical scene, hashed. Not the pixels — the plan is where every
/// disagreement this run found actually landed (the dash run, the corner radius,
/// the spline, the sketched walk, the ink box, the frame's name band), it is
/// pure arithmetic over static tables, and it is the same eight characters on
/// every machine. A change confined to the rasteriser moves nothing here and is
/// a hand bump; that is the honest limit of this and the reason the constant is
/// written down rather than computed at boot.
///
/// The scene below is the specimen sheet. Every rule the renderer holds should
/// have something here that would move if the rule moved, which is why it is one
/// dense page rather than a realistic board — a specimen missing a rule is a
/// fingerprint that certifies a renderer it never looked at.

const SEEDED = { seed: 1_337, versionNonce: 42 } as const;

function element(id: string, type: string, extra: Record<string, unknown>): SceneElement {
  return { id, type, strokeColor: "#1e1e1e", strokeWidth: 2, ...SEEDED, ...extra };
}

/// One page, its ground, and one of every drawn thing standing on it — plus a
/// loose element off the page, because a board's frame is decided by what sits
/// outside a page and a page's picture by what sits inside one.
export const DIALECT_SCENE: readonly SceneElement[] = [
  {
    id: "dialect-page",
    type: "frame",
    name: "Specimen",
    customData: { page: {} },
    x: 0,
    y: 0,
    width: 900,
    height: 1200,
    ...SEEDED,
  },
  element("dialect-ground", "rectangle", {
    x: 0,
    y: 0,
    width: 900,
    height: 1200,
    customData: { pageBackground: true },
    backgroundColor: "#0c111c",
    fillStyle: "solid",
    strokeColor: "transparent",
    roughness: 0,
  }),
  element("dialect-image", "image", {
    fileId: "ref:dialect-reference",
    x: 60,
    y: 60,
    width: 420,
    height: 300,
    opacity: 40,
  }),
  element("dialect-panel", "rectangle", {
    x: 520,
    y: 60,
    width: 320,
    height: 300,
    backgroundColor: "#f2e9dc",
    fillStyle: "solid",
    strokeStyle: "dashed",
    strokeWidth: 4,
    roundness: { type: 3 },
    roughness: 0,
  }),
  element("dialect-sketch", "ellipse", {
    x: 60,
    y: 420,
    width: 360,
    height: 220,
    backgroundColor: "#e03131",
    fillStyle: "hachure",
    roughness: 1,
  }),
  element("dialect-diamond", "diamond", {
    x: 520,
    y: 420,
    width: 320,
    height: 220,
    backgroundColor: "#1971c2",
    fillStyle: "cross-hatch",
    roughness: 2,
  }),
  element("dialect-rule", "line", {
    x: 60,
    y: 700,
    width: 780,
    height: 0,
    points: [
      [0, 0],
      [780, 0],
    ],
    roughness: 0,
  }),
  element("dialect-loop", "line", {
    x: 60,
    y: 740,
    width: 200,
    height: 160,
    points: [
      [0, 0],
      [200, 40],
      [140, 160],
      [0, 0],
    ],
    backgroundColor: "#f59f00",
    fillStyle: "solid",
    roundness: { type: 2 },
    roughness: 0,
  }),
  element("dialect-arrow", "arrow", {
    x: 320,
    y: 760,
    width: 240,
    height: 120,
    points: [
      [0, 0],
      [240, 120],
    ],
    roundness: { type: 2 },
    roughness: 0,
    startArrowhead: "dot",
    endArrowhead: "arrow",
  }),
  element("dialect-freedraw", "freedraw", {
    x: 620,
    y: 760,
    width: 180,
    height: 120,
    points: [
      [0, 0],
      [60, 90],
      [180, 20],
    ],
  }),
  element("dialect-headline", "text", {
    text: "Specimen sheet",
    x: 60,
    y: 940,
    width: 780,
    height: 90,
    fontSize: 72,
    fontFamily: 8,
    textAlign: "center",
    verticalAlign: "middle",
    strokeColor: "#ffffff",
  }),
  element("dialect-body", "text", {
    text: "A paragraph long enough to be broken to the width of its own box, twice over, so that a ruler moving moves this.",
    x: 60,
    y: 1_050,
    width: 500,
    height: 120,
    fontSize: 20,
    fontFamily: 5,
    strokeColor: "#f8f9fa",
    opacity: 60,
  }),
  element("dialect-loose", "rectangle", {
    x: 1_100,
    y: 240,
    width: 240,
    height: 160,
    backgroundColor: "#0c8599",
    fillStyle: "zigzag",
    roughness: 1,
    angle: 0.4,
  }),
];

/// FNV-1a over the JSON, rather than sha256 over it: this module sits under
/// `lib/`, where a `node:crypto` import is the one thing that would stop it
/// being readable from a browser bundle, and eight characters of a non-
/// cryptographic hash answers the only question asked of it — did the arithmetic
/// move. Nothing here defends against anyone choosing the input.
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/// The board plan and the page plan both, because they are two different walks
/// of the same scene and only one of them frames itself around what a page
/// clips — the seventh disagreement lived in the half a page render never runs.
///
/// Each draw's own measured rectangles go in beside the plan: a line of type is
/// planned as its string, its face and its size, so a ruler that measures the
/// string differently — which is what the mirrored faces' advance tables are —
/// moves no field of the plan and moves every page it is drawn on.
export function renderDialect(scene: readonly SceneElement[] = DIALECT_SCENE): string {
  const pages = boardPages(scene);
  const plans = [boardRenderPlan(scene), ...pages.map((page) => pageRenderPlan(scene, page))];
  const measured = plans.flatMap((plan) =>
    (plan?.draws ?? []).map((draw) => ({
      id: draw.id,
      ink: drawnBounds(draw),
      room: draw.kind === "text" ? textOverflow(draw) : null,
    })),
  );
  return fingerprint(JSON.stringify({ plans, measured }));
}
