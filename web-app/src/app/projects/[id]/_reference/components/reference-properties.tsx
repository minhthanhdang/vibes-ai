"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { ANALYSIS_DIMENSIONS, tagLabel, type AnalysisProperties } from "@/lib/analysis/analysis";
import { analysisRequestLabel, analysisView, isAnalysisPending } from "@/lib/analysis/analysis-view";
import { ColorPalette } from "@/components/color-palette";

const POLL_MS = 4000;

const DEAD_END_MESSAGE = {
  empty: "No properties found for this reference.",
  unanalyzed: "This reference has not been analyzed yet.",
} as const;

export function ReferenceProperties({ referenceId }: { referenceId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const propertiesQuery = trpc.reference.properties.queryOptions(
    { referenceId },
    {
      refetchInterval: ({ state }) =>
        state.data && !isAnalysisPending(analysisView(state.data)) ? false : POLL_MS,
    },
  );
  const { data, isPending, error } = useQuery(propertiesQuery);

  const requestAnalysis = useMutation(
    trpc.reference.requestAnalysis.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: propertiesQuery.queryKey }),
    }),
  );

  if (error) return <Notice tone="error">{error.message}</Notice>;
  if (isPending || !data) return <PendingProperties message="Loading…" />;

  const view = analysisView(data);
  if (view.kind === "ready") return <Properties properties={view.properties} />;
  if (view.kind === "pending") return <PendingProperties message={view.message} />;

  const label = analysisRequestLabel(view);
  return (
    <div className="flex flex-col items-start gap-3">
      <Notice tone={view.kind === "failed" ? "error" : "muted"}>
        {view.kind === "failed" ? view.message : DEAD_END_MESSAGE[view.kind]}
      </Notice>

      {label ? (
        <button
          type="button"
          onClick={() => requestAnalysis.mutate({ referenceId })}
          disabled={requestAnalysis.isPending}
          className="rounded-full border border-current/20 px-3 py-1.5 text-xs hover:bg-current/8 disabled:opacity-50"
        >
          {requestAnalysis.isPending ? "Queueing…" : label}
        </button>
      ) : null}

      {requestAnalysis.error ? (
        <Notice tone="error">{requestAnalysis.error.message}</Notice>
      ) : null}
    </div>
  );
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
