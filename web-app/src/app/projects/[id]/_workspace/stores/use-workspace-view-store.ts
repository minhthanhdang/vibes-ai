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

export function setWorkspaceView(view: WorkspaceView) {
  useWorkspaceViewStore.getState().setWorkspaceView(view);
}
