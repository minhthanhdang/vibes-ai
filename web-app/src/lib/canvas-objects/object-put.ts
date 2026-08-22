import { placeLinesOnBoard, lineKey, textOf } from "@/lib/boards/board-line";
import { placeOnBoard } from "@/lib/boards/board-place";
import { boardFrames, type Rect } from "@/lib/canvas/moodboard-frames";
import { TEXT_LINE_HEIGHT } from "@/lib/layout/moodboard-compose";
import { LAYOUT_TEXT_MAX_FONT, LAYOUT_TEXT_MIN_FONT } from "@/lib/layout/moodboard-layouts";
import {
  boardPages,
  frameJoining,
  pageById,
  pageChildOrder,
  pageElements,
  type BoardPage,
} from "@/lib/pages/board-pages";
import { addPage } from "@/lib/pages/page-add";
import { placeLinesOnPage, placeOnPage } from "@/lib/pages/page-place";
import { referenceFileId, referenceIdFromFileId, type SceneElement } from "@/lib/scene/moodboard-scene";

/// New objects onto the canvas (canvas.md §XI, the canvas toolset): an image by
/// its reference, a line of text, or a page — each at an explicit box or left
/// to the house placement rules.
///
/// Without a box this is delegation, deliberately: the same `placeOnPage` /
/// `placeOnBoard`, `placeLinesOnPage` / `placeLinesOnBoard` and `addPage` the
/// edit-in-place compose path uses, so a put and a compose edit land a picture
/// by one set of rules. With a box the element skeleton is written the way
/// `composedScene` writes one — `status: "saved"`, `text` + `originalText`, a
/// `ref:` fileId — and `frameJoining` decides what it lands in: a section takes
/// what it contains, a page takes what is on it by §V.3's centre rule.
///
/// Boxes speak the read's dialect: `[ymin, xmin, ymax, xmax]` in thousandths of
/// the target page when `pageId` names one, scene pixels otherwise. An image
/// put in a box is contained at its own aspect and centred — excalidraw draws
/// an image by stretching the bytes to the box, and a photo squashed to a shape
/// it was not shot at is not what "put it there" means; one with no recorded
/// size takes the whole box, the same call the drop makes. A text box sets the
/// type: the font size follows the box height and the drawn height follows the
/// font, so reading the object back says nearly the box that was asked — except
/// where the type's own floor or ceiling moved it, which comes back as
/// `clamped` for the caller to say rather than being applied quietly.
///
/// A reference or a line the target already carries is not doubled — the same
/// refusal the swap and the place make, answered as `alreadyOn`. Nothing is
/// dropped silently: every request lands in exactly one of `put`, `alreadyOn`
/// or `refused`.
///
/// No canvas, no React, no DOM: what goes in is elements and requests, what
/// comes out is elements or null.

export type PutRequest =
  | { kind: "image"; referenceId: string; pageId?: string; box?: readonly number[] }
  | { kind: "text"; text: string; pageId?: string; box?: readonly number[] }
  | { kind: "page"; name?: string; box?: readonly number[] };

export type PutPlacement = {
  /// The new element's id — the handle every later canvas edit takes.
  objectId: string;
  kind: "image" | "text" | "page";
  /// The page the object landed on, when it landed on one.
  pageId?: string;
};

export type PutRefusal = { object: string; reason: string };

/// A line set at a size its box did not ask for, because the type has a floor
/// and a ceiling and the box does not know about either.
export type PutClamp = {
  objectId: string;
  /// The size the box height asks for, and the size the line was set at, both
  /// in scene pixels. `set` under `asked` is the ceiling, over it the floor.
  asked: number;
  set: number;
};

export type PutResult = {
  /// The rewritten scene, or null when nothing joined — the caller's cue to
  /// skip the write entirely rather than spend a revision on nothing.
  elements: SceneElement[] | null;
  put: PutPlacement[];
  /// The reference or line the target already carries — not doubled, for the
  /// place's own reason: two of one thing is a board the user cannot point at.
  alreadyOn: string[];
  refused: PutRefusal[];
  /// The lines whose type the clamp moved, so the caller can say so. Reported
  /// rather than applied quietly for the reason the clamp's own comment gives:
  /// the object reads back a box shorter than the one that was sent, and
  /// nothing else in the answer distinguishes that from having asked for it.
  clamped: PutClamp[];
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function normalWords(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/// A `[ymin, xmin, ymax, xmax]` box as given, null when unreadable — the wrong
/// length, a non-number, an empty extent — undefined when absent.
function readBox(box: readonly number[] | undefined): [number, number, number, number] | null | undefined {
  if (box === undefined) return undefined;
  if (!Array.isArray(box) || box.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = box.map(finite);
  if (ymin === null || xmin === null || ymax === null || xmax === null) return null;
  if (!(ymax > ymin && xmax > xmin)) return null;
  return [ymin, xmin, ymax, xmax];
}

/// The asked box in scene pixels — thousandths of the page when one is named,
/// the read's own dialect back.
function boxRect(box: [number, number, number, number], page: BoardPage | null): Rect {
  const [ymin, xmin, ymax, xmax] = box;
  if (!page) return { x: xmin, y: ymin, width: xmax - xmin, height: ymax - ymin };
  return {
    x: page.x + (xmin / 1000) * page.width,
    y: page.y + (ymin / 1000) * page.height,
    width: ((xmax - xmin) / 1000) * page.width,
    height: ((ymax - ymin) / 1000) * page.height,
  };
}

/// The image's box inside the asked one, at the photo's own aspect and centred
/// — `fitInSlot`'s rule, spoken here because a put box is not a layout slot. A
/// reference with no recorded size takes the whole box.
function containedIn(
  rect: Rect,
  size: { width?: number | null; height?: number | null } | null | undefined,
): Rect {
  const width = finite(size?.width);
  const height = finite(size?.height);
  if (!width || !height || width <= 0 || height <= 0) return rect;

  const scale = Math.min(rect.width / width, rect.height / height);
  const drawn = { width: round(width * scale), height: round(height * scale) };
  return {
    x: round(rect.x + (rect.width - drawn.width) / 2),
    y: round(rect.y + (rect.height - drawn.height) / 2),
    ...drawn,
  };
}

function live(elements: readonly SceneElement[]): SceneElement[] {
  return elements.filter((element) => element.isDeleted !== true);
}

/// What a duplicate is measured against: the named page's own elements, or the
/// whole board when the put is loose — the same two scopes `placeOnPage` and
/// `placeOnBoard` read `alreadyOn` from.
function scopeOf(
  elements: readonly SceneElement[],
  pages: readonly BoardPage[],
  page: BoardPage | null,
): SceneElement[] {
  if (!page) return live(elements);
  const held = new Set(pageElements(elements, pages, page).map((element) => element.id));
  return live(elements).filter((element) => held.has(element.id));
}

export function putObjects(
  elements: readonly SceneElement[],
  requests: readonly PutRequest[],
  {
    defaultSize,
    sizeOf,
    makeId = () => crypto.randomUUID(),
  }: {
    /// The board's default page size — the room a board with no page is
    /// measured against, what `Moodboard.widthPx`/`heightPx` mean now.
    defaultSize: { width: number; height: number };
    sizeOf: (referenceId: string) => { width?: number | null; height?: number | null } | null | undefined;
    makeId?: () => string;
  },
): PutResult {
  const put: PutPlacement[] = [];
  const alreadyOn: string[] = [];
  const refused: PutRefusal[] = [];
  const clamped: PutClamp[] = [];

  let current: SceneElement[] = [...elements];
  let changed = false;

  for (const request of requests) {
    const kind = request?.kind;
    const label =
      kind === "image"
        ? String((request as { referenceId?: unknown }).referenceId ?? "an image")
        : kind === "text"
          ? normalWords(String((request as { text?: unknown }).text ?? "")) || "a line"
          : kind === "page"
            ? String((request as { name?: unknown }).name ?? "").trim() || "a page"
            : String(kind);
    const refuse = (reason: string) => refused.push({ object: label, reason });

    if (kind !== "image" && kind !== "text" && kind !== "page") {
      refuse("kind must be image, text or page");
      continue;
    }

    const box = readBox(request.box as readonly number[] | undefined);
    if (box === null) {
      refuse("the box is unreadable — [ymin, xmin, ymax, xmax], and it must have room in it");
      continue;
    }

    /// Pages are re-read per request, against the array the one before left —
    /// a page put and a picture put onto it compose in one call.
    const pages = boardPages(current);
    const pageIds = new Set(pages.map((page) => page.id));

    if (kind === "page") {
      if ((request as { pageId?: unknown }).pageId !== undefined) {
        refuse("a page cannot be put on a page");
        continue;
      }
      const name = typeof request.name === "string" ? request.name : null;
      const added = addPage({
        elements: current,
        defaultSize,
        name,
        ...(box && { box: boxRect(box, null) }),
        makeId,
      });
      current = added.elements;
      changed = true;
      put.push({ objectId: added.page.id, kind: "page" });
      continue;
    }

    const pageId = request.pageId;
    const page = typeof pageId === "string" && pageId ? pageById(pages, pageId) : null;
    if (pageId !== undefined && !page) {
      refuse(`no page ${String(pageId)} on this board`);
      continue;
    }

    if (kind === "image") {
      const referenceId = typeof request.referenceId === "string" ? request.referenceId.trim() : "";
      if (!referenceId) {
        refuse("an image put names its referenceId");
        continue;
      }

      if (box === undefined) {
        const made: string[] = [];
        const capture = () => {
          const id = makeId();
          made.push(id);
          return id;
        };
        const edit = page
          ? placeOnPage({ elements: current, pages, page, add: [referenceId], sizeOf, makeId: capture })
          : placeOnBoard({
              elements: current,
              page: { x: 0, y: 0, ...defaultSize },
              add: [referenceId],
              sizeOf,
              makeId: capture,
            });
        if (edit.alreadyOn.length) {
          alreadyOn.push(referenceId);
          continue;
        }
        current = edit.elements;
        changed = true;
        put.push({ objectId: made[0]!, kind: "image", ...(page && { pageId: page.id }) });
        continue;
      }

      const carried = scopeOf(current, pages, page).some(
        (element) => referenceIdFromFileId(element.fileId) === referenceId,
      );
      if (carried) {
        alreadyOn.push(referenceId);
        continue;
      }

      const drawn = containedIn(boxRect(box, page), sizeOf(referenceId));
      const joined = frameJoining(boardFrames(current), pages, drawn);
      const element: SceneElement = {
        id: makeId(),
        type: "image",
        fileId: referenceFileId(referenceId),
        /// Never `pending`: the file entry is a reference pointer the board
        /// load rebuilds every time, so the element is complete as it lands.
        status: "saved",
        x: round(drawn.x),
        y: round(drawn.y),
        width: round(drawn.width),
        height: round(drawn.height),
        ...(joined && { frameId: joined }),
      };
      current = [...current, element];
      if (joined && pageIds.has(joined)) current = pageChildOrder(current);
      changed = true;
      put.push({
        objectId: element.id,
        kind: "image",
        ...(joined && pageIds.has(joined) && { pageId: joined }),
      });
      continue;
    }

    const text = normalWords(typeof request.text === "string" ? request.text : "");
    if (!text) {
      refuse("a text put carries the words to set");
      continue;
    }

    if (box === undefined) {
      const made: string[] = [];
      const capture = () => {
        const id = makeId();
        made.push(id);
        return id;
      };
      const edit = page
        ? placeLinesOnPage({ elements: current, pages, page, add: [text], makeId: capture })
        : placeLinesOnBoard({
            elements: current,
            page: { x: 0, y: 0, ...defaultSize },
            add: [text],
            makeId: capture,
          });
      if (edit.alreadyOn.length) {
        alreadyOn.push(text);
        continue;
      }
      current = edit.elements;
      changed = true;
      put.push({ objectId: made[0]!, kind: "text", ...(page && { pageId: page.id }) });
      continue;
    }

    const said = scopeOf(current, pages, page).some(
      (element) => element.type === "text" && lineKey(textOf(element)) === lineKey(text),
    );
    if (said) {
      alreadyOn.push(text);
      continue;
    }

    const rect = boxRect(box, page);
    /// The box is the line's own box, the one the read reports: the type
    /// follows the box height and the drawn height follows the type, so the
    /// object reads back saying nearly the box that was asked — up to the
    /// clamp, which is where that stops being true. A box asking for type over
    /// `LAYOUT_TEXT_MAX_FONT` gets 96px in a 120-tall element, so the caller
    /// reads back a box a third shorter than the one it sent. Caught binding on
    /// a real design: `AMARA & INES` asked at `[385, 80, 452, 920]` on a
    /// 1080x1920 page is 128.6 units — 103px — and came back at 96. Ten of the
    /// thirty-two pages with type on this database sit on that ceiling.
    ///
    /// The number is left where it is and the *silence* is what goes: lifting
    /// `LAYOUT_TEXT_MAX_FONT` would change what agent 4 composes, and this door
    /// is agent 6's as much as agent 8's, so the clamp is reported back and
    /// each caller decides whether it has anything to say about it. What agent
    /// 8 says is that `transform_on_canvas` scales a line's `fontSize` with its
    /// box and has no clamp of its own — the ceiling is this door's, not the
    /// scene's. The measurements are in `render/plan-read.ts`, beside the read
    /// that reports when a page is sitting on it.
    const asked = Math.round(rect.height / TEXT_LINE_HEIGHT);
    const fontSize = Math.min(LAYOUT_TEXT_MAX_FONT, Math.max(LAYOUT_TEXT_MIN_FONT, asked));
    const joined = frameJoining(boardFrames(current), pages, rect);
    const element: SceneElement = {
      id: makeId(),
      type: "text",
      x: round(rect.x),
      y: round(rect.y),
      width: round(rect.width),
      height: Math.round(fontSize * TEXT_LINE_HEIGHT),
      text,
      /// Excalidraw keeps both: `text` is what is drawn after wrapping,
      /// `originalText` what was typed. Written the same so editing the block
      /// does not resurrect a different string.
      originalText: text,
      fontSize,
      textAlign: "center",
      verticalAlign: "middle",
      autoResize: false,
      ...(joined && { frameId: joined }),
    };
    current = [...current, element];
    if (joined && pageIds.has(joined)) current = pageChildOrder(current);
    if (fontSize !== asked) clamped.push({ objectId: element.id, asked, set: fontSize });
    changed = true;
    put.push({
      objectId: element.id,
      kind: "text",
      ...(joined && pageIds.has(joined) && { pageId: joined }),
    });
  }

  return { elements: changed ? current : null, put, alreadyOn, refused, clamped };
}
