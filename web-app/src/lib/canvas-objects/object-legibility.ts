import { readableTarget } from "@/lib/canvas-objects/object-read";
import { boardPages } from "@/lib/pages/board-pages";
import { contrastRead, type ContrastPair } from "@/lib/render/contrast";
import { pageRenderPlan } from "@/lib/render/render-plan";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// What a canvas write left that cannot be read (§XI.5, compositor-v2.md §VIII).
///
/// `contrastNote` says the same arithmetic at `get_page`, to a design that went
/// and asked. This says it at the door where the mistake is made, and the
/// difference is worth a module: the page read is a *state* — "these lines on
/// this page stand too close in colour to their ground" — and a state fires on
/// every round of a page whose palette holds no legible pair at all, which is
/// 129 of the 196 failing pairs iteration 31 measured. What a door can say
/// instead is a *change*: which lines this call, and no earlier one, put beyond
/// reading. A call that leaves a bad pair exactly as bad as it found it did not
/// make it and is not told about it.
///
/// Both doors that can cause one go through here, and they cause it in two
/// different ways that this deliberately does not distinguish: a put lays type
/// on ground that was already there, and a restyle can repaint the ground under
/// type that was placed rounds ago. Naming only the objects the call *named*
/// would miss the whole of the second — one fill on a page-wide rectangle is
/// every line above it — so the comparison is over the page rather than over
/// the argument list.
///
/// Whole pages are read either side rather than the elements the edit touched.
/// A page nobody wrote to reads identically both ways and yields nothing, so
/// the arithmetic is its own filter and there is no set of touched ids to keep
/// in step with five writes. It costs two plan builds per page per write, which
/// is arithmetic over an element array with no font, no bucket and no codec
/// (`text-set.ts`) — the same reason `get_page` can afford the reading at all.
///
/// Objects loose on the canvas have no page and so no ground: `plan.background`
/// is a page's own, and a board's canvas colour is the desk rather than the
/// paper. They are left out here the way every other page-shaped reading leaves
/// them out.
///
/// No canvas, no React, no DOM.

export type LegibilityChange = {
  /// The pairs that came in under what their size wants and were not under it
  /// before this write, worst first.
  arrived: ContrastPair[];
};

/// The scene either side of one write, and what stopped being readable across it.
///
/// `addressable` is `readableTarget`'s own answer rather than a second one, on
/// iteration 31's rule: a bound label's ratio is as real as any other line's and
/// its id is one every canvas door refuses by name, so a note that named one
/// would hand back the exact loop stage 0 closed. Unlike the page note, the
/// count is not kept — a door reports what the caller can act on, and a total it
/// cannot address is a number with no next call in it.
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
