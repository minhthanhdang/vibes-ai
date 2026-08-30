"use client";

/// Removing a reference deletes the row *and* its bucket objects, and it is the
/// one action in the gallery that cannot be undone from anywhere in the app. It
/// was a single unguarded click.
///
/// The guard it needs is not "are you sure" — it is *what this photo is holding
/// up*. A reference on a board is load-bearing somewhere the gallery cannot
/// show: the board is behind a view switch, and after the delete its element
/// becomes one of excalidraw's placeholder boxes with nothing to say why.
///
/// So the confirm step is where the board usage is read, and the confirm is not
/// offered until that read lands: a removal that raced the check would be the
/// unguarded click again, only slower.
export function RemoveReferenceButton({
  isArmed,
  isChecking,
  summary,
  onArm,
  onCancel,
  onConfirm,
}: {
  isArmed: boolean;
  isChecking: boolean;
  /// What the reference is on, or null for a reference on no board — which gets
  /// a plain confirm rather than an empty line, since a warning about nothing is
  /// the thing that teaches the user to click through the warning.
  summary: string | null;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!isArmed) {
    return (
      <button type="button" onClick={onArm} className="shrink-0 opacity-50 hover:opacity-100">
        Remove
      </button>
    );
  }

  return (
    <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      {isChecking ? (
        <span className="opacity-50">Checking boards…</span>
      ) : summary ? (
        <span className="text-[var(--foreground)] opacity-80">{summary}</span>
      ) : null}
      <button
        type="button"
        onClick={onConfirm}
        disabled={isChecking}
        className="rounded bg-current/10 px-1.5 py-0.5 disabled:opacity-40"
      >
        Remove
      </button>
      <button type="button" onClick={onCancel} className="opacity-50 hover:opacity-100">
        Cancel
      </button>
    </span>
  );
}
