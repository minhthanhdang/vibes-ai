import type { ProjectState } from "@/lib/agent/shared/tool-declaration";

export const EVERYTHING: ProjectState = { photographs: 1, crops: 1, boards: 1 };

export function idsFrom(crops: number) {
  return crops > 0 ? "the list in your instructions or list_references" : "the list in your instructions";
}
