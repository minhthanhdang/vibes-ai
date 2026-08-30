const NARROW = /[iljt.,:;'`!|()[\]/\\-]/;
const WIDE = /[mwMW@%]/;

export type SetMetric = {
  space: number;
  narrow: number;
  wide: number;
  upper: number;
  digit: number;
  other: number;
};

export const SET_EXCALIFONT: SetMetric = {
  space: 0.4,
  narrow: 0.36,
  wide: 0.727,
  upper: 0.678,
  digit: 0.606,
  other: 0.543,
};

export const SET_LIBERATION: SetMetric = {
  space: 0.278,
  narrow: 0.272,
  wide: 0.833,
  upper: 0.66,
  digit: 0.556,
  other: 0.511,
};

export const SET_CASCADIA: SetMetric = {
  space: 0.586,
  narrow: 0.586,
  wide: 0.586,
  upper: 0.586,
  digit: 0.586,
  other: 0.586,
};

export const SET_COMICSHANNS: SetMetric = {
  space: 0.55,
  narrow: 0.55,
  wide: 0.55,
  upper: 0.55,
  digit: 0.55,
  other: 0.55,
};

export const SET_NUNITO: SetMetric = {
  space: 0.261,
  narrow: 0.284,
  wide: 0.917,
  upper: 0.639,
  digit: 0.6,
  other: 0.523,
};

export const SET_LILITA: SetMetric = {
  space: 0.188,
  narrow: 0.349,
  wide: 0.85,
  upper: 0.583,
  digit: 0.543,
  other: 0.501,
};

export const SET_VIRGIL: SetMetric = {
  space: 0.5,
  narrow: 0.351,
  wide: 0.689,
  upper: 0.656,
  digit: 0.616,
  other: 0.524,
};

export const DEFAULT_SET = SET_EXCALIFONT;

export function classOf(char: string): keyof SetMetric {
  if (char === " ") return "space";
  if (NARROW.test(char)) return "narrow";
  if (WIDE.test(char)) return "wide";
  if (char >= "A" && char <= "Z") return "upper";
  if (char >= "0" && char <= "9") return "digit";
  return "other";
}

export function advance(char: string, metric: SetMetric): number {
  return metric[classOf(char)];
}
