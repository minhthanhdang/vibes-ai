"use client";

import type { TakenCut } from "@/lib/crop/cut-taken";

/// The cut the director just took, on its way back to the chat that offered it.
///
/// The fourth thing to cross between the columns, and the first that is an
/// *event* rather than a piece of state. The three before it — the inspected
/// reference, the requested board, the offered crop — are all "this is the thing
/// being pointed at now", so they are stores: a late subscriber reads what is
/// current and a second read is the same answer. A cut being taken is neither. It
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
