const SIZES = {
  sm: { swatch: "size-6", overlap: "-ml-2" },
  md: { swatch: "size-9", overlap: "-ml-3" },
} as const;

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
