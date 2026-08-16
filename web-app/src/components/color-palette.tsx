const SIZES = {
  sm: { swatch: "size-6", overlap: "-ml-2" },
  md: { swatch: "size-9", overlap: "-ml-3" },
} as const;

/// A palette the way a colourist lays one out: swatches in a row, each tucked
/// under the one to its left. The overlap is what makes it read as one palette
/// instead of a row of unrelated dots, and the ring in the page background is
/// what keeps two near-identical colours from merging into a blob.
export function ColorPalette({
  colors,
  size = "md",
  className = "",
}: {
  colors: string[];
  size?: keyof typeof SIZES;
  className?: string;
}) {
  if (!colors.length) return null;
  const { swatch, overlap } = SIZES[size];

  return (
    <ul className={`flex items-center ${className}`}>
      {colors.map((color, index) => (
        /// Ordered most to least prominent, so the leading colour is the one
        /// painted on top — z-index descends with the list, which also means a
        /// hovered swatch grows over its neighbours to the right and only them.
        <li
          key={`${color}-${index}`}
          title={color}
          style={{ backgroundColor: color, zIndex: colors.length - index }}
          className={`relative ${swatch} ${index ? overlap : ""} rounded-full ring-2 ring-[var(--background)] transition-transform duration-150 hover:scale-110`}
        >
          <span className="sr-only">{color}</span>
        </li>
      ))}
    </ul>
  );
}
