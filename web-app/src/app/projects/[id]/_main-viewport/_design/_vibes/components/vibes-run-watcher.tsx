"use client";

import { useVibesRunEffects } from "../hooks/use-vibes-run-effects";

export function VibesRunWatcher({ projectId }: { projectId: string }) {
  useVibesRunEffects(projectId);
  return null;
}
