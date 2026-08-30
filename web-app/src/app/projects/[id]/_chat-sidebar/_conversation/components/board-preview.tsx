import type { BoardPreview as BoardPreviewData } from "@/lib/boards/board-preview";

const PREVIEW_STRIP_HEIGHT = 96;

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