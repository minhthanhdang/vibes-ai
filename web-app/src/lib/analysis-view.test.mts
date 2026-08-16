import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeAnalysis } from "./analysis";
import {
  analysisRequestLabel,
  analysisView,
  isAnalysisPending,
  type AnalysisRunStatus,
} from "./analysis-view";

const analyzed = normalizeAnalysis({ lighting: ["golden-hour"], colorPalette: ["#ffcc00"] });
const blank = normalizeAnalysis({});

/// `add` files the job in the same transaction as the reference, so a missing
/// run is never "about to be queued" — spinning on it would spin forever.
test("a reference with no run at all is unanalyzed, not waiting", () => {
  const view = analysisView({ properties: null, run: null });
  assert.deepEqual(view, { kind: "unanalyzed" });
  assert.ok(!isAnalysisPending(view));
  assert.ok(analysisRequestLabel(view));
});

test("queued and running are both pending but say different things", () => {
  const queued = analysisView({ properties: null, run: { status: "QUEUED" } });
  const running = analysisView({ properties: null, run: { status: "RUNNING" } });
  assert.equal(queued.kind, "pending");
  assert.equal(running.kind, "pending");
  assert.notEqual(
    queued.kind === "pending" && queued.message,
    running.kind === "pending" && running.message,
  );
});

test("a failed run surfaces its own error", () => {
  const view = analysisView({
    properties: null,
    run: { status: "FAILED", error: "analyzer returned no content" },
  });
  assert.deepEqual(view, { kind: "failed", message: "analyzer returned no content" });
});

test("a failed run with no message still says something", () => {
  for (const error of [null, undefined, "", "   "]) {
    const view = analysisView({ properties: null, run: { status: "FAILED", error } });
    assert.equal(view.kind, "failed");
    assert.ok(view.kind === "failed" && view.message.length > 0);
  }
});

test("succeeding without writing a row is empty, not a spinner that never stops", () => {
  assert.deepEqual(analysisView({ properties: null, run: { status: "SUCCEEDED" } }), {
    kind: "empty",
  });
});

test("stored properties render whatever the run row says", () => {
  const statuses: AnalysisRunStatus[] = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"];
  for (const status of [...statuses.map((status) => ({ status })), null]) {
    assert.deepEqual(analysisView({ properties: analyzed, run: status }), {
      kind: "ready",
      properties: analyzed,
    });
  }
});

test("a row the analyzer filled with nothing is empty, not ready", () => {
  const view = analysisView({ properties: blank, run: { status: "SUCCEEDED" } });
  assert.deepEqual(view, { kind: "empty" });
  assert.ok(!isAnalysisPending(view));
});

test("only pending polls", () => {
  assert.ok(isAnalysisPending(analysisView({ properties: null, run: { status: "RUNNING" } })));
  for (const source of [
    { properties: analyzed, run: null },
    { properties: blank, run: null },
    { properties: null, run: { status: "FAILED" as const } },
    { properties: null, run: { status: "SUCCEEDED" as const } },
  ]) {
    assert.ok(!isAnalysisPending(analysisView(source)));
  }
});

test("a rationale alone is worth showing", () => {
  const properties = normalizeAnalysis({ rationale: "Hard top light, everything else falls away." });
  assert.equal(analysisView({ properties, run: null }).kind, "ready");
});

test("every dead end offers a way out, and nothing else does", () => {
  for (const source of [
    { properties: null, run: null },
    { properties: null, run: { status: "FAILED" as const } },
    { properties: blank, run: { status: "SUCCEEDED" as const } },
  ]) {
    assert.ok(analysisRequestLabel(analysisView(source)));
  }

  /// A job already in the queue does not need a second one, and a filled panel
  /// is not a dead end.
  for (const source of [
    { properties: null, run: { status: "QUEUED" as const } },
    { properties: null, run: { status: "RUNNING" as const } },
    { properties: analyzed, run: null },
  ]) {
    assert.equal(analysisRequestLabel(analysisView(source)), null);
  }
});

test("each dead end asks for something different", () => {
  const labels = [
    analysisRequestLabel(analysisView({ properties: null, run: null })),
    analysisRequestLabel(analysisView({ properties: null, run: { status: "FAILED" } })),
    analysisRequestLabel(analysisView({ properties: blank, run: { status: "SUCCEEDED" } })),
  ];
  assert.equal(new Set(labels).size, labels.length);
});
