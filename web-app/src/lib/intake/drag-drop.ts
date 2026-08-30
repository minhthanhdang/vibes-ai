import { isUploadContentType, type UploadContentType } from "@/lib/intake/image-types";

export type UploadableFile = { file: File; contentType: UploadContentType };

export type SortedDrop = { uploadable: UploadableFile[]; unsupported: File[] };

export function sortDroppedFiles(files: Iterable<File>): SortedDrop {
  const sorted: SortedDrop = { uploadable: [], unsupported: [] };

  for (const file of files) {
    if (isUploadContentType(file.type)) sorted.uploadable.push({ file, contentType: file.type });
    else sorted.unsupported.push(file);
  }

  return sorted;
}

export function nextDragDepth(depth: number, event: "enter" | "leave" | "drop"): number {
  if (event === "drop") return 0;
  if (event === "enter") return depth + 1;
  return Math.max(0, depth - 1);
}

export function isFileDrag(types: readonly string[] | undefined): boolean {
  return types?.includes("Files") ?? false;
}
