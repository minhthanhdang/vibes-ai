"use client";

import { useRef, useSyncExternalStore } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, NormalizedZoomValue } from "@excalidraw/excalidraw/types";

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 30;

export function BoardControls({
  api,
  held,
}: {
  api: ExcalidrawImperativeAPI;
  held: boolean;
}) {
  const row = useRef<HTMLDivElement>(null);

  const zoom = useSyncExternalStore(
    (notify) => api.onScrollChange(notify),
    () => api.getAppState().zoom.value,
    () => 1,
  );

  function zoomTo(value: number) {
    const state = api.getAppState();
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
    const centreX = state.width / 2;
    const centreY = state.height / 2;

    api.updateScene({
      appState: {
        zoom: { value: next as NormalizedZoomValue },
        scrollX: state.scrollX + centreX / next - centreX / state.zoom.value,
        scrollY: state.scrollY + centreY / next - centreY / state.zoom.value,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }

  function press(key: string, code: string, shiftKey = false) {
    const container = row.current?.parentElement?.querySelector(".excalidraw");
    (container ?? document).dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        code,
        shiftKey,
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  return (
    <div ref={row} className="absolute bottom-4 left-4 z-20 flex items-center gap-2">
      <Group>
        <Control label="Zoom out" onClick={() => zoomTo(zoom - ZOOM_STEP)}>
          −
        </Control>
        <button
          type="button"
          onClick={() => zoomTo(1)}
          aria-label="Reset zoom to 100%"
          title="Reset zoom"
          className="h-8 rounded-full px-2 text-xs tabular-nums transition-colors hover:bg-current/10"
        >
          {Math.round(zoom * 100)}%
        </button>
        <Control label="Zoom in" onClick={() => zoomTo(zoom + ZOOM_STEP)}>
          +
        </Control>
      </Group>

      {held ? null : (
        <Group>
          <Control label="Undo" onClick={() => press("z", "KeyZ")}>
            ↺
          </Control>
          <Control label="Redo" onClick={() => press("z", "KeyZ", true)}>
            ↻
          </Control>
        </Group>
      )}

      <Group>
        <Control label="Keyboard shortcuts and help" onClick={() => press("?", "Slash", true)}>
          ?
        </Control>
      </Group>
    </div>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-10 items-center gap-0.5 rounded-full border border-current/15 bg-[var(--background)]/80 px-1 shadow-[0_4px_16px_rgba(0,0,0,0.18)] backdrop-blur-md">
      {children}
    </div>
  );
}

function Control({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-8 items-center justify-center rounded-full text-base leading-none transition-colors hover:bg-current/10"
    >
      {children}
    </button>
  );
}
