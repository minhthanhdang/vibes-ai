"use client";

import { useRef, useSyncExternalStore } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, NormalizedZoomValue } from "@excalidraw/excalidraw/types";

/// The editor's bottom row, drawn here rather than by the editor.
///
/// Excalidraw's own zoom, history and help controls are switched off in
/// `excalidraw-chrome.css`. They were restyled for a while, and the restyling
/// never finished: the fills come from a rule this file cannot outweigh, the
/// hover fill on the zoom readout keeps its square corners, and the tooltip is
/// a black box under a row of glass. Drawing the row is less code than the
/// overrides were, and it is the same row on either side of an upgrade.
///
/// Zoom goes through the imperative API. History and help do not — the API
/// exposes `history.clear()` and nothing else, and no action is exported — so
/// they are the keystrokes the editor already binds, sent to the editor.

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 30;

export function BoardControls({ api }: { api: ExcalidrawImperativeAPI }) {
  const row = useRef<HTMLDivElement>(null);

  /// Subscribed rather than held, because the editor is the one that knows: the
  /// wheel, the trackpad and a keyboard shortcut all change the zoom without
  /// passing through this row. `onScrollChange` is the editor's own store, so
  /// there is no second copy of the number to keep in step.
  const zoom = useSyncExternalStore(
    (notify) => api.onScrollChange(notify),
    () => api.getAppState().zoom.value,
    () => 1,
  );

  /// Zooming about the middle of the view rather than its corner. Scroll is in
  /// scene units, so holding a point still costs it the difference between what
  /// that point was worth at each zoom — without this the board slides out from
  /// under the pointer every press.
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
      /// Framing is not an edit, and an undo that only moved the view is a
      /// press that looks broken.
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }

  /// What the editor binds these to, sent as the editor's own keydown. Both
  /// modifiers are set because the editor reads whichever its platform calls
  /// the command key, and nothing it binds asks for one without the other.
  function press(key: string, code: string, shiftKey = false) {
    /// The editor listens on its own container, so the event has to land inside
    /// it — one dispatched at the document would never reach the handler. This
    /// row and the editor are siblings in the box that holds the board.
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
        {/* The readout is the reset: the number is what tells you it is worth
            pressing, and a fourth button to say "100%" would say it twice. */}
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

      <Group>
        {/* Always offered, because nothing says whether there is anything to
            undo — the editor keeps that to itself. A press with an empty
            history does nothing, which is what the greyed button did too. */}
        <Control label="Undo" onClick={() => press("z", "KeyZ")}>
          ↺
        </Control>
        <Control label="Redo" onClick={() => press("z", "KeyZ", true)}>
          ↻
        </Control>
      </Group>

      <Group>
        <Control label="Keyboard shortcuts and help" onClick={() => press("?", "Slash", true)}>
          ?
        </Control>
      </Group>
    </div>
  );
}

/// The dock's pill, which is the shape the rest of this row is in.
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
