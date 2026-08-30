import { CanvasWarning } from "./canvas-warning";

export function AdoptionFailure({
  count,
  onRetry,
}: {
  count: number;
  onRetry: (() => void) | null;
}) {
  if (count === 0) return null;

  return (
    <CanvasWarning onAction={onRetry ?? undefined}>
      {count} {count === 1 ? "image" : "images"} could not be added to this project —{" "}
      {count === 1 ? "it" : "they"} will not survive a reload.
    </CanvasWarning>
  );
}
