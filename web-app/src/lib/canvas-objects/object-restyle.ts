import { readableTarget } from "@/lib/canvas-objects/object-read";
import {
  PAGE_GROUND_INSTEAD,
  styleReading,
  type StyleAsked,
  type StyleTarget,
} from "@/lib/canvas-objects/object-style";
import { boardPages, isFrameElement } from "@/lib/pages/board-pages";
import { setBlock } from "@/lib/render/text-set";
import { isPageBackground } from "@/lib/pages/page-background";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// How an object *looks*, changed after it is on the board (canvas.md §XI.2,
/// the style dialect). The sixth canvas tool and a sibling of the other five
/// rather than a widening of one.
///
/// Split from `transform_on_canvas` on the argument §XI.2 makes: transform
/// answers where and how big, and nine appearance fields hung on it would be
/// tokens every "move it left" pays for. Nothing about a fill is a transform.
///
/// The vocabulary is not here — it is `object-style`, the module
/// `put_on_canvas` reads on the way in, so a `font` name, a hex and a range
/// mean one thing at both doors. What is here is everything that is about the
/// board rather than about the words: which objects have a handle, which of
/// them may be written, and what counts as a change.
///
/// The rules, and each is a way to get this wrong:
/// - **A page takes none of them.** A frame's own `backgroundColor` is drawn by
///   neither excalidraw nor `rasterise` (§XI.4), so writing it would give the
///   model a coloured page and the user a white one. Refused with the reason.
/// - **What the read cannot surface, this cannot write.** An arrow, a diamond,
///   a scribble and an embed have no handle, so a change naming one is
///   `notOnBoard` exactly as it is at every other canvas door — the read is the
///   single answer to what is addressable (`readableTarget`).
/// - **A bound label is refused toward its container**, the same dead end
///   `transform_on_canvas` names: a handle no read will ever hand back is a
///   loop the model cannot get out of.
/// - **Locked is refused.** Never half-honoured, on the removal's own rule.
/// - **Appearance is not rigid the way geometry is.** A grouped element is
///   restyled alone: a transform moves a whole group because a photo torn out
///   of its stack is broken, and recolouring one chip of a palette is exactly
///   what recolouring one chip means.
/// - **A field the object already wears writes nothing**, per field rather than
///   per change, so echoing a read back and changing one colour spends one
///   column and not ten.
///
/// The refusal grain is the difference from the put. A put refuses whole,
/// because an object that lands wearing none of the appearance it was asked for
/// is one the model goes on to reason about as though it got it — but there is
/// no landing here, and an object that already exists keeps every field this
/// call could not set. So a change carrying one bad field sets the rest and
/// names the bad one back on the object it was asked of.
///
/// Nothing is dropped silently: every change lands in exactly one of
/// `restyled`, `unchanged`, `notFound` or `refused`, and a change that set some
/// of what it asked carries the rest as `refused` inside its own entry.
///
/// No canvas, no React, no DOM: what goes in is elements and changes, what
/// comes out is elements or null.

export type RestyleChange = { objectId: string } & StyleAsked;

export type RestyledObject = {
  objectId: string;
  /// The fields now true of it, by the names the model used — never the scene's
  /// column names, which are not the words it said.
  set: (keyof StyleAsked)[];
  /// The fields on this same change that could not be set, each with why. The
  /// per-field remainder the put has no room for.
  refused?: string[];
};

export type RestyleRefusal = { objectId: string; reason: string };

export type RestyleResult = {
  /// The rewritten scene, or null when nothing changed — the caller's cue to
  /// skip the write entirely rather than spend a revision on nothing.
  elements: SceneElement[] | null;
  restyled: RestyledObject[];
  /// Asked for what is already true, or naming no style field at all.
  unchanged: string[];
  notFound: string[];
  refused: RestyleRefusal[];
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/// What was typed, which is what a re-wrap starts from: `originalText` when the
/// element carries one, and otherwise the drawn string with the breaks taken
/// out — an element written before this door wrapped anything, or one a person
/// typed into the editor, has to re-wrap from its words rather than from where
/// somebody else's width happened to break them.
function typedWords(element: SceneElement): string {
  const typed = typeof element.originalText === "string" ? element.originalText : "";
  const drawn = typeof element.text === "string" ? element.text : "";
  return (typed || drawn).replace(/\s+/g, " ").trim();
}

/// A colour as the same string whichever case the scene stored it in —
/// excalidraw's picker writes `#1E1E1E` and the vocabulary reads `#1e1e1e`, and
/// a repaint to the colour a shape already wears must write nothing.
function sameColumn(column: string, current: unknown, asked: unknown): boolean {
  if (column === "roundness") {
    /// Two roundness models and one question: rounded corners or square ones.
    /// A radius written by the toolbar and one written here are the same fact
    /// about the shape.
    return Boolean(current) === Boolean(asked);
  }
  if (typeof asked === "string" && typeof current === "string") {
    return current.trim().toLowerCase() === asked.trim().toLowerCase();
  }
  return current === asked;
}

export function restyleObjects(
  elements: readonly SceneElement[],
  changes: readonly RestyleChange[],
): RestyleResult {
  const pageIds = new Set(boardPages(elements).map((page) => page.id));

  const live = new Map<string, SceneElement>();
  for (const element of elements) {
    if (element.isDeleted !== true && element.id) live.set(element.id, element);
  }

  const restyled: RestyledObject[] = [];
  const unchanged: string[] = [];
  const notFound: string[] = [];
  const refused: RestyleRefusal[] = [];
  const writes = new Map<string, Record<string, unknown>>();

  for (const change of changes) {
    const { objectId } = change;
    const refuse = (reason: string) => refused.push({ objectId, reason });

    if (writes.has(objectId) || restyled.some((done) => done.objectId === objectId)) {
      refuse("already restyled by an earlier change in this call");
      continue;
    }

    const element = live.get(objectId);
    if (!element) {
      notFound.push(objectId);
      continue;
    }

    /// A page's ground is the page's own, not a frame's fill, and it is not
    /// this tool's to set (§XI.4). Now that the tool that does set it is built
    /// and both agents hold it, the refusal names the call instead of
    /// describing it.
    if (pageIds.has(objectId)) {
      refuse(`a page takes no style fields — ${PAGE_GROUND_INSTEAD}`);
      continue;
    }
    /// A section is refused on its own and deliberately *without* that name:
    /// `set_page_background` takes pages only, so a section sent there is a
    /// second refusal a round later. A section is arrangement — it has no
    /// ground and no appearance to change.
    if (isFrameElement(element)) {
      refuse(
        "a section takes no style fields — it is an arrangement of what is inside it, and a frame's own fill is drawn by neither the editor nor the export",
      );
      continue;
    }
    /// The ground the page is painted is `set_page_background`'s colour and not
    /// a fill on a rectangle, even though a rectangle is what it is (§XI.4) —
    /// two ways to recolour one thing is two accounts of what a page stands on.
    if (isPageBackground(element)) {
      refuse(
        "a page’s background is recoloured with set_page_background, not restyled — it is the page’s ground rather than a shape on it",
      );
      continue;
    }
    if (typeof element.containerId === "string" && element.containerId) {
      refuse(`a bound label is styled with its container — restyle ${element.containerId} instead`);
      continue;
    }

    const target = readableTarget(element);
    if (!target) {
      notFound.push(objectId);
      continue;
    }
    if (element.locked === true) {
      refuse("locked");
      continue;
    }

    const style = styleReading(target.kind as StyleTarget, change, target.shape ?? undefined);

    /// Per field rather than per change: the object keeps what it already
    /// wears, so a colour said back is a column with nothing to write and the
    /// rest of the call still lands.
    const patch: Record<string, unknown> = {};
    const set: (keyof StyleAsked)[] = [];
    for (const { field, writes: columns } of style.applied) {
      const moved = Object.entries(columns).filter(
        ([column, value]) => !sameColumn(column, element[column], value),
      );
      if (!moved.length) continue;
      for (const [column, value] of moved) patch[column] = value;
      set.push(field);
    }

    /// The type size, the line breaks and the drawn height stay in step, the
    /// rule both text doors keep (`object-put`, the text put): the read reports
    /// a box off `height`, so a line resized to twice the type in a box of the
    /// old height reads back as a line that did not change — and a paragraph
    /// broken for 13px type is broken in the wrong places at 26.
    ///
    /// The words re-wrap from `originalText`, which is what was typed rather
    /// than where the last size broke it, and the block is re-measured against
    /// the element's own width — the one field a restyle never moves. Caught on
    /// a live design that put two paragraphs inside cards and then restyled
    /// their colour and size: both came back four and five lines deep in the
    /// picture and one line tall to the read.
    const size = target.kind === "text" ? finite(patch.fontSize) : null;
    if (size !== null) {
      const width = finite(element.width) ?? 0;
      const block = setBlock(typedWords(element), width, size);
      patch.height = block.height;
      if (block.text) patch.text = block.text;
    }

    if (!set.length) {
      if (style.refusals.length) refuse(style.refusals.join("; "));
      else unchanged.push(objectId);
      continue;
    }

    writes.set(objectId, patch);
    restyled.push({
      objectId,
      set,
      ...(style.refusals.length && { refused: style.refusals }),
    });
  }

  if (writes.size === 0) {
    return { elements: null, restyled, unchanged, notFound, refused };
  }

  return {
    elements: elements.map((element) =>
      writes.has(element.id) ? { ...element, ...writes.get(element.id)! } : element,
    ),
    restyled,
    unchanged,
    notFound,
    refused,
  };
}
