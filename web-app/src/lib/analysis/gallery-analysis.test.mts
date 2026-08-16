import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeAnalysis } from "@/lib/analysis/analysis";
import {
  galleryAnalysisIndex,
  galleryAnalysisView,
  isGalleryAnalysisPending,
  type GalleryAnalysisSource,
} from "@/lib/analysis/gallery-analysis";

const analyzed = (referenceId: string, colorPalette: string[] = ["#ffcc00"]) => ({
  referenceId,
  ...normalizeAnalysis({ colorPalette, lighting: ["golden-hour"] }),
});

const source = (over: Partial<GalleryAnalysisSource> = {}): GalleryAnalysisSource => ({
  analyses: [],
  runs: [],
  ...over,
});

test("a stored analysis reads ready and carries its palette to the tile", () => {
  const index = galleryAnalysisIndex(source({ analyses: [analyzed("a", ["#112233"])] }));
  const view = galleryAnalysisView(index, "a");
  assert.equal(view.kind, "ready");
  assert.deepEqual(view.kind === "ready" && view.properties.colorPalette, ["#112233"]);
});

test("the newest run wins per reference, and other references' runs do not leak into it", () => {
  const index = galleryAnalysisIndex(
    source({
      runs: [
        { input: { referenceId: "a" }, status: "RUNNING", error: null },
        { input: { referenceId: "b" }, status: "FAILED", error: "vertex said no" },
        { input: { referenceId: "a" }, status: "FAILED", error: "an older attempt" },
      ],
    }),
  );
  assert.equal(galleryAnalysisView(index, "a").kind, "pending");
  const b = galleryAnalysisView(index, "b");
  assert.equal(b.kind, "failed");
  assert.equal(b.kind === "failed" && b.message, "vertex said no");
});

/// Same precedence the panel uses: rows are written on success, so a re-run that
/// died must not blank a tile that already has colours on it.
test("a stored analysis outranks a later failed run", () => {
  const index = galleryAnalysisIndex(
    source({
      analyses: [analyzed("a")],
      runs: [{ input: { referenceId: "a" }, status: "FAILED", error: "boom" }],
    }),
  );
  assert.equal(galleryAnalysisView(index, "a").kind, "ready");
});

/// `AgentRun.input` is client-written Json, so a row may name nothing at all.
test("a run whose input names no reference is ignored rather than indexed", () => {
  const index = galleryAnalysisIndex(
    source({
      runs: [
        { input: {}, status: "RUNNING", error: null },
        { input: { referenceId: "   " }, status: "RUNNING", error: null },
        { input: null, status: "RUNNING", error: null },
      ],
    }),
  );
  assert.equal(index.size, 0);
});

/// The gallery list and this read are separate queries: a tile can render before
/// the read that carries its queued run. Reading that as "unanalyzed" would stop
/// the poll on exactly the reference that is mid-analysis.
test("a reference the index has never seen is pending, not unanalyzed", () => {
  const index = galleryAnalysisIndex(source());
  assert.equal(galleryAnalysisView(index, "brand-new").kind, "pending");
  assert.ok(isGalleryAnalysisPending(index, ["brand-new"]));
});

test("polling follows the references on screen, not the index", () => {
  const index = galleryAnalysisIndex(
    source({
      analyses: [analyzed("a")],
      runs: [
        { input: { referenceId: "b" }, status: "SUCCEEDED", error: null },
        { input: { referenceId: "c" }, status: "QUEUED", error: null },
      ],
    }),
  );
  assert.ok(!isGalleryAnalysisPending(index, ["a", "b"]));
  assert.ok(isGalleryAnalysisPending(index, ["a", "c"]));
  /// A reference whose run left the index (removed tile) is not polled for.
  assert.ok(!isGalleryAnalysisPending(index, []));
});
