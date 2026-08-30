export function CropAction({ count, onKeepCrop }: { count: number; onKeepCrop: () => void }) {
  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={onKeepCrop}
      title={
        count === 1
          ? "Save the cropped area as a reference of its own and point this image at it — nothing moves on the board"
          : "Save each cropped area as a reference of its own and point its image at it — nothing moves on the board"
      }
      className="self-start rounded-md border border-current/20 px-2 py-1 text-[11px] hover:bg-current/5"
    >
      {count === 1 ? "Keep this crop as a reference" : `Keep ${count} crops as references`}
    </button>
  );
}