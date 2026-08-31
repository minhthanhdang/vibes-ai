"use client";

import { editSaid } from "@/lib/edit/edit-said";
import { editBox } from "@/lib/references/reference-edit";
import { editOps, type EditOp } from "@/lib/edit/edit-ops";
import { cropBoxOutline } from "@/lib/references/reference-version";

export type EditMark = readonly EditOp[] | null | undefined;

export function EditOverlay({ mark }: { mark: EditMark }) {
  const ops = editOps(mark);
  if (!ops.length) return null;

  const outline = cropBoxOutline(editBox(ops));
  if (outline) {
    return (
      <div
        aria-hidden
        style={{
          left: `${outline.left}%`,
          top: `${outline.top}%`,
          width: `${outline.width}%`,
          height: `${outline.height}%`,
        }}
        className="pointer-events-none absolute border border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
      />
    );
  }

  const said = editSaid(ops);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 border border-white/90" />
      {said ? (
        <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
          {said}
        </span>
      ) : null}
    </div>
  );
}
