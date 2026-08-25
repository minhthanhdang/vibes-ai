import type { BoardPreview as BoardPreviewData } from "@/lib/boards/board-preview";

/// `h-24`, as a number. A preview's inner box is sized off it in pixels rather
/// than by `aspect-ratio`, because a block box with a definite height and
/// `width: auto` fills its line instead of taking its shape — which is the
/// stretch both previews below exist to avoid.
const PREVIEW_STRIP_HEIGHT = 96;

/// The board that was composed, at the size of a thumbnail.
///
/// The page is a box at the page's own shape — a portrait masonry board is a
/// tall sliver in the strip and a widescreen diptych nearly fills it, which is
/// the first true thing about a board and the one a single cover photograph
/// cannot say. Every placement is positioned in percent inside it, so the
/// miniature is the arrangement rather than a picture of one of its parts.
///
/// A photograph is drawn at the box it occupies on the board, gaps and all: a
/// picture sitting loose in its slot looks loose here too, which is the same
/// thing the reply's own sentence about cropping is about.
export function BoardPreview({ preview }: { preview: BoardPreviewData }) {
  return (
    <span className="flex h-24 w-full items-center justify-center overflow-hidden rounded bg-current/5">
      <span
        className="relative block shrink-0 overflow-hidden rounded-[2px] bg-white/90"
        style={{
          height: PREVIEW_STRIP_HEIGHT,
          width: Math.round(PREVIEW_STRIP_HEIGHT * preview.aspectRatio),
        }}
      >
        {preview.items.map((item, index) => (
          <span
            key={index}
            className={`absolute block overflow-hidden ${
              item.kind === "text" ? "bg-black/20" : "bg-black/5"
            }`}
            style={{
              left: `${item.left}%`,
              top: `${item.top}%`,
              width: `${item.width}%`,
              height: `${item.height}%`,
              ...(item.angle && { transform: `rotate(${item.angle}deg)` }),
            }}
          >
            {item.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumbUrl} alt="" className="h-full w-full object-cover" />
            ) : null}
          </span>
        ))}
      </span>
    </span>
  );
}