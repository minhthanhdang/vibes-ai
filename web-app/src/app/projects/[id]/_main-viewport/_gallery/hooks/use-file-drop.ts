"use client";

import { useEffect, useRef, useState } from "react";
import { isFileDrag, nextDragDepth } from "@/lib/intake/drag-drop";

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
