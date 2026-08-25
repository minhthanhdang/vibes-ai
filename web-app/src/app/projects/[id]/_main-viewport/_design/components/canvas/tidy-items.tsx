import { MainMenu } from "@excalidraw/excalidraw";
import type { ArrangeScope } from "@/lib/canvas/moodboard-arrange";

/// How the rectangles a tidy fills in place are counted out to the user. A
/// page and a section are the same thing to the layout and two different things
/// to them.
function holders(count: number, what: string) {
  if (count < 1) return "";
  return count === 1 ? `the ${what}` : `each of the ${count} ${what}s`;
}

/// Says what it will act on before it is pressed, because a tidy moves and
/// resizes every photo it touches: two or more selected photos is the user
/// aiming it, anything else is the whole board. Nothing to tidy is a board with
/// fewer than two photos on it, and there the entries are not offered at all
/// rather than sitting there doing nothing.
///
/// The two orders are two entries rather than one, and were two halves of one
/// button in the island: they are the same action — the same layout, the same
/// undo step, the same photos — differing only in what fills the grid first,
/// and a menu has no way to say "and also, in this order" in one row.
///
/// In `BoardMenu` and no longer in the top-right island (`canvas.md` §VI): that
/// slot holds one control and "Let's Vibes" is what belongs in it
/// (`compositor-v2.md` §IX). Nothing about the layout math or its call sites
/// moved — only where the press comes from. A tidy is a board-level action and
/// the menu is where the other board-level actions already are; it is also
/// reached occasionally, which is what makes a menu the right cost.
export function TidyItems({
  scope,
  units,
  photos,
  frames,
  pages,
  byColour,
  onTidy,
}: {
  scope: ArrangeScope;
  units: number;
  photos: number;
  frames: number;
  pages: number;
  byColour: boolean;
  onTidy: (order?: "colour") => void;
}) {
  /// Offered on units rather than on photos: a board that is one group of five
  /// has nothing to rearrange, and an entry that lays a single block back down
  /// where it already was is an entry that does nothing.
  if (units < 2) return null;

  const what = scope === "selection" ? `${photos} selected` : `${photos} images`;
  /// A page and a section are both filled in place, so the photos in one are laid
  /// out inside it and stay in it — said here because the alternative reading,
  /// that a tidy sweeps the whole board into one grid, is what the action does on
  /// a board that has neither. Named apart because they are two things to the
  /// user and only one thing to the layout.
  const filling = [
    holders(pages, "page"),
    holders(frames, "frame"),
  ]
    .filter(Boolean)
    .join(" and ");
  const sections = filling ? `, filling ${filling}` : "";
  return (
    <>
      <MainMenu.Item
        onSelect={() => onTidy()}
        title={`Lay ${what} out in rows of one height, keeping each photo's shape${sections}`}
      >
        Tidy {what}
      </MainMenu.Item>
      {byColour ? (
        <MainMenu.Item
          onSelect={() => onTidy("colour")}
          title={`Lay ${what} out in rows, grouped by the colour of each photo${sections}`}
        >
          Tidy {what} by colour
        </MainMenu.Item>
      ) : null}
    </>
  );
}