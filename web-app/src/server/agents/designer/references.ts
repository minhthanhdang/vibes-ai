import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { type ToolReference, unreadReason } from "@/lib/agent/shared/reference";
import { RunStatus } from "@/generated/prisma/enums";
import {
  GALLERY_ORDER,
  TOOL_REFERENCE_SELECT,
  toolReferences,
  unreadReasons,
  type ReferenceRow,
} from "@/server/references/tool-references";

export const DESIGNER_REFERENCE_SELECT = {
  ...TOOL_REFERENCE_SELECT,
  editRationale: true,
} as const;

export type DesignerReferenceRow = ReferenceRow & {
  editRationale: string;
};

export type DesignerReferenceRead = {
  all: ToolReference[];
  rows: Map<string, DesignerReferenceRow>;
};

export type DesignerReferences = (() => Promise<DesignerReferenceRead>) & {
  file: (row: ReferenceRow) => ToolReference;
};

export function designerReferences({
  db,
  projectId,
}: {
  db: PrismaClient;
  projectId: string;
}): DesignerReferences {
  let loaded: Promise<DesignerReferenceRead> | null = null;

  const read = (() => {
    loaded ??= db.reference
      .findMany({
        where: { projectId },
        orderBy: [...GALLERY_ORDER],
        select: DESIGNER_REFERENCE_SELECT,
      })
      .then(async (found) => {
        const rows = found as DesignerReferenceRow[];
        return {
          all: toolReferences(rows, await unreadReasons(db, projectId, rows)),
          rows: new Map(rows.map((row) => [row.id, row])),
        };
      });
    return loaded;
  }) as DesignerReferences;

  read.file = (row) => {
    const [filed] = toolReferences(
      [row],
      new Map([[row.id, unreadReason({ status: RunStatus.QUEUED })]]),
    );
    const made = filed!;
    loaded = read().then(({ all, rows }) => ({
      all: (() => {
        const under = all.findIndex((reference) => !reference.favorite);
        return under < 0 ? [...all, made] : [...all.slice(0, under), made, ...all.slice(under)];
      })(),
      rows: new Map(rows).set(row.id, row as DesignerReferenceRow),
    }));
    return made;
  };

  return read;
}
