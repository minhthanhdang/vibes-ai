"use client";

import { create } from "zustand";
import type { WorkspaceView } from "../types";

/// Which of the two main-viewport surfaces is on screen.
///
/// A store rather than the workspace's own `useState` because the write comes
/// from the other column: clicking an attachment in the chat switches the
/// viewport to the surface that attachment lives on — a reference to the
/// gallery, a board to the design view — and after the split those two are in
/// different branches of the tree with nothing between them but the shell.
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

/// The view is mirrored into the URL hash so a reload lands back on the same
/// surface instead of the store's default. Assigning an unchanged hash is a
/// no-op in the browser, so the write side and the `hashchange` listener in
/// `useWorkspaceViewFromHash` do not feed each other.
export function setWorkspaceView(view: WorkspaceView) {
  useWorkspaceViewStore.getState().setWorkspaceView(view);
  window.location.hash = view;
}

/// Mounted once by the workspace: adopts the hash the page loaded with, then
/// follows back/forward moves between hashes.
export function syncWorkspaceViewFromHash() {
  const apply = () => {
    const view = parseWorkspaceView(window.location.hash);
    if (view) useWorkspaceViewStore.getState().setWorkspaceView(view);
  };
  apply();
  window.addEventListener("hashchange", apply);
  return () => window.removeEventListener("hashchange", apply);
}
