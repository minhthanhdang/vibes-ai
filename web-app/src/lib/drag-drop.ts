import { isUploadContentType, type UploadContentType } from "./image-types";

export type UploadableFile = { file: File; contentType: UploadContentType };

export type SortedDrop = { uploadable: UploadableFile[]; unsupported: File[] };

/// A drop carries whatever the OS handed over — a HEIC straight off a phone, a
/// PDF, a folder (which arrives as a typeless File). Splitting the batch before
/// anything starts means an unsupported file never gets a placeholder tile it
/// would only lose a moment later, and the content type is narrowed once, here,
/// rather than re-checked at the signed-URL call.
export function sortDroppedFiles(files: Iterable<File>): SortedDrop {
  const sorted: SortedDrop = { uploadable: [], unsupported: [] };

  for (const file of files) {
    if (isUploadContentType(file.type)) sorted.uploadable.push({ file, contentType: file.type });
    else sorted.unsupported.push(file);
  }

  return sorted;
}

/// dragenter/dragleave bubble, so crossing from the drop zone onto a button
/// inside it fires a leave the same as walking off the window does. Counting
/// enters against leaves is what tells the two apart.
export function nextDragDepth(depth: number, event: "enter" | "leave" | "drop"): number {
  if (event === "drop") return 0;
  if (event === "enter") return depth + 1;
  return Math.max(0, depth - 1);
}

/// Dragging selected text or a link across the page is not an upload — only a
/// drag advertising files should light the page up as a drop target.
export function isFileDrag(types: readonly string[] | undefined): boolean {
  return types?.includes("Files") ?? false;
}
