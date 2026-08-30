export function InspectorHeader({
  title,
  onBack,
  onClose,
}: {
  title: string;
  onBack?: (() => void) | null;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-current/10 px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>
      <button
        type="button"
        onClick={onBack ?? onClose}
        aria-label={onBack ? "Back to the selected reference" : "Close properties"}
        className="shrink-0 rounded-md border border-current/20 px-1.5 py-0.5 text-[11px] opacity-70 hover:opacity-100"
      >
        {onBack ? "←" : "✕"}
      </button>
    </div>
  );
}