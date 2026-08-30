import type { ArrangeScope } from "@/lib/canvas/moodboard-arrange";

export type ThemePreference = "light" | "dark" | "system";

export type TidyTargets = {
  scope: ArrangeScope;
  units: number;
  photos: number;
  referenceIds: string[];
  frames: number;
  pages: number;
};

export type Board = { id: string; title: string; renderUrl: string | null };
