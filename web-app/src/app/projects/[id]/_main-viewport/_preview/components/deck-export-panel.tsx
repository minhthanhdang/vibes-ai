"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DECK_PDF_QUALITIES,
  DECK_PDF_QUALITY_LABELS,
  deckPdfFileName,
  type DeckPdfQuality,
} from "@/lib/decks/deck-pdf";
import { Choices } from "../../_design/components/canvas/export-panel";
import { downloadFile } from "../../_design/utils/board-export";
import { buildDeckPdf } from "../utils/deck-pdf-build";
import type { BoardPage } from "@/lib/pages/board-pages";
import type { MoodboardScene } from "@/server/api/routers/moodboard";

export function DeckExportPanel({
  scene,
  pages,
  open,
  onClose,
}: {
  scene: MoodboardScene;
  pages: readonly BoardPage[];
  open: boolean;
  onClose: () => void;
}) {
  const [quality, setQuality] = useState<DeckPdfQuality>("screen");
  const [busy, setBusy] = useState(false);
  const [drawn, setDrawn] = useState<{ done: number; total: number } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const close = useCallback(() => {
    setFailure(null);
    setDrawn(null);
    onClose();
  }, [onClose]);

  async function download() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const blob = await buildDeckPdf(scene, pages, quality, (done, total) =>
        setDrawn({ done, total }),
      );
      downloadFile({ blob, filename: deckPdfFileName(scene.title) });
      close();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "The export failed.");
    } finally {
      setBusy(false);
      setDrawn(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [busy, close, open]);

  if (!open) return null;

  return (
    <div
      data-board-overlay
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) close();
      }}
    >
      <div className="w-[22rem] max-w-full rounded-xl border border-[var(--default-border-color)] bg-[var(--island-bg-color)] p-4 text-[var(--text-primary-color)] shadow-xl">
        <h2 className="text-sm font-semibold">Export deck</h2>
        <p className="mt-1 text-xs opacity-60">
          {pages.length} {pages.length === 1 ? "page" : "pages"}, in the order of the rail.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <Choices
            label="Quality"
            options={DECK_PDF_QUALITIES.map((value) => ({
              value,
              label: DECK_PDF_QUALITY_LABELS[value],
            }))}
            value={quality}
            onChange={setQuality}
          />
        </div>

        {drawn ? (
          <p className="mt-3 text-xs opacity-60">
            {drawn.done < drawn.total
              ? `Drawing page ${drawn.done + 1} of ${drawn.total}…`
              : "Building deck…"}
          </p>
        ) : null}
        {failure ? <p className="mt-3 text-xs text-red-500">{failure}</p> : null}

        <div className="mt-5 flex items-center justify-end gap-2 text-xs">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="h-8 rounded-lg px-3 hover:bg-[var(--button-hover-bg)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void download()}
            className="h-8 rounded-lg bg-[var(--color-primary)] px-3 font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Preparing…" : "Download"}
          </button>
        </div>
      </div>
    </div>
  );
}
