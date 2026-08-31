import { sidebarPageWidth, type SidebarState } from "@/lib/ui/sidebar";

export const SECOND_LEVEL_MIN_WIDTH = 300;
export const SECOND_LEVEL_DEFAULT_WIDTH = 380;
export const SECOND_LEVEL_MAX_WIDTH = 440;
export const SECOND_LEVEL_GUTTER = 32;

export type SecondLevelPlacement = { right: number; width: number };

export function secondLevelPlacement(
  sidebar: Pick<SidebarState, "isOpen" | "width">,
  viewportWidth: number,
): SecondLevelPlacement {
  const right = sidebarPageWidth(sidebar);
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return { right, width: SECOND_LEVEL_DEFAULT_WIDTH };
  }

  const available = viewportWidth - right;
  if (available < SECOND_LEVEL_MIN_WIDTH + SECOND_LEVEL_GUTTER) {
    return { right: 0, width: viewportWidth };
  }

  return { right, width: Math.min(SECOND_LEVEL_MAX_WIDTH, available - SECOND_LEVEL_GUTTER) };
}

export function nextSecondLevelSelection(current: string | null, clicked: string) {
  return current === clicked ? null : clicked;
}

export function resolveSecondLevelSelection(
  current: string | null,
  available: readonly { id: string }[],
) {
  if (!current) return null;
  return available.some((reference) => reference.id === current) ? current : null;
}
