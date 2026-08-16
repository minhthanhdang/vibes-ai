import { sidebarPageWidth, type SidebarState } from "./sidebar";

/// The properties panel opened from the sidebar is a second level: it floats
/// over the gallery instead of being a flex sibling, so the main content keeps
/// its width and the assistant stays visible beside it.
export const SECOND_LEVEL_MIN_WIDTH = 300;
export const SECOND_LEVEL_DEFAULT_WIDTH = 380;
export const SECOND_LEVEL_MAX_WIDTH = 440;
/// Left of the panel the gallery has to stay recognisable — without a gutter a
/// wide panel reads as a page, not as something layered on top.
export const SECOND_LEVEL_GUTTER = 32;

export type SecondLevelPlacement = { right: number; width: number };

/// Anchored to the sidebar's inner edge so the two panels read as one stack.
/// When what is left of the viewport is too narrow to be worth reading, the
/// panel takes the whole width instead — including the sidebar's own strip,
/// which on that screen is where the click came from and no longer has to stay
/// visible.
export function secondLevelPlacement(
  sidebar: SidebarState,
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

/// Clicking the reference already open closes the panel — the strip is the only
/// affordance the sidebar has, so it has to be the way back out too.
export function nextSecondLevelSelection(current: string | null, clicked: string) {
  return current === clicked ? null : clicked;
}

/// A reference removed from the gallery while its panel is open leaves a panel
/// polling an id the server will now 404 on, so the selection follows the list.
export function resolveSecondLevelSelection(
  current: string | null,
  available: readonly { id: string }[],
) {
  if (!current) return null;
  return available.some((reference) => reference.id === current) ? current : null;
}
