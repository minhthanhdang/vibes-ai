import type { ArrangeScope } from "@/lib/canvas/moodboard-arrange";

/// A board is where colour is judged, so which way the canvas is lit is a
/// working decision and not only a matter of taste — it has to be overridable
/// without leaving the board. Deliberately not persisted: "system" is the
/// default and excalidraw's appState has nowhere to say it, so storing the
/// resolved `theme` would freeze tomorrow's board in the light it was opened
/// under today.
export type ThemePreference = "light" | "dark" | "system";

/// What a tidy would act on, resolved where the scene is already being walked.
/// The reference ids are what decides whether the colour sort is on offer — a
/// board the analyzer has not answered on yet would lay out exactly as the plain
/// tidy does, and a button that does that is a button that lies about what it is
/// for.
export type TidyTargets = {
  scope: ArrangeScope;
  /// What the layout moves: a photo, or the group one is in. A board of six
  /// photos where two are grouped with their captions has four.
  units: number;
  photos: number;
  referenceIds: string[];
  /// How many sections hold some of them, so the button can say that each one
  /// is filled in place rather than leaving the user to find out by pressing
  /// it on a board they have divided up.
  frames: number;
  /// And how many *pages* do — counted apart because a page is what the user
  /// calls it, and a tooltip offering to fill "each of the 2 frames" on a spread
  /// is describing their pages in the app's own word for the rectangle.
  pages: number;
};
