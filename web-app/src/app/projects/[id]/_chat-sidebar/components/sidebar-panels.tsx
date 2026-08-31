"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/react";
import { liveVibesCount } from "@/lib/vibes/vibes-panel";
import { SidebarGallery } from "./sidebar-gallery";
import { VibesRunPanel } from "../../_main-viewport/_design/_vibes/components/vibes-run-panel";
import {
  setSidebarTab,
  useSidebarTabStore,
} from "../../_workspace/stores/use-sidebar-tab-store";
import {
  openPanels,
  togglePanels,
  useSidebarStore,
} from "../../_workspace/stores/use-sidebar-store";

const TABS = [
  { id: "references", label: "References" },
  { id: "vibes", label: "Vibes" },
] as const;

export function SidebarPanels({ projectId }: { projectId: string }) {
  const trpc = useTRPC();
  const tab = useSidebarTabStore((state) => state.tab);
  const arePanelsOpen = useSidebarStore((state) => state.arePanelsOpen);
  const { data } = useQuery(trpc.vibes.activeRuns.queryOptions({ projectId }));
  const live = liveVibesCount(data?.boards ?? []);

  return (
    <div className="flex max-h-72 shrink-0 flex-col gap-2 border-b border-current/10 p-3">
      <nav className="flex shrink-0 items-center gap-3">
        {TABS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              setSidebarTab(option.id);
              openPanels();
            }}
            aria-current={tab === option.id}
            className={`flex items-center gap-1 border-b-2 pb-0.5 text-[11px] font-medium tracking-widest uppercase transition-opacity ${
              tab === option.id
                ? "border-current/50 opacity-80"
                : "border-transparent opacity-45 hover:opacity-70"
            }`}
          >
            {option.label}
            {option.id === "vibes" && live > 0 ? (
              <span aria-label={`${live} running`} className="size-1.5 rounded-full bg-sky-500" />
            ) : null}
          </button>
        ))}

        <button
          type="button"
          onClick={togglePanels}
          aria-expanded={arePanelsOpen}
          aria-label={arePanelsOpen ? "Collapse panels" : "Expand panels"}
          className="ml-auto text-xs opacity-45 transition-opacity hover:opacity-80"
        >
          {arePanelsOpen ? "⌄" : "⌃"}
        </button>
      </nav>

      {arePanelsOpen ? (
        tab === "references" ? (
          <SidebarGallery projectId={projectId} />
        ) : (
          <VibesRunPanel projectId={projectId} />
        )
      ) : null}
    </div>
  );
}
