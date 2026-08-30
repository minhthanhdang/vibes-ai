import { readableTarget } from "@/lib/canvas-objects/object-read";
import { boardPages } from "@/lib/pages/board-pages";
import { contrastRead, type ContrastPair } from "@/lib/render/contrast";
import { pageRenderPlan } from "@/lib/render/render-plan";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

export type LegibilityChange = {
  arrived: ContrastPair[];
};

export function legibilityChange(
  before: unknown,
  after: unknown,
  { background }: { background?: unknown } = {},
): LegibilityChange {
  if (!Array.isArray(before) || !Array.isArray(after)) return { arrived: [] };

  const scene = after as readonly SceneElement[];
  const was = new Map(boardPages(before).map((page) => [page.id, page]));
  const addressable = new Set(
    after
      .filter((element) => readableTarget(element))
      .map((element) => (element as { id?: unknown }).id)
      .filter((id): id is string => typeof id === "string"),
  );

  const arrived: ContrastPair[] = [];
  for (const page of boardPages(scene)) {
    const now = contrastRead(pageRenderPlan(scene, page, { background }));
    if (!now.failing.length) continue;

    const stood = was.get(page.id);
    const failedBefore = new Set(
      stood
        ? contrastRead(
            pageRenderPlan(before as readonly SceneElement[], stood, { background }),
          ).failing.map((pair) => pair.textId)
        : [],
    );
    arrived.push(
      ...now.failing.filter(
        (pair) => !failedBefore.has(pair.textId) && addressable.has(pair.textId),
      ),
    );
  }

  return { arrived: arrived.sort((one, other) => one.ratio - other.ratio) };
}
