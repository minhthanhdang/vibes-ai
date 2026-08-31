export const SIDEBAR_MIN_WIDTH = 280;
export const SIDEBAR_MAX_WIDTH = 560;
export const SIDEBAR_DEFAULT_WIDTH = 360;
export const SIDEBAR_RAIL_WIDTH = 48;
export const SIDEBAR_KEYBOARD_STEP = 24;

export type SidebarState = { isOpen: boolean; width: number; arePanelsOpen: boolean };

export const SIDEBAR_DEFAULT_STATE: SidebarState = {
  isOpen: true,
  width: SIDEBAR_DEFAULT_WIDTH,
  arePanelsOpen: true,
};

export function clampSidebarWidth(width: number) {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

export function widthAfterDrag(startWidth: number, startX: number, x: number) {
  return clampSidebarWidth(startWidth + (startX - x));
}

export function sidebarPageWidth({ isOpen, width }: Pick<SidebarState, "isOpen" | "width">) {
  return isOpen ? clampSidebarWidth(width) : SIDEBAR_RAIL_WIDTH;
}

export function parseSidebarState(raw: string | null): SidebarState {
  if (!raw) return SIDEBAR_DEFAULT_STATE;

  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return SIDEBAR_DEFAULT_STATE;
  }
  if (typeof stored !== "object" || stored === null) return SIDEBAR_DEFAULT_STATE;

  const { isOpen, width, arePanelsOpen } = stored as Partial<SidebarState>;
  return {
    isOpen: typeof isOpen === "boolean" ? isOpen : SIDEBAR_DEFAULT_STATE.isOpen,
    width: clampSidebarWidth(typeof width === "number" ? width : Number.NaN),
    arePanelsOpen:
      typeof arePanelsOpen === "boolean" ? arePanelsOpen : SIDEBAR_DEFAULT_STATE.arePanelsOpen,
  };
}

export function serializeSidebarState(state: SidebarState) {
  return JSON.stringify(state);
}
