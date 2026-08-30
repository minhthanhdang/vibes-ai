import { captionText } from "@/lib/canvas/moodboard-caption";
import { referenceCaption } from "@/lib/references/reference-version";

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
        ?
          reference.source
          ? "Caption with what it is"
          : "Caption with its title"
        : `Caption ${count} photos`}
    </button>
  );
}