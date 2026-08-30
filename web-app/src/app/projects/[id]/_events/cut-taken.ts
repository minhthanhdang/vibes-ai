"use client";

import type { TakenCut } from "@/lib/crop/cut-taken";

type Listener = (cut: TakenCut) => void;

const listeners = new Set<Listener>();

export function onCutTaken(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function announceCutTaken(cut: TakenCut) {
  for (const listener of [...listeners]) listener(cut);
}
