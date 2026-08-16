/// The sidebar is a flex sibling of the gallery, so its width is page width the
/// grid does not get. Below the minimum the chat is unusable; above the maximum
/// the grid drops to two columns on a laptop.
export const SIDEBAR_MIN_WIDTH = 280;
export const SIDEBAR_MAX_WIDTH = 560;
export const SIDEBAR_DEFAULT_WIDTH = 360;
export const SIDEBAR_RAIL_WIDTH = 48;
export const SIDEBAR_KEYBOARD_STEP = 24;

export type SidebarState = { isOpen: boolean; width: number };

export const SIDEBAR_DEFAULT_STATE: SidebarState = {
  isOpen: true,
  width: SIDEBAR_DEFAULT_WIDTH,
};

export function clampSidebarWidth(width: number) {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

/// The handle is on the sidebar's left edge and the sidebar is on the right, so
/// the pointer moving left has to widen it — the delta is inverted.
export function widthAfterDrag(startWidth: number, startX: number, x: number) {
  return clampSidebarWidth(startWidth + (startX - x));
}

/// How much of the page the sidebar occupies. Collapsed it is still a rail, not
/// zero: the expand button has to stay reachable.
export function sidebarPageWidth({ isOpen, width }: SidebarState) {
  return isOpen ? clampSidebarWidth(width) : SIDEBAR_RAIL_WIDTH;
}

/// Anything stored in another tab, another version of the app, or by hand has to
/// degrade to the default rather than render a 4px sidebar.
export function parseSidebarState(raw: string | null): SidebarState {
  if (!raw) return SIDEBAR_DEFAULT_STATE;

  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return SIDEBAR_DEFAULT_STATE;
  }
  if (typeof stored !== "object" || stored === null) return SIDEBAR_DEFAULT_STATE;

  const { isOpen, width } = stored as Partial<SidebarState>;
  return {
    isOpen: typeof isOpen === "boolean" ? isOpen : SIDEBAR_DEFAULT_STATE.isOpen,
    width: clampSidebarWidth(typeof width === "number" ? width : Number.NaN),
  };
}

export function serializeSidebarState(state: SidebarState) {
  return JSON.stringify(state);
}
