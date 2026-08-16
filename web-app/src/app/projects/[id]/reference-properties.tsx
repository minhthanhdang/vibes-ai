"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { ANALYSIS_DIMENSIONS, tagLabel, type AnalysisProperties } from "@/lib/analysis";
import { analysisView, isAnalysisPending } from "@/lib/analysis-view";
import { ColorPalette } from "@/components/color-palette";

/// The analyzer runs out of band, so this is a poll, not a subscription. Slow
/// enough that a gallery left open overnight is not a load, fast enough that a
/// director who just dropped a batch sees them fill in while watching.
const POLL_MS = 4000;

export function ReferenceProperties({ referenceId }: { referenceId: string }) {
  const trpc = useTRPC();
  const { data, isPending, error } = useQuery(
    trpc.reference.properties.queryOptions(
      { referenceId },
      {
        refetchInterval: ({ state }) =>
          state.data && !isAnalysisPending(analysisView(state.data)) ? false : POLL_MS,
      },
    ),
  );

  if (error) return <Notice tone="error">{error.message}</Notice>;
  if (isPending || !data) return <PendingProperties message="Loading…" />;

  const view = analysisView(data);

  switch (view.kind) {
    case "pending":
      return <PendingProperties message={view.message} />;
    case "failed":
      return <Notice tone="error">{view.message}</Notice>;
    case "empty":
      return <Notice tone="muted">No properties found for this reference.</Notice>;
    case "ready":
      return <Properties properties={view.properties} />;
  }
}

function Properties({ properties }: { properties: AnalysisProperties }) {
  return (
    <div className="flex flex-col gap-5 text-sm">
      {properties.colorPalette.length ? (
        <section className="flex flex-col gap-2">
          <SectionLabel>Palette</SectionLabel>
          <ColorPalette colors={properties.colorPalette} />
        </section>
      ) : null}

      {ANALYSIS_DIMENSIONS.filter(({ key }) => properties[key].length).map(({ key, label }) => (
        <section key={key} className="flex flex-col gap-2">
          <SectionLabel>{label}</SectionLabel>
          <ul className="flex flex-wrap gap-1.5">
            {properties[key].map((tag) => (
              <li key={tag} className="rounded-full bg-current/8 px-2.5 py-1 text-xs">
                {tagLabel(tag)}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {properties.rationale ? (
        <section className="flex flex-col gap-2">
          <SectionLabel>Why it looks like this</SectionLabel>
          <p className="text-sm leading-relaxed opacity-80">{properties.rationale}</p>
        </section>
      ) : null}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-medium tracking-widest uppercase opacity-45">{children}</h3>;
}

/// Shaped like the panel it is standing in for — three rows of headings and
/// pills — so the layout does not jump when the properties land.
function PendingProperties({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-5" aria-live="polite" aria-busy="true">
      <p className="flex items-center gap-2 text-sm opacity-60">
        <span className="size-3 animate-spin rounded-full border-2 border-current/25 border-t-current" />
        {message}
      </p>

      <div className="flex animate-pulse flex-col gap-5" aria-hidden>
        {[
          [64, 96, 80],
          [88, 56],
          [72, 104, 60],
        ].map((widths, index) => (
          <div key={index} className="flex flex-col gap-2">
            <div className="h-2 w-20 rounded-full bg-current/10" />
            <div className="flex gap-1.5">
              {widths.map((width, pill) => (
                <div key={pill} className="h-6 rounded-full bg-current/8" style={{ width }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Notice({ tone, children }: { tone: "error" | "muted"; children: React.ReactNode }) {
  return (
    <p className={`text-sm ${tone === "error" ? "text-red-500" : "opacity-60"}`}>{children}</p>
  );
}
