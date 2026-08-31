import {
  CROP_BOX_SCALE,
  CROP_MIN_SIDE,
  cropBoxColumns,
  cropBoxOf,
  cropPixelSize,
  type CropBox,
  type LooseShape,
} from "@/lib/references/reference-version";

const MIN_SIDE_UNITS = Math.round(CROP_MIN_SIDE * CROP_BOX_SCALE);

export type CropAttempt = { box: CropBox } | { fault: string };

export type LooseHeld = { loose: LooseShape; frame: { width?: unknown; height?: unknown } };

export function usableCropBox(value: unknown, held?: LooseHeld): CropAttempt {
  const box = cropBoxOf(value);
  if (!box) {
    return {
      fault: `that answer was not a box of this image. Answer with [ymin, xmin, ymax, xmax] — four whole numbers between 0 and ${CROP_BOX_SCALE}, ymin below ymax and xmin below xmax.`,
    };
  }

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

  if (held) {
    const cut = cropPixelSize(cropBoxColumns(box), held.frame);
    if (cut && cut.height > 0 && !held.loose.holds(cut.width / cut.height)) {
      return { fault: held.loose.missed(cut.width / cut.height) };
    }
  }

  return { box };
}

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
