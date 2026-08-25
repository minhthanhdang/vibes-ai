"use client";

import type { TakenCut } from "@/lib/crop/cut-taken";

/// The cut the user just kept, on its way to the chat that cannot see it.
///
/// The third thing to cross between the columns, and the only one that is an
/// *event* rather than a piece of state. The two before it — the inspected
/// reference, the requested board — are both "this is the thing being pointed at
/// now", so they are stores: a late subscriber reads what is current and a
/// second read is the same answer. A cut being kept is neither. It
/// happens once, it is true afterwards forever, and reading it twice would put
/// the same line in the conversation twice.
///
/// So there is nothing to read: listeners are called with the cut and it is gone.
/// The cost of that is a note lost if the chat is not mounted, which is the right
/// trade — a note that arrives an hour later, under an answer about something
/// else, is worse than no note.
type Listener = (cut: TakenCut) => void;

const listeners = new Set<Listener>();

export function onCutTaken(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/// Copied before the walk: a listener that unsubscribes as it handles the event
/// would otherwise mutate the set being iterated.
export function announceCutTaken(cut: TakenCut) {
  for (const listener of [...listeners]) listener(cut);
}
