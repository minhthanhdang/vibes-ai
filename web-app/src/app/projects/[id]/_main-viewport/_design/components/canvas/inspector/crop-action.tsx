/// The crop the user framed on the board, kept as a photo of the project.
///
/// Excalidraw's crop is a window onto the whole file, and everything outside the
/// canvas keeps seeing the file: the gallery shows the frame that was cut away,
/// agent 2 reads a palette off it, a deck built from these references gets the
/// wide shot, and the board downloads the whole photograph to draw a corner of
/// it. "This part of this frame is the shot" is a judgement worth keeping, so
/// this is where it stops being a property of one element on one board.
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