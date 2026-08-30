import { referenceDigest, type ToolReference, UNREAD_MARK } from "@/lib/agent/shared/reference";
import { CUSTOM_PAGE_PRESET, type PageSizeLabel } from "@/lib/pages/board-pages";
import { type PageBlock, type PageBox } from "@/lib/pages/page-blocks";

export const PAGES_PER_MESSAGE = 2;

export type PageBriefPage = {
  boardId: string;
  pageId: string;
  boardTitle: string;
  name: string;
  position: number;
  of: number;
  width: number;
  height: number;
  preset: PageSizeLabel;
  layout?: string | null;
};

export type PageBriefDoor = "attached" | "asked";

export type PageBrief = {
  page: PageBriefPage;
  blocks: readonly PageBlock[];
  omitted: number;
  rendered: boolean;
  door?: PageBriefDoor;
  renderFailure?: string;
  undrawnNote?: string;
  standingNote?: string;
  legibilityNote?: string;
};

export function pageBriefText(brief: PageBrief, references: readonly ToolReference[]): string {
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  const { blocks, omitted } = brief;

  const stacked = stackedBlocks(blocks);
  const lines = blocks.map((block, at) => blockLine(block, byId, stacked.has(at) ? block.z : null));

  return [
    headLine(brief, lines.length, stacked.size > 0),
    ...lines,
    omittedLine(omitted),
  ]
    .filter(Boolean)
    .join("\n");
}

function stackedBlocks(blocks: readonly PageBlock[]): ReadonlySet<number> {
  const stacked = new Set<number>();

  blocks.forEach((block, at) => {
    for (let other = at + 1; other < blocks.length; other += 1) {
      if (!liesOn(block.box, blocks[other]!.box)) continue;
      stacked.add(at);
      stacked.add(other);
    }
  });

  return stacked;
}

const SEAM = 1;

function liesOn(one: PageBox, other: PageBox): boolean {
  const [top, left, bottom, right] = one;
  const [otherTop, otherLeft, otherBottom, otherRight] = other;

  return (
    Math.min(right, otherRight) - Math.max(left, otherLeft) > SEAM &&
    Math.min(bottom, otherBottom) - Math.max(top, otherTop) > SEAM
  );
}

function headLine(brief: PageBrief, described: number, stacked: boolean) {
  const { page, door = "attached" } = brief;
  return [
    openingLine(page, door),
    idsLine(page),
    customSizeLine(page),
    pictureLine(brief, door),
    brief.standingNote ?? "",
    brief.legibilityNote ?? "",
    stacked ? STACKED : "",
    countLine(described),
  ]
    .filter(Boolean)
    .join(" ");
}

function pictureLine({ rendered, renderFailure, undrawnNote }: PageBrief, door: PageBriefDoor) {
  if (rendered) {
    return [door === "asked" ? DRAWN : RENDERED, undrawnNote].filter(Boolean).join(" ");
  }
  if (door === "attached") return NOT_RENDERED;
  return renderFailure ? `There is no picture of it — ${renderFailure}.` : NOT_DRAWN;
}

const STACKED =
  "Some blocks on it overlap: those lines carry z, the stacking order with 0 at the back, so of two overlapping blocks the higher z is the one on top.";

const RENDERED = "The image above is that page.";

export const drawnLine = (of: "page" | "board") =>
  `The picture that came back with this answer is that ${of} as it stands now.`;

const DRAWN = drawnLine("page");

const NOT_DRAWN =
  "There is no picture of it — the renderer failed, so the boxes below are the whole of what you have of this page. Answer from them and say you could not see it.";

const NOT_RENDERED =
  "There is no picture of it — the page changed while it was being sent, so the boxes below are the whole of what you have been given of it.";

function openingLine(
  { boardTitle, name, position, of, width, height, layout }: PageBriefPage,
  door: PageBriefDoor,
) {
  const board = boardTitle.trim() || "Untitled board";
  const which = `page ${position} of ${of} of the board “${board}”`;
  const lead = door === "asked" ? "This is" : "The user attached";
  return [
    name ? `${lead} “${name}” — ${which}` : `${lead} ${which}`,
    `${width}×${height}`,
    ...(layout ? [`composed at ${layout}`] : []),
  ].join(", ") + ".";
}

function idsLine({ boardId, pageId }: PageBriefPage) {
  return `The tools reach it as boardId ${boardId}, pageId ${pageId}.`;
}

function customSizeLine({ preset }: PageBriefPage) {
  if (preset !== CUSTOM_PAGE_PRESET) return "";
  return "That size is the user's own rather than a page preset, so laying it out again fits the template into their rectangle instead of resizing the page.";
}

function countLine(blocks: number) {
  if (blocks === 0) return "There is nothing on it.";
  return blocks === 1 ? "1 block on it:" : `${blocks} blocks on it, in reading order:`;
}

function omittedLine(omitted: number) {
  if (omitted <= 0) return "";
  return omitted === 1
    ? "1 more block is on this page and is not described — the smallest thing on it."
    : `${omitted} more blocks are on this page and are not described — the smallest things on it.`;
}

function boxSaid(box: PageBox) {
  return `[${box.join(",")}]`;
}

const CLIPPED_MARK = "clipped at the page edge";

function stackSaid(z: number | null) {
  return z === null ? "" : `z ${z}`;
}

function blockLine(block: PageBlock, byId: ReadonlyMap<string, ToolReference>, z: number | null) {
  const box = boxSaid(block.box);
  const stack = stackSaid(z);
  const over = block.clipped ? CLIPPED_MARK : "";
  const faded = block.opacity !== undefined ? `${block.opacity}% opaque` : "";

  if (block.kind === "text") {
    return ["text", `“${block.text}”`, faded, box, stack, over]
      .filter(Boolean)
      .join(" · ");
  }

  if (block.kind === "shape") {
    return [
      block.shape,
      block.shape === "line"
        ? block.stroke
        : block.fill === "transparent"
          ? `outline in ${block.stroke}, nothing behind it`
          : block.fill,
      faded,
      box,
      stack,
      over,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  const reference = block.referenceId ? byId.get(block.referenceId) : undefined;
  if (!reference) {
    return [block.referenceId, "not one of this project's pictures", faded, box, stack, over]
      .filter(Boolean)
      .join(" · ");
  }

  const { id, title, shape, croppedFrom, keeps, tags, unread } = referenceDigest(reference);
  return [
    id,
    title,
    shape,
    croppedFrom ? [`cut of ${croppedFrom}`, keeps && `keeps “${keeps}”`].filter(Boolean).join(", ") : keeps,
    faded,
    box,
    stack,
    over,
    tags?.join(", "),
    unread && UNREAD_MARK[unread],
  ]
    .filter(Boolean)
    .join(" · ");
}
