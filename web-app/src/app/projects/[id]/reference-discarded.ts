"use client";

import type { DiscardedReference } from "@/lib/references/reference-discard";

/// A picture that has just stopped existing, on its way to the conversation.
///
/// The third event to cross between the columns, and it is announced from every
/// door a removal can go by — the chat's own Remove button, the gallery tile's,
/// and the versions list's — for the reason a discarded board is: the chat may
/// be holding a tile of it, and a tile whose picture is gone is a click that
/// does nothing at all. `resolveSecondLevelSelection` answers null for an id the
/// gallery no longer lists, so the panel simply does not move, which is the one
/// kind of failure this pipeline reports to nobody.
///
/// An event rather than a store, like a taken cut: it happens once, and reading
/// it twice would say it twice in the conversation.
type Listener = (reference: DiscardedReference) => void;

const listeners = new Set<Listener>();

export function onReferenceDiscarded(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/// Copied before the walk, for the reason `announceCutTaken` copies: a listener
/// that unsubscribes while handling would mutate the set being iterated.
export function announceReferenceDiscarded(reference: DiscardedReference) {
  for (const listener of [...listeners]) listener(reference);
}
