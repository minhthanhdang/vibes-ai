import type { PageTargets } from "@/lib/pages/page-mark";
import { ISLAND, ISLAND_BUTTON } from "./island";

/// The user's own page controls (§V.1–2), on the board rather than in the
/// chat: a page is a rectangle on their canvas, and the two ways of getting one
/// are asking for a new one and saying that a frame they already drew is one.
///
/// Both say what they will do before they are pressed, because both change what
/// everything inside the rectangle *belongs to* — a first page drawn on a
/// hand-made board adopts what it lands over, which is the whole board.
export function PageAction({
  targets,
  onAddPage,
  onMarkAsPage,
}: {
  targets: PageTargets;
  onAddPage: () => void;
  onMarkAsPage: () => void;
}) {
  const { pages, sourcePageId, promotable } = targets;

  return (
    <div className={ISLAND}>
      <button
        type="button"
        onClick={onAddPage}
        title={
          pages === 0
            ? "Draw the board's first page around what is already on it — nothing moves, and the board can then be read, laid out and attached to a message a page at a time"
            : sourcePageId
              ? "Add a page the size of the selected one, to the right of the board's rightmost page"
              : "Add a page the size of the board's last one, to the right of its rightmost page"
        }
        className={ISLAND_BUTTON}
      >
        {pages === 0 ? "Page this board" : "Add page"}
      </button>
      {promotable > 0 ? (
        <button
          type="button"
          onClick={onMarkAsPage}
          title={
            promotable === 1
              ? "Make the selected frame a page, exactly where and as big as it is — it keeps its name and nothing on it moves"
              : `Make each of the ${promotable} selected frames a page, exactly where and as big as they are`
          }
          className={`${ISLAND_BUTTON} border-l border-[var(--default-border-color)]`}
        >
          {promotable === 1 ? "This frame is a page" : `${promotable} frames are pages`}
        </button>
      ) : null}
    </div>
  );
}