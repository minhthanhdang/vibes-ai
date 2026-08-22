import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { unreadReason, type ToolReference } from "@/lib/agent/agent-tools";
import { RunStatus } from "@/generated/prisma/enums";
import {
  GALLERY_ORDER,
  TOOL_REFERENCE_SELECT,
  toolReferences,
  unreadReasons,
  type ReferenceRow,
} from "@/server/references/tool-references";

/// The project's pictures, read once per design call and shared by every toolset
/// agent 8 is assembled out of (compositor-v2.md §IV).
///
/// Agent 6's toolset reads them once per turn for one reason and this reads them
/// once per call for two. `list_gallery` and `get_image` are two questions about
/// one set, and the second one resolving an id against a list the first never saw
/// is how a model is told a picture it was just given does not exist. And over
/// twelve rounds of a loop, two toolsets each asking for themselves is the
/// difference between a query per look and a query per design: `get_page`'s
/// blocks name the same rows `list_gallery`'s lines do, because a picture on a
/// page and a row in the gallery are described in one dialect (tech-spec §V.4).
///
/// A promise is what is memoised rather than its result, so two tools called in
/// one round share one read rather than starting two.

/// The columns agent 8 reads, which are agent 6's plus one.
///
/// `editRationale` is agent 3's own account of why a cut is where it is, and
/// `get_modification` is the only door in either agent that answers with it — so
/// it is read here rather than added to the shared select, where every turn of
/// every orchestrator call would carry a sentence nothing reads.
export const DESIGNER_REFERENCE_SELECT = {
  ...TOOL_REFERENCE_SELECT,
  editRationale: true,
} as const;

/// The row as agent 8 holds it: the shared shape, plus the two columns that only
/// ever leave through `get_modification`.
export type DesignerReferenceRow = ReferenceRow & {
  editRationale: string;
  cropBox: unknown;
};

export type DesignerReferenceRead = {
  all: ToolReference[];
  /// The rows as the database gave them, bucket paths and all. Kept beside the
  /// model's copy and never in it: a `gs://` uri in JSON is one a model will put
  /// in a sentence, and a picture reaches it as a part, from code.
  rows: Map<string, DesignerReferenceRow>;
};

/// The read, with the one door that changes what it answers.
///
/// A function with a method on it rather than a pair, so every caller that only
/// reads is written the way it was before this existed: `references()` is the
/// question, and `references.file(row)` is the single place a row filed
/// mid-design becomes one of the pictures the rest of the call can see.
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

  /// A picture filed part-way through a design, folded into the read the design
  /// was built on.
  ///
  /// The read is memoised once per call — that is what makes a twelve-round loop
  /// one query — so a row `generate_image` files on round three is invisible to
  /// every tool that runs after it. The id the answer just promised would come
  /// back "no picture called that" from `put_on_canvas` on round four, which is
  /// the round the declaration says it can be placed on.
  ///
  /// Chained onto the promise rather than computed off its value, because two
  /// generations in one round run side by side and the second one building its
  /// list from the list the first started with would drop the first.
  read.file = (row) => {
    const [filed] = toolReferences(
      [row],
      new Map([[row.id, unreadReason({ status: RunStatus.QUEUED })]]),
    );
    const made = filed!;
    loaded = read().then(({ all, rows }) => ({
      /// Where the gallery puts it: `GALLERY_ORDER` is the stars first and the
      /// newest of the rest under them, and this is the newest of the rest.
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
