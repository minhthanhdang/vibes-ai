import { MainMenu } from "@excalidraw/excalidraw";
import type { ArrangeScope } from "@/lib/canvas/moodboard-arrange";

function holders(count: number, what: string) {
  if (count < 1) return "";
  return count === 1 ? `the ${what}` : `each of the ${count} ${what}s`;
}

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
  if (units < 2) return null;

  const what = scope === "selection" ? `${photos} selected` : `${photos} images`;
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