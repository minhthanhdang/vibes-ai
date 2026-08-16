"use client";

import { useEffect, useRef, useState } from "react";
import { isFileDrag, nextDragDepth } from "@/lib/drag-drop";

/// Listens on the window rather than on the drop zone element: a file dropped
/// anywhere the page does not handle makes the browser navigate the tab to that
/// file, throwing away the workspace. Owning every drop also means the director
/// can aim at the gallery — the obvious target once it is full of images —
/// instead of hunting for the dashed box above it.
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const depth = useRef(0);
  const latestOnFiles = useRef(onFiles);

  useEffect(() => {
    latestOnFiles.current = onFiles;
  });

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer?.types)) return;
      depth.current = nextDragDepth(depth.current, "enter");
      setIsDragging(true);
    };

    const onDragOver = (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer?.types)) return;
      // Without this the drop event never fires at all.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };

    const onDragLeave = () => {
      depth.current = nextDragDepth(depth.current, "leave");
      if (depth.current === 0) setIsDragging(false);
    };

    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      depth.current = nextDragDepth(depth.current, "drop");
      setIsDragging(false);

      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length) latestOnFiles.current(files);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);

    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return isDragging;
}
