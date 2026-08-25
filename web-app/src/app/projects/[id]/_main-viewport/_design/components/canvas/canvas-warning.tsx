/// Something on the board is not stored and looks exactly like something that
/// is — the failure has to be said here, because the alternative is the
/// user finding out on tomorrow's reload.
export function CanvasWarning({
  children,
  actionLabel = "Retry",
  onAction,
}: {
  children: React.ReactNode;
  actionLabel?: string;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white shadow-lg">
      <span>{children}</span>
      <button type="button" onClick={onAction} className="font-medium underline underline-offset-2">
        {actionLabel}
      </button>
    </div>
  );
}