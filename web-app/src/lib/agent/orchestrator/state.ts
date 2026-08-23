import type { ProjectState } from "@/lib/agent/shared/tool-declaration";

/// A project with one of everything: what a declaration says when nothing about
/// the project rules anything out.
export const EVERYTHING: ProjectState = { photographs: 1, crops: 1, boards: 1 };

/// Where the ids a tool takes come from, said as this project can answer it.
export function idsFrom(crops: number) {
  return crops > 0 ? "the list in your instructions or list_references" : "the list in your instructions";
}
