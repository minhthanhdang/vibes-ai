/// Which reference the properties panel is showing, when the thing it is
/// showing has versions of its own.
///
/// A cut is filed under the frame it came out of, and `reference.versions` is
/// one level deep on purpose: a cut of a cut is listed under the cut it was
/// made from, "which is where a user went to make it". That sentence only
/// holds if the user can get *to* the cut — so the panel walks, and this is
/// the walk: a trail whose first step is the photograph the gallery opened and
/// whose last step is whatever is on screen.
///
/// The trail is also the only place a version's own analysis is ever read. The
/// analyzer runs on a crop because a crop's palette is the palette of what was
/// kept, not of the parts it cut away — a reading that was being written and
/// never shown until the panel could stand on a version.
///
/// No React and no query here: this is where the trail goes next, given where
/// it is and what was clicked.

export type TrailStep = {
  id: string;
  title: string;
  thumbUrl: string;
  /// What this step is called in the breadcrumb, when its title is not it.
  /// Every cut of one frame is "<the frame> (crop N)", so a version is labelled
  /// by what it was asked for; a photograph has no label and is its title.
  label?: string;
  /// The step's own pixels, which is not what is on screen: the panel draws the
  /// grid-sized copy, so the image the user is being shown a box on says
  /// nothing about how big the cut out of it would be. Both places a step comes
  /// from — the gallery row and a version row — already carry these, so a crop
  /// asked for anywhere on the trail can be measured without a query of its own.
  /// Null on a row uploaded before the browser wrote them.
  width?: number | null;
  height?: number | null;
  /// The description a drawn picture was asked with. It rides on the step
  /// rather than being read back from the analysis, because it is true of the
  /// picture the moment it is filed and the reading it is standing in for may
  /// be minutes away — a generated backdrop with no analysis yet is otherwise a
  /// panel that says only "not analyzed" about a picture the assistant wrote.
  /// Absent on a photograph, and on a version, which nobody drew from words.
  generationPrompt?: string | null;
};

/// What the picture was drawn from, or nothing. Trimmed here for `trailLabel`'s
/// reason: an empty string is a row with no prompt on it, not a prompt that
/// says nothing, and the panel must not open a quotation mark on it.
export function trailGenerationPrompt(step: TrailStep) {
  return step.generationPrompt?.trim() || null;
}

export function trailCurrent(trail: TrailStep[]) {
  return trail[trail.length - 1] ?? null;
}

export function trailLabel(step: TrailStep) {
  return step.label?.trim() || step.title.trim() || "Reference";
}

/// Drilling into a version.
///
/// Opening something already on the trail truncates to it rather than appending
/// a second copy: a user who walks A → B, clicks back to A and opens B
/// again is two steps deep, not three, and the breadcrumb of a chain that
/// cannot fork should not be able to say the same name twice.
export function openedTrail(trail: TrailStep[], step: TrailStep): TrailStep[] {
  const known = trail.findIndex((seen) => seen.id === step.id);
  if (known >= 0) return trail.slice(0, known + 1);
  return [...trail, step];
}

/// A breadcrumb click. An id that is not on the trail leaves it alone — the
/// crumb the user pressed is gone, and guessing which one they meant is
/// worse than the press doing nothing.
export function trailUpTo(trail: TrailStep[], id: string): TrailStep[] {
  const known = trail.findIndex((step) => step.id === id);
  return known >= 0 ? trail.slice(0, known + 1) : trail;
}

/// One step back, and never past the photograph the panel was opened on — the
/// way out of the root is closing the panel, which is a different gesture with
/// a different button.
export function trailBack(trail: TrailStep[]): TrailStep[] {
  return trail.length > 1 ? trail.slice(0, -1) : trail;
}

export function isTrailRoot(trail: TrailStep[]) {
  return trail.length <= 1;
}
