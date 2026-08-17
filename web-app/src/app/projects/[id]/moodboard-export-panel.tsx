"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BOARD_EXPORT_FORMATS,
  BOARD_EXPORT_SCALES,
  DEFAULT_BOARD_EXPORT,
  type BoardExportFormat,
  type BoardExportScale,
  type BoardExportSettings,
} from "@/lib/scene/moodboard-export";
import { copyBoardImage, downloadFile, exportBoardImage } from "./board-export";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/// The board's own export, in place of excalidraw's dialog.
///
/// Not a matter of taste: excalidraw's exports from the editor's file map, which
/// holds each photo at the size the *board* draws it and holds it as a URL only
/// this app can serve — so its PNG is upscaled thumbnails and its SVG is broken
/// boxes for whoever it was sent to. Every route that asks excalidraw for an
/// image export (the menu item, ⌘⇧E, the command palette) is redirected here by
/// `MoodboardCanvas`, so there is one export on this board and it is this one.
///
/// Painted in excalidraw's island variables rather than the app's: it sits over
/// a canvas that has its own theme control, so the page's colours would put a
/// white card on a dark board.

type Busy = "download" | "copy" | null;

export function MoodboardExportPanel({
  editor,
  title,
  open,
  selectionCount,
  pageName,
  onClose,
}: {
  editor: React.RefObject<ExcalidrawImperativeAPI | null>;
  title: string;
  open: boolean;
  /// How many elements are selected, which is what decides whether "only what is
  /// selected" is a question worth putting on screen.
  selectionCount: number;
  /// The director's own word for the page that selection is, when it is one —
  /// the file such an export produces is that page's rectangle (§V: one page is
  /// one picture), which is a different offer from a corner of the board.
  pageName: string | null;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<BoardExportSettings>(DEFAULT_BOARD_EXPORT);
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const change = useCallback((patch: Partial<BoardExportSettings>) => {
    setFailure(null);
    setCopied(false);
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  /// The setting outlives the selection it was made about — the panel can be
  /// left open across a deselect — so what is exported is derived rather than
  /// stored, and a stale "only selected" reads as the whole board instead of
  /// silently producing an empty file.
  const chosen: BoardExportSettings = {
    ...settings,
    selectionOnly: settings.selectionOnly && selectionCount > 0,
  };

  /// The chosen format and scale are kept for the next export of this board; what
  /// the last one *did* is not, or reopening the panel would greet the director
  /// with "Copied" about a clipboard they have since overwritten.
  const close = useCallback(() => {
    setCopied(false);
    setFailure(null);
    onClose();
  }, [onClose]);

  async function run(action: Exclude<Busy, null>) {
    const api = editor.current;
    if (!api || busy) return;

    setBusy(action);
    setFailure(null);
    setCopied(false);
    try {
      if (action === "copy") {
        await copyBoardImage(api, chosen);
        setCopied(true);
      } else {
        downloadFile(await exportBoardImage(api, chosen, title));
        close();
      }
    } catch (cause) {
      /// Said here rather than logged: an export that produced no file and no
      /// message is one the director repeats until they give up on it.
      setFailure(cause instanceof Error ? cause.message : "The export failed.");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [close, open]);

  if (!open) return null;

  return (
    <div
      /// Covers the whole board while it is up, so nothing dragged onto it is
      /// dropped on the canvas underneath.
      data-board-overlay
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="w-[22rem] max-w-full rounded-xl border border-[var(--default-border-color)] bg-[var(--island-bg-color)] p-4 text-[var(--text-primary-color)] shadow-xl">
        <h2 className="text-sm font-semibold">Export board</h2>

        <div className="mt-4 flex flex-col gap-4">
          <Choices
            label="Format"
            options={(Object.keys(BOARD_EXPORT_FORMATS) as BoardExportFormat[]).map((format) => ({
              value: format,
              label: BOARD_EXPORT_FORMATS[format].label,
            }))}
            value={settings.format}
            onChange={(format) => change({ format })}
          />

          {/* Scale decides the file's pixels *and* which copy of each photo is
              fetched into it, so it is offered for SVG too — an SVG embeds its
              images as bytes like a PNG does. */}
          <Choices
            label="Scale"
            options={BOARD_EXPORT_SCALES.map((scale) => ({ value: scale, label: `${scale}×` }))}
            value={settings.scale}
            onChange={(scale: BoardExportScale) => change({ scale })}
          />

          <Toggle
            label="Background"
            checked={settings.background}
            onChange={(background) => change({ background })}
          />

          {selectionCount > 0 ? (
            <Toggle
              label={
                pageName === null
                  ? `Only the ${selectionCount} selected`
                  : `Only the page${pageName ? ` “${pageName}”` : ""}`
              }
              checked={settings.selectionOnly}
              onChange={(selectionOnly) => change({ selectionOnly })}
            />
          ) : null}
        </div>

        {failure ? <p className="mt-3 text-xs text-red-500">{failure}</p> : null}

        <div className="mt-5 flex items-center justify-end gap-2 text-xs">
          <button
            type="button"
            onClick={close}
            className="h-8 rounded-lg px-3 hover:bg-[var(--button-hover-bg)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void run("copy")}
            className="h-8 rounded-lg border border-[var(--default-border-color)] px-3 hover:bg-[var(--button-hover-bg)] disabled:opacity-50"
          >
            {busy === "copy" ? "Copying…" : copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void run("download")}
            className="h-8 rounded-lg bg-[var(--color-primary)] px-3 font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy === "download" ? "Preparing…" : "Download"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Choices<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs">{label}</span>
      <div className="flex items-stretch overflow-hidden rounded-lg border border-[var(--default-border-color)]">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            className={`h-8 px-3 text-xs ${
              option.value === value
                ? "bg-[var(--color-primary)] text-white"
                : "hover:bg-[var(--button-hover-bg)]"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4"
      />
    </label>
  );
}
