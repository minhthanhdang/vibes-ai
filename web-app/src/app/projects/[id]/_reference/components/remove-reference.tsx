"use client";

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
