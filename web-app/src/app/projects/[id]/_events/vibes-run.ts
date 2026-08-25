"use client";

import type { VibesStep } from "@/lib/vibes/vibes-loop";

/// A Vibes run, on its way from the form that started it to the loop that walks
/// it (compositor-v2.md §IX.2).
///
/// It crosses because the two are not in the same tree and cannot be: the form
/// is inside the editor, the board it just made is the board the panel is about
/// to open, and opening it unmounts the editor the press came from. A run driven
/// from there would stop on its own first page. So the loop lives in the
/// workspace, which outlives every board, and this is how it hears about it.
///
/// An event and not a store, for `cut-taken`'s reason: a run starts once, and a
/// late subscriber reading "there is a run" would start a second one over the
/// pages the first is already designing.
export type VibesRunRequest = {
  boardId: string;
  title: string;
  /// The brief's page count. Equal to `steps.length` for a run that is starting
  /// and larger for one that is being picked up (§IX.5).
  total: number;
  steps: VibesStep[];
};

type Listener = (run: VibesRunRequest) => void;

const listeners = new Set<Listener>();

export function onVibesRun(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/// Copied before the walk, the way every other announcement here is: a listener
/// that unsubscribes while handling would mutate the set being iterated.
export function announceVibesRun(run: VibesRunRequest) {
  for (const listener of [...listeners]) listener(run);
}
