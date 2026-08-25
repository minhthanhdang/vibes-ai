/// The panel's title row, and the one way out of whichever level it is on.
export function InspectorHeader({
  title,
  onBack,
  onClose,
}: {
  title: string;
  /// Set only while the panel is reading a frame it stepped up to. It takes the
  /// close button's place rather than sitting beside it, as the sidebar panel's
  /// own walk does: the way out of a frame is back to the picture on the board,
  /// and closing the panel from there would put away the thing the user
  /// stepped up from.
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