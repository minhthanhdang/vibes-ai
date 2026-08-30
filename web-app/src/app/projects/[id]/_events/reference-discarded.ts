"use client";

import type { DiscardedReference } from "@/lib/references/reference-discard";

type Listener = (reference: DiscardedReference) => void;

const listeners = new Set<Listener>();

export function onReferenceDiscarded(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function announceReferenceDiscarded(reference: DiscardedReference) {
  for (const listener of [...listeners]) listener(reference);
}
