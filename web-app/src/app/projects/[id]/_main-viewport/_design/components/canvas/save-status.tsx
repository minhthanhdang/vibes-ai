import { autosaveLabel, type AutosaveStatus } from "@/lib/scene/moodboard-autosave";

/// Sits over the canvas rather than in a toolbar: the only time it has to be
/// read is when a save has stopped happening, and that has to be visible
/// wherever the user is looking.
export function SaveStatus({
  status,
  onRetry,
  onReload,
}: {
  status: AutosaveStatus;
  onRetry: () => void;
  onReload: () => void;
}) {
  const broken = status === "error" || status === "conflict";
  const label = autosaveLabel(status);

  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
      {broken ? (
        <button
          type="button"
          onClick={status === "conflict" ? onReload : onRetry}
          className="pointer-events-auto rounded-full bg-red-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
        >
          {label}
        </button>
      ) : (
        <span
          className={`rounded-full bg-black/70 px-3 py-1 text-[11px] text-white transition-opacity ${
            status === "idle" ? "opacity-0" : "opacity-100"
          }`}
        >
          {label}
        </span>
      )}
    </div>
  );
}