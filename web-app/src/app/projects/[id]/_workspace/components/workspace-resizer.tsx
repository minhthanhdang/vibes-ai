"use client";

import {
  SIDEBAR_KEYBOARD_STEP,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  widthAfterDrag,
} from "@/lib/ui/sidebar";
import { setSidebarWidth } from "../stores/use-sidebar-store";

export function WorkspaceResizer({
  width,
  onResizing,
}: {
  width: number;
  onResizing: (resizing: boolean) => void;
}) {
  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = width;
    handle.setPointerCapture(event.pointerId);
    onResizing(true);

    const onMove = (move: PointerEvent) =>
      setSidebarWidth(widthAfterDrag(startWidth, startX, move.clientX), { persist: false });
    const onEnd = (end: PointerEvent) => {
      setSidebarWidth(widthAfterDrag(startWidth, startX, end.clientX));
      onResizing(false);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      onPointerDown={startResize}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") setSidebarWidth(width + SIDEBAR_KEYBOARD_STEP);
        else if (event.key === "ArrowRight") setSidebarWidth(width - SIDEBAR_KEYBOARD_STEP);
        else return;
        event.preventDefault();
      }}
      className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-current/20 focus-visible:bg-current/30 focus-visible:outline-none"
    />
  );
}
