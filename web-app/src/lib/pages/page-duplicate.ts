import { boardItems } from "@/lib/boards/board-contents";
import {
  boardPages,
  boardSections,
  boxOnPage,
  isFrameElement,
  nextPageName,
  pageById,
  pageElements,
  pageFrame,
  pageItems,
  type BoardPage,
} from "@/lib/pages/board-pages";
import { newPageBox } from "@/lib/pages/page-compose";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// A page copied onto a page of its own, beside the one it came from (tech-spec
/// §V).
///
/// `duplicate_board` exists for one sentence — "keep that one and try it with the
/// tall shot" — and its own argument is that a variation has to be made *on a
/// copy*, because every other board tool changes the board the director is
/// looking at. A board is pages now, and that argument lands one level down
/// without a call to answer it: on a spread, the thing they want to try again is
/// a page, and the two routes a model can reach are both wrong in a way nothing
/// downstream detects —
///
/// - `duplicate_board` copies every page of the board into a second tab, so the
///   director gets a whole second spread to hold "the same page twice"; the pages
///   they were not talking about are then carried in two places and the next edit
///   has to be told which copy it is about;
/// - `compose_moodboard` with `newPage` asks agent 4 to decide the arrangement
///   again from a list of ids, so the "copy" comes back laid out differently and
///   short of whatever was not restated. Copying is not a judgement.
///
/// So this is deterministic and nothing is asked: the page's own elements are
/// written across by value at the same offsets inside a rectangle the same size,
/// and the variation is made on the copy with the free scene edits that already
/// exist. §V.2 decides where the new rectangle goes, the same as every other page
/// this app draws.
///
/// What is copied is what the page *is* (§V.3, `pageElements`): geometry decides,
/// never `frameId`, and the two things a page never owned — a section the page was
/// drawn over and the photographs that section keeps — stay where they are, on the
/// page they are on. A copy that took them would be duplicating the director's own
/// grouping out from under them.
///
/// Ids are fresh, and that is the difference between this and `duplicate_board`:
/// a board's copy is a second row and may hold the same element ids, while these
/// land in the *same array* as the originals — a repeated id is a scene excalidraw
/// draws once, and a repeated group would drag the original page's pictures along
/// with the copy's.
///
/// No canvas, no React, no DOM.

export type PageDuplication = {
  /// The board's scene afterwards, in the array's own order: everything it had,
  /// then the copies, then the page frame that owns them.
  elements: SceneElement[];
  /// The page that was made.
  page: BoardPage;
  /// The page it was made from, untouched.
  source: BoardPage;
  /// The references now on the copy, deduped, in the page's reading order — what
  /// the director is told they have a second copy of.
  pictures: string[];
  lines: string[];
  /// Elements carried across, pictures and lines and anything else the page held.
  copied: number;
  /// How many sections the source page was drawn over, and how many photographs
  /// they keep. Zero on every page agent 4 composed; the reason a hand-made
  /// board's page can be copied and come back holding less than it shows.
  sections: number;
  keptInSections: number;
};

/// The fields excalidraw regenerates rather than reads (`restore` fills seeds,
/// versions and fractional indices). Carried over from the original they would be
/// a second element claiming one place in the array's order and one random seed —
/// the copy is a new element, not the same one written twice.
const REGENERATED = ["index", "seed", "version", "versionNonce", "updated"] as const;

/// One element of the page, as it lands on the copy.
///
/// Every id it carries is remapped through the copy's own map, and anything
/// pointing at something that was *not* copied is dropped rather than left
/// pointing across the gap: a caption bound to a container the section kept would
/// otherwise tie the new page to the old one, and excalidraw resolves those
/// pointers by id.
function copyOf(
  element: SceneElement,
  {
    ids,
    groups,
    frameId,
    dx,
    dy,
  }: {
    ids: ReadonlyMap<string, string>;
    groups: ReadonlyMap<string, string>;
    frameId: string;
    dx: number;
    dy: number;
  },
): SceneElement {
  const copy: Record<string, unknown> = { ...element };
  for (const field of REGENERATED) delete copy[field];

  copy.id = ids.get(element.id)!;
  copy.x = (element.x as number) + dx;
  copy.y = (element.y as number) + dy;
  copy.frameId = frameId;

  if (Array.isArray(element.groupIds)) {
    copy.groupIds = element.groupIds.map((id) =>
      typeof id === "string" ? (groups.get(id) ?? id) : id,
    );
  }
  if (typeof element.containerId === "string") {
    copy.containerId = ids.get(element.containerId) ?? null;
  }
  if (Array.isArray(element.boundElements)) {
    copy.boundElements = element.boundElements
      .map((bound) => {
        const entry = bound as { id?: unknown } | null;
        const id = entry && typeof entry.id === "string" ? ids.get(entry.id) : undefined;
        return id ? { ...entry, id } : null;
      })
      .filter(Boolean);
  }
  for (const end of ["startBinding", "endBinding"] as const) {
    const binding = element[end] as { elementId?: unknown } | null | undefined;
    if (!binding || typeof binding.elementId !== "string") continue;
    const id = ids.get(binding.elementId);
    copy[end] = id ? { ...binding, elementId: id } : null;
  }

  return copy as SceneElement;
}

/// The page, copied. `null` for an id the board does not carry — the caller
/// refuses it in its own answer, which is a round cheaper than a thrown error.
export function pageDuplication({
  elements,
  pageId,
  name,
  makeId = () => crypto.randomUUID(),
}: {
  elements: readonly SceneElement[];
  pageId: unknown;
  /// What the director called the copy. `Page N` when they did not, counted past
  /// the highest the board carries — deliberately not "Act two (copy)": a page's
  /// name is what they say it by out loud, and two pages whose names differ by a
  /// bracket are two pages they cannot tell apart in a sentence.
  name?: string | null;
  makeId?: () => string;
}): PageDuplication | null {
  const pages = boardPages(elements);
  const source = pageById(pages, pageId);
  if (!source) return null;

  const sections = boardSections(elements, pages);
  const going = pageElements(elements, pages, source, sections);

  /// Beside the pages *and* the loose pictures, at the source page's own size —
  /// `newPageBox` rather than §V.2's `nextPageBox` for the reason a compose uses
  /// it: a copy landing over what is already there is a copy the director's next
  /// drag adopts. The size is the source's rectangle rather than its preset, so a
  /// page they dragged to their own shape is copied at that shape.
  const box = newPageBox({
    pages,
    sourcePageId: source.id,
    size: { width: source.width, height: source.height },
    occupied: boardItems(elements),
  });
  const frame = pageFrame(box, { name: name?.trim() || nextPageName(pages), makeId });

  const ids = new Map(going.map((element) => [element.id, makeId()]));
  const groups = new Map(
    [...new Set(going.flatMap((element) => (Array.isArray(element.groupIds) ? element.groupIds : [])))]
      .filter((id): id is string => typeof id === "string")
      .map((id) => [id, makeId()]),
  );
  const dx = box.x - source.x;
  const dy = box.y - source.y;
  const copies = going.map((element) => copyOf(element, { ids, groups, frameId: frame.id, dx, dy }));

  /// Read off the copies rather than off the source page, so what the director is
  /// told is on the new page is read from the elements that are actually on it.
  const on = pageItems(boardItems(copies), box);
  const pictures: string[] = [];
  for (const item of on) {
    if (item.kind !== "image" || !item.referenceId) continue;
    if (!pictures.includes(item.referenceId)) pictures.push(item.referenceId);
  }

  const onSections = sections.filter((section) => boxOnPage(source, section));
  const sectionIds = new Set(onSections.map((section) => section.id));

  return {
    /// The copies immediately before their frame, which is excalidraw's own
    /// invariant for a frame's children — so the director dragging the new page
    /// takes what is on it.
    elements: [...elements, ...copies, frame],
    page: boardPages([frame])[0]!,
    source,
    pictures,
    lines: on
      .filter((item) => item.kind === "text")
      .map((item) => (item.text ?? "").trim())
      .filter(Boolean),
    copied: copies.length,
    sections: onSections.length,
    keptInSections: elements.filter(
      (element) =>
        element.isDeleted !== true &&
        !isFrameElement(element) &&
        typeof element.frameId === "string" &&
        sectionIds.has(element.frameId),
    ).length,
  };
}
