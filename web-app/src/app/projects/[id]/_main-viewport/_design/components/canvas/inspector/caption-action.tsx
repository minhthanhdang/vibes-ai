import { captionText } from "@/lib/canvas/moodboard-caption";
import { referenceCaption } from "@/lib/references/reference-version";

/// What the reference is, put on the board as a caption grouped with the photo.
///
/// A moodboard is images and what is said about them, and until now saying it
/// meant drawing a text element that knew nothing about the photo — separated
/// from it by the first tidy, and left behind by the first drag. Grouping the
/// two is what makes a caption belong to a photo, and what the user already
/// said about the reference is the caption they would have typed: its title for
/// a photograph, and for a cut the frame plus what that cut keeps, since every
/// cut of one frame carries one title between them (`referenceCaption`).
export function CaptionAction({
  reference,
  count,
  onCaption,
}: {
  reference: Parameters<typeof referenceCaption>[0];
  count: number;
  onCaption: (text: string) => void;
}) {
  const text = captionText(referenceCaption(reference));
  if (!text) return null;

  return (
    <button
      type="button"
      onClick={() => onCaption(text)}
      title={`Add “${text}” under ${count === 1 ? "the photo" : `each of the ${count} photos`}, grouped with it so it moves and tidies as one`}
      className="self-start rounded-md border border-current/20 px-2 py-1 text-[11px] hover:bg-current/5"
    >
      {count === 1
        ? /// A cut's caption is not its title, and a button that says it is
          /// offers the "(crop 2)" name this deliberately does not use.
          reference.source
          ? "Caption with what it is"
          : "Caption with its title"
        : `Caption ${count} photos`}
    </button>
  );
}