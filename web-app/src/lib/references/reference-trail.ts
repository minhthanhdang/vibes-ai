export type TrailStep = {
  id: string;
  title: string;
  thumbUrl: string;
  label?: string;
  width?: number | null;
  height?: number | null;
  generationPrompt?: string | null;
};

export function trailCurrent(trail: TrailStep[]) {
  return trail[trail.length - 1] ?? null;
}

export function trailLabel(step: TrailStep) {
  return step.label?.trim() || step.title.trim() || "Reference";
}

export function openedTrail(trail: TrailStep[], step: TrailStep): TrailStep[] {
  const known = trail.findIndex((seen) => seen.id === step.id);
  if (known >= 0) return trail.slice(0, known + 1);
  return [...trail, step];
}

export function trailUpTo(trail: TrailStep[], id: string): TrailStep[] {
  const known = trail.findIndex((step) => step.id === id);
  return known >= 0 ? trail.slice(0, known + 1) : trail;
}

export function trailBack(trail: TrailStep[]): TrailStep[] {
  return trail.length > 1 ? trail.slice(0, -1) : trail;
}

export function isTrailRoot(trail: TrailStep[]) {
  return trail.length <= 1;
}
