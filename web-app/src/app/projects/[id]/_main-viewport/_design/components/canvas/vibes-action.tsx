import { ISLAND, ISLAND_BUTTON } from "./island";

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