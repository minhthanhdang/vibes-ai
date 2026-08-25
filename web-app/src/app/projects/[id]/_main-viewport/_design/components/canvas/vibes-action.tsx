import { ISLAND, ISLAND_BUTTON } from "./island";

/// The product's headline action, in the slot tidy used to share
/// (`compositor-v2.md` §IX). A press of tidy is something a user reaches for
/// occasionally and a press of this is what they came for, so this is the one
/// control the island holds beside the page buttons — and tidy moved into
/// `BoardMenu` rather than being deleted.
///
/// Always offered, unlike everything else out here: the other island controls
/// say what they will act on and are hidden when there is nothing, and this one
/// acts on nothing that is already on the board.
export function VibesAction({ onOpen }: { onOpen: () => void }) {
  return (
    <div className={ISLAND}>
      <button
        type="button"
        onClick={onOpen}
        title="Say what you want made — a whole board comes back, one designed page at a time"
        className={`${ISLAND_BUTTON} font-medium`}
      >
        Let&rsquo;s Vibes
      </button>
    </div>
  );
}