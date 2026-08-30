"use client";

import { create } from "zustand";
import type { WorkspaceView } from "../types";

type WorkspaceViewState = {
  view: WorkspaceView;
  setWorkspaceView: (view: WorkspaceView) => void;
};

export const useWorkspaceViewStore = create<WorkspaceViewState>()((set) => ({
  view: "gallery",
  setWorkspaceView: (view) => set({ view }),
}));

const WORKSPACE_VIEWS: readonly WorkspaceView[] = ["gallery", "design", "preview"];

function parseWorkspaceView(hash: string): WorkspaceView | null {
  const candidate = hash.replace(/^#/, "");
  return (WORKSPACE_VIEWS as readonly string[]).includes(candidate)
    ? (candidate as WorkspaceView)
    : null;
}

export function setWorkspaceView(view: WorkspaceView) {
  useWorkspaceViewStore.getState().setWorkspaceView(view);
  window.location.hash = view;
}

export function syncWorkspaceViewFromHash() {
  const apply = () => {
    const view = parseWorkspaceView(window.location.hash);
    if (view) useWorkspaceViewStore.getState().setWorkspaceView(view);
  };
  apply();
  window.addEventListener("hashchange", apply);
  return () => window.removeEventListener("hashchange", apply);
}
