"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import {
  DECK_PDF_QUALITIES,
  DECK_PDF_QUALITY_LABELS,
  deckPdfFileName,
  type DeckPdfQuality,
} from "@/lib/decks/deck-pdf";
import { Choices } from "../../_design/components/canvas/export-panel";
import { downloadFile } from "../../_design/utils/board-export";
import { buildDeckPdf } from "../utils/deck-pdf-build";
import { uploadPageRenders } from "../hooks/use-page-uploads";
import type { BoardPage } from "@/lib/pages/board-pages";
import type { MoodboardScene } from "@/server/api/routers/moodboard";

const FORMATS = [
  { value: "pdf", label: "PDF" },
  { value: "slides", label: "Google Slides" },
] as const;

type DeckFormat = (typeof FORMATS)[number]["value"];

type Progress = { label: string; done: number; total: number } | { label: string } | null;

export function DeckExportPanel({
  scene,
  pages,
  open,
  autoStart,
  onClose,
}: {
  scene: MoodboardScene;
  pages: readonly BoardPage[];
  open: boolean;
  autoStart: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const client = useTRPCClient();

  const [format, setFormat] = useState<DeckFormat>(autoStart ? "slides" : "pdf");
  const [quality, setQuality] = useState<DeckPdfQuality>("screen");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [needsConsent, setNeedsConsent] = useState<string | null>(null);

  const { data: door } = useQuery(trpc.deck.slidesOpen.queryOptions());
  const { data: latest, refetch: refetchLatest } = useQuery(
    trpc.deck.latestForBoard.queryOptions({ boardId: scene.id }),
  );
  const slidesOpen = door?.open !== false;

  const close = useCallback(() => {
    setFailure(null);
    setProgress(null);
    onClose();
  }, [onClose]);

  const run = useCallback(
    async (chosen: DeckFormat, chosenQuality: DeckPdfQuality) => {
      setBusy(true);
      setFailure(null);
      setNeedsConsent(null);
      try {
        if (chosen === "pdf") {
          const blob = await buildDeckPdf(scene, pages, chosenQuality, (done, total) =>
            setProgress({ label: "Drawing page", done, total }),
          );
          downloadFile({ blob, filename: deckPdfFileName(scene.title) });
          close();
          return;
        }

        await uploadPageRenders(scene, pages, client, (done, total) =>
          setProgress({ label: "Drawing page", done, total }),
        );

        setProgress({ label: "Building deck…" });
        const result = await client.deck.exportToSlides.mutate({ boardId: scene.id });
        if (result.status === "needsConsent") {
          setNeedsConsent(result.authorizeUrl);
          return;
        }
        if (result.status === "missingRenders") {
          throw new Error(`${result.pageIds.length} pages did not upload. Try again.`);
        }
        await refetchLatest();
      } catch (cause) {
        setFailure(cause instanceof Error ? cause.message : "The export failed.");
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [client, close, pages, refetchLatest, scene],
  );

  const started = useRef(false);
  useEffect(() => {
    if (!open || !autoStart || started.current || !slidesOpen) return;
    started.current = true;
    void run("slides", quality);
  }, [autoStart, open, quality, run, slidesOpen]);

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
            label="Format"
            options={FORMATS.map((option) => ({ ...option }))}
            value={format}
            onChange={setFormat}
          />

          {format === "pdf" ? (
            <Choices
              label="Quality"
              options={DECK_PDF_QUALITIES.map((value) => ({
                value,
                label: DECK_PDF_QUALITY_LABELS[value],
              }))}
              value={quality}
              onChange={setQuality}
            />
          ) : null}
        </div>

        {format === "slides" && !slidesOpen ? (
          <p className="mt-3 text-xs opacity-60">Google sign-in is off in development.</p>
        ) : null}

        {progress ? (
          <p className="mt-3 text-xs opacity-60">
            {"total" in progress
              ? `${progress.label} ${progress.done + 1} of ${progress.total}…`
              : progress.label}
          </p>
        ) : null}

        {latest && format === "slides" && !busy ? (
          <a
            href={latest.webViewLink ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="mt-3 block text-xs text-[var(--color-primary)] hover:underline"
          >
            Open in Google Slides →
          </a>
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
          {needsConsent ? (
            <button
              type="button"
              onClick={() => window.location.assign(needsConsent)}
              className="h-8 rounded-lg bg-[var(--color-primary)] px-3 font-medium text-white hover:opacity-90"
            >
              Connect Google Slides
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || (format === "slides" && !slidesOpen)}
              onClick={() => void run(format, quality)}
              className="h-8 rounded-lg bg-[var(--color-primary)] px-3 font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Preparing…" : format === "pdf" ? "Download" : "Export to Slides"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
