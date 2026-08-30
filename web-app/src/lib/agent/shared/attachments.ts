import { ReferenceOrigin } from "@/generated/prisma/enums";
import { clipped, collapsed } from "@/lib/util/text";
import { referenceCaption } from "@/lib/references/reference-version";
import { layoutLabel, type LayoutName } from "@/lib/layout/moodboard-layouts";
import type { BoardPreview } from "@/lib/boards/board-preview";
import type { UsingBoard } from "@/lib/references/reference-usage";
import type { ToolReference } from "@/lib/agent/shared/reference";

export type ReferenceAttachment = {
  kind: "reference";
  referenceId: string;
  frameId: string | null;
  title: string;
  caption: string;
  thumbUrl: string;
  discard?: { cuts: number; boards: UsingBoard[] };
  origin?: ReferenceOrigin | null;
};

export type PageDiscardOffer = { pageId: string; name: string };

export type BoardAttachment = {
  kind: "board";
  boardId: string;
  title: string;
  caption: string;
  thumbUrl: string | null;
  preview: BoardPreview | null;
  lines: string[];
  linesOver: number;
  images: number;
  discard?: true;
  discardPage?: PageDiscardOffer;
};

export type ChatAttachment = ReferenceAttachment | BoardAttachment;

export function attachmentKey(attachment: ChatAttachment) {
  if (attachment.kind === "board") return `board:${attachment.boardId}`;
  return `reference:${attachment.referenceId}`;
}

export function attachmentOf(
  reference: ToolReference,
  discard?: { cuts: number; boards: UsingBoard[] },
): ReferenceAttachment {
  return {
    kind: "reference",
    referenceId: reference.id,
    frameId: reference.source?.id ?? null,
    title: reference.title.trim() || "Untitled",
    caption: referenceCaption(reference),
    thumbUrl: reference.thumbUrl,
    ...(discard && { discard }),
    ...(reference.origin && { origin: reference.origin }),
  };
}

export const BOARD_LINES_SHOWN = 3;
export const BOARD_LINE_CHARS = 60;

function boardLines(lines: readonly string[]) {
  const said = lines.map(collapsed).filter(Boolean);
  return {
    lines: said.slice(0, BOARD_LINES_SHOWN).map((line) => clipped(line, BOARD_LINE_CHARS)),
    linesOver: Math.max(0, said.length - BOARD_LINES_SHOWN),
  };
}

function pageCaption({ name, position, of }: { name: string; position: number; of: number }) {
  if (of <= 1) return "";
  const which = `page ${position} of ${of}`;
  return name.trim() ? `“${name.trim()}”, ${which}` : which;
}

export function boardAttachmentOf({
  id,
  title,
  layout,
  page,
  onPage,
  images,
  lines = [],
  thumbUrl,
  preview = null,
  discard = false,
  discardPage,
}: {
  id: string;
  title: string;
  layout?: LayoutName;
  page?: { width: number; height: number };
  onPage?: { name: string; position: number; of: number };
  images: number;
  lines?: readonly string[];
  thumbUrl: string | null;
  preview?: BoardPreview | null;
  discard?: boolean;
  discardPage?: PageDiscardOffer;
}): BoardAttachment {
  const shape = layout ? layoutLabel(layout) : page ? `${page.width}×${page.height}` : "";
  const said = boardLines(lines);
  const total = said.lines.length + said.linesOver;
  return {
    kind: "board",
    boardId: id,
    title: title.trim() || "Untitled board",
    caption: [
      onPage ? pageCaption(onPage) : "",
      `${images} ${images === 1 ? "photograph" : "photographs"}`,
      total ? `${total} ${total === 1 ? "line" : "lines"}` : "",
      shape,
    ]
      .filter(Boolean)
      .join(" · "),
    thumbUrl,
    preview,
    images,
    ...said,
    ...(discard && { discard: true as const }),
    ...(discard && discardPage && { discardPage }),
  };
}

export type ToolOutcome = {
  result: Record<string, unknown>;
  attachments?: ChatAttachment[];
};

export type AttachmentTarget =
  | {
      view: "gallery";
      inspectId: string;
      versionId?: string;
    }
  | { view: "design"; boardId: string };

export function attachmentTarget(attachment: ChatAttachment): AttachmentTarget {
  if (attachment.kind === "board") return { view: "design", boardId: attachment.boardId };
  if (attachment.frameId) {
    return {
      view: "gallery",
      inspectId: attachment.frameId,
      versionId: attachment.referenceId,
    };
  }
  return { view: "gallery", inspectId: attachment.referenceId };
}

export function mergedAttachments(
  current: readonly ChatAttachment[],
  added: readonly ChatAttachment[],
) {
  const merged = [...current];
  const at = new Map(merged.map((attachment, index) => [attachmentKey(attachment), index]));

  for (const attachment of added) {
    const key = attachmentKey(attachment);
    const seen = at.get(key);
    if (seen === undefined) {
      at.set(key, merged.length);
      merged.push(attachment);
    } else if (attachment.kind === "board") {
      merged[seen] = attachment;
    }
  }

  return merged;
}
