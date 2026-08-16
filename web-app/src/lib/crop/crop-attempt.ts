import {
  CROP_BOX_SCALE,
  CROP_MIN_SIDE,
  cropBoxColumns,
  cropBoxOf,
  cropPixelSize,
  type CropBox,
  type LooseShape,
} from "@/lib/references/reference-version";

/// What is wrong with a box the cropper answered with, said in words the model
/// can act on — tech-spec §III.3 step 2, the deterministic validation between
/// the vision call and the arithmetic.
///
/// The spec's loop re-prompts with the validation error appended and gives up
/// after three attempts. This is the half that decides there is an error, and it
/// is pure so that "usable box" means one thing whichever door the crop came in
/// by.
///
/// Only faults the model can fix are named here. "The whole frame is the shot"
/// is not one: the cropper is *told* to answer with the whole frame when the
/// frame is the answer, so re-prompting it would be paying a photograph read to
/// argue with an instruction we wrote. That refusal stays where it is, after the
/// loop.

/// Three, from the spec. The ceiling matters more than the number: a model that
/// cannot frame a box is a model that will not frame one on the fourth read
/// either, and each read is a photograph.
export const CROP_MAX_ATTEMPTS = 3;

/// The smallest edge that is a shot rather than a misfire, in the model's own
/// units — the box is 0-1000 of the frame, so this is what the threshold looks
/// like from inside the answer.
const MIN_SIDE_UNITS = Math.round(CROP_MIN_SIDE * CROP_BOX_SCALE);

/// The box, or the sentence saying why there isn't one. A union rather than a
/// box and a separate fault: "usable" and "is a rectangle" are one question
/// asked once, and two answers to it that can disagree is a state nobody has a
/// use for.
export type CropAttempt = { box: CropBox } | { fault: string };

/// The loose shape the box has to land inside, and the frame whose pixels say
/// whether it did. Both or neither: 0-1000 is a share of each edge of a picture
/// that is not square, so a box's shape is not readable without the frame's size.
export type LooseHeld = { loose: LooseShape; frame: { width?: unknown; height?: unknown } };

export function usableCropBox(value: unknown, held?: LooseHeld): CropAttempt {
  const box = cropBoxOf(value);
  if (!box) {
    return {
      fault: `that answer was not a box of this image. Answer with [ymin, xmin, ymax, xmax] — four whole numbers between 0 and ${CROP_BOX_SCALE}, ymin below ymax and xmin below xmax.`,
    };
  }

  /// Caught here rather than downstream, where a sliver and a box that trims
  /// nothing collapse into one null and get reported as "the whole frame is the
  /// shot" — the opposite of what a 12-unit box means.
  const thin = ([
    ["height", box.ymax - box.ymin],
    ["width", box.xmax - box.xmin],
  ] as const).find(([, side]) => side < MIN_SIDE_UNITS);
  if (thin) {
    const [edge, side] = thin;
    return {
      fault: `that box keeps ${side}/${CROP_BOX_SCALE} of the frame's ${edge}, which is a strip rather than a shot. Answer with the whole of what was asked for.`,
    };
  }

  /// The spec's third validation — the box's aspect against the shape that was
  /// asked for — and the only ask it can ever fire on. An *exact* shape is
  /// reached by opening the box out afterwards, so checking the model's own
  /// framing against it would re-prompt a box that is about to become the right
  /// ratio anyway; a *loose* shape has no afterwards, so the box the model
  /// framed is the cut and its shape is the model's to get right.
  ///
  /// A frame whose pixel size was never recorded is not a failure here: nothing
  /// can be measured, so nothing is claimed. The ask still carries the words, it
  /// just goes unchecked rather than turning into a re-prompt nobody can satisfy.
  if (held) {
    const cut = cropPixelSize(cropBoxColumns(box), held.frame);
    if (cut && cut.height > 0 && !held.loose.holds(cut.width / cut.height)) {
      return { fault: held.loose.missed(cut.width / cut.height) };
    }
  }

  return { box };
}

/// Whether the model has just answered with the box it was told was wrong.
///
/// A re-prompt is only worth its photograph read if the answer can move. A model
/// that repeats itself has said everything it has to say about this frame, and
/// the remaining attempts would buy the same sentence twice.
export function sameCropAnswer(answered: unknown, previous: unknown): boolean {
  const box = cropBoxOf(answered);
  const before = cropBoxOf(previous);
  if (!box || !before) return JSON.stringify(answered) === JSON.stringify(previous);
  return (
    box.ymin === before.ymin &&
    box.xmin === before.xmin &&
    box.ymax === before.ymax &&
    box.xmax === before.xmax
  );
}
