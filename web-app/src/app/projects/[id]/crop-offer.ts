"use client";

import { useSyncExternalStore } from "react";
import type { CropOffer } from "@/lib/crop/crop-offer";

/// The cut the assistant has offered and nobody has looked at yet.
///
/// The same cross-column problem `reference-inspection.ts` and `board-selection.ts`
/// solve, with one thing more to carry: a board is opened by id, but an offer is
/// not in the database at all — there is no row to fetch it back from, so the
/// offer itself travels from the chat to the review that will judge it.
///
/// Taken once. The crop hook clears it the moment it adopts it, so a director who
/// closes the panel and opens the same frame an hour later is not handed a box
/// they already declined.
const listeners = new Set<() => void>();
let offered: CropOffer | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readOffered() {
  return offered;
}

function announce() {
  for (const listener of listeners) listener();
}

export function offerCrop(offer: CropOffer | null) {
  if (offered === offer) return;
  offered = offer;
  announce();
}

/// The offer waiting on *this* frame, or null. Every mounted crop hook reads the
/// same store, and only the one showing the frame the cut is of may take it.
export function useOfferedCrop(referenceId: string) {
  const current = useSyncExternalStore(subscribe, readOffered, () => null);
  return current?.referenceId === referenceId ? current : null;
}

export function takeCropOffer() {
  if (!offered) return;
  offered = null;
  announce();
}
