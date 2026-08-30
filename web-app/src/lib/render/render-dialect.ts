import {
  boardRenderPlan,
  drawnBounds,
  pageRenderPlan,
  textOverflow,
} from "@/lib/render/render-plan";
import { boardPages } from "@/lib/pages/board-pages";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

const SEEDED = { seed: 1_337, versionNonce: 42 } as const;

function element(id: string, type: string, extra: Record<string, unknown>): SceneElement {
  return { id, type, strokeColor: "#1e1e1e", strokeWidth: 2, ...SEEDED, ...extra };
}

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
    roundness: { type: 3 },
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
  element("dialect-google", "text", {
    text: "Numerals 0123 & ampersand",
    x: 60,
    y: 1_120,
    width: 640,
    height: 60,
    fontSize: 40,
    fontFamily: 1_333_019_802,
    customData: {
      font: {
        family: "Playfair Display",
        weight: 700,
        italic: true,
        set: { space: 0.255, narrow: 0.344, wide: 0.859, upper: 0.688, digit: 0.525, other: 0.517 },
        fallback: "serif",
      },
    },
    strokeColor: "#f8f9fa",
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

function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

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
