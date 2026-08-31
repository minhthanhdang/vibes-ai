import { GRADE_KNOB, HUE_KNOB, type GradeOp } from "@/lib/edit/edit-ops";

export const GRADE_PIVOT = 128;

export const WARMTH_GAIN = 0.25;

export const BRIGHTNESS_FLOOR = 0.05;

export const CONTRAST_FLOOR = 0.05;

export type GradeLinear = { a: [number, number, number]; b: [number, number, number] };

export type GradeModulate = { brightness?: number; saturation?: number; hue?: number };

const round = (value: number) => Math.round(value * 1e6) / 1e6;

function contrastSlope(contrast: number): number {
  return Math.max(CONTRAST_FLOOR, 1 + contrast / GRADE_KNOB);
}

function warmthGains(warmth: number): [number, number, number] {
  const shift = (warmth / GRADE_KNOB) * WARMTH_GAIN;
  return [1 + shift, 1, 1 - shift];
}

export function gradeLinear(grade: GradeOp): GradeLinear | null {
  if (!grade.contrast && !grade.warmth) return null;

  const slope = contrastSlope(grade.contrast);
  const gains = warmthGains(grade.warmth);
  const a = gains.map((gain) => round(slope * gain)) as [number, number, number];
  const b = a.map((slope) => round(GRADE_PIVOT * (1 - slope))) as [number, number, number];
  return { a, b };
}

export function gradeModulate(grade: GradeOp): GradeModulate | null {
  const modulate: GradeModulate = {};
  if (grade.brightness) {
    modulate.brightness = Math.max(BRIGHTNESS_FLOOR, round(1 + grade.brightness / GRADE_KNOB));
  }
  if (grade.saturation) {
    modulate.saturation = Math.max(0, round(1 + grade.saturation / GRADE_KNOB));
  }
  if (grade.hue) modulate.hue = Math.max(-HUE_KNOB, Math.min(HUE_KNOB, Math.round(grade.hue)));

  return Object.keys(modulate).length ? modulate : null;
}
