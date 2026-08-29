import {
  MOVED,
  elementPlacements,
  memberGeometry,
  outerGroupId,
  type ArrangeBox,
  type ArrangeMember,
  type ElementPlacement,
} from "@/lib/canvas/moodboard-arrange";
import type { Rect } from "@/lib/canvas/moodboard-frames";
import { readableTarget } from "@/lib/canvas-objects/object-read";
import {
  boardPages,
  elementBox,
  pageById,
  pageChildOrder,
  pageElements,
  pageHolding,
} from "@/lib/pages/board-pages";
import { isPageBackground } from "@/lib/pages/page-background";
import { renderFontOf } from "@/lib/render/render-plan";
import { flooredType } from "@/lib/render/text-set";
import type { SceneElement } from "@/lib/scene/moodboard-scene";

/// Batched move / rotate / resize on canvas objects (canvas.md §XI, the canvas
/// toolset). The write that answers "move this 200 left, turn it a little,
/// make it smaller" — one guarded scene rewrite, not three.
///
/// Objects are addressed by `objectId`, the handle `object-read` surfaces, and
/// every coordinate speaks that read's dialect back: thousandths of the holding
/// page for an object on one, scene pixels for pages and loose objects. `to` is
/// the target top-left as `[ymin, xmin]`, `size` the target extent as
/// `[height, width]`, `angle` absolute degrees.
///
/// The rules are the spec's, none negotiable:
/// - pages never rotate (excalidraw frames have no angle) and are resized by
///   `resize_page`, which knows what falls off — both refused with the reason,
///   never skipped;
/// - a grouped element moves its whole group rigidly, through the tidy's own
///   `elementPlacements`, so `fontSize` and arrow points scale with the boxes;
/// - locked — the element, a page, or any piece of the group — is refused;
/// - an image keeps its aspect unless the call says `stretch` (a stretched
///   photo is a crop request in disguise); text resize is `fontSize` scaling
///   with the box following, down to the floor under a readable line and no
///   further; a lone shape takes the box exactly, because a colour block has no
///   proportions to keep (§XI.1);
/// - a move across a page edge has `frameId` reconciled toward geometry
///   afterwards, the `arrangeOwners` rule: onto a page adopts, off a page
///   releases, a section's fact is never rewritten;
/// - a moved page carries its geometric members (`pageElements`) with it;
/// - a change below the tidy's `MOVED` threshold is a no-op, so echoing a read
///   box back writes nothing.
///
/// Nothing is dropped silently: every change lands in exactly one of
/// `transformed`, `unchanged`, `notFound` or `refused`.
///
/// No canvas, no React, no DOM: what goes in is elements and changes, what
/// comes out is elements or null.

export type TransformChange = {
  objectId: string;
  /// Target top-left, `[ymin, xmin]`, in the object's own box dialect.
  to?: readonly [number, number];
  /// Absolute degrees clockwise, as the read reports them.
  angle?: number;
  /// Target extent, `[height, width]`, in the same dialect.
  size?: readonly [number, number];
  /// Explicitly stretch a lone image to `size` instead of containing it.
  stretch?: true;
};

export type TransformRefusal = { objectId: string; reason: string };

/// A line whose type stopped following its box down, because the box does not
/// know there is a size under which nobody can read it.
export type TransformClamp = {
  objectId: string;
  /// The size the scale asks for and the size the line was set at, both in
  /// scene pixels — `set` over `asked` is always, here, the floor.
  asked: number;
  set: number;
};

export type TransformResult = {
  /// The rewritten scene, or null when nothing changed — the caller's cue to
  /// skip the write entirely rather than spend a revision on nothing.
  elements: SceneElement[] | null;
  transformed: string[];
  /// Asked for what is already true — sub-threshold, or a change naming
  /// nothing to change.
  unchanged: string[];
  notFound: string[];
  refused: TransformRefusal[];
  /// Lines the floor caught, named by their own element id — which for a group
  /// is a piece of it rather than the object the change addressed, because the
  /// caption that stopped shrinking is the thing to look at.
  clamped: TransformClamp[];
};

/// The grain the read rounds angles to; a delta at or under it is the same
/// angle said back.
const ROTATED = 0.1;

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number) {
  /// `+ 0` so a rotation's floating-point residue can never write `-0` — a
  /// value that serialises differently from the zero it is.
  return Math.round(value * 100) / 100 + 0;
}

/// A `[y, x]` pair as given, null when unreadable, undefined when absent —
/// three different answers, because "not asked" and "asked wrongly" are not
/// the same change.
function readPair(
  pair: readonly [number, number] | undefined,
): [number, number] | null | undefined {
  if (pair === undefined) return undefined;
  if (!Array.isArray(pair) || pair.length !== 2) return null;
  const y = finite(pair[0]);
  const x = finite(pair[1]);
  return y === null || x === null ? null : [y, x];
}

function normalRadians(radians: number): number {
  const wrapped = radians % (2 * Math.PI);
  return wrapped < 0 ? wrapped + 2 * Math.PI : wrapped;
}

/// How far the asked angle is from the current one, by the shortest way round,
/// zeroed under the read's own grain so an echoed angle rotates nothing.
function angleDelta(currentRadians: number, targetDegrees: number): number {
  const currentDegrees = (currentRadians * 180) / Math.PI;
  const delta = (((targetDegrees - currentDegrees) % 360) + 540) % 360 - 180;
  return Math.abs(delta) <= ROTATED ? 0 : delta;
}

function unionOf(members: readonly ArrangeMember[]): Rect {
  const x = Math.min(...members.map((member) => member.x));
  const y = Math.min(...members.map((member) => member.y));
  return {
    x,
    y,
    width: Math.max(...members.map((member) => member.x + member.width)) - x,
    height: Math.max(...members.map((member) => member.y + member.height)) - y,
  };
}

type Placement = ElementPlacement & { angle?: number };

/// One element put in exactly the box asked for, with no uniform scale between
/// the ask and the answer — the stretched picture and the reshaped colour block.
///
/// `elementPlacements` cannot say this: it scales a unit by one number, which is
/// the right rule for an arrangement and the wrong one for a single rectangle
/// told to cover the page. The points are scaled per axis for the reason the
/// tidy scales them at all — a `line` is drawn from its points and not from its
/// box, so a rule made twice as long that kept yesterday's points is a wide box
/// with a short mark in it.
function exactPlacement(element: SceneElement, box: Rect, to: Rect): Placement {
  const placement: Placement = {
    id: element.id,
    x: round(to.x),
    y: round(to.y),
    width: round(to.width),
    height: round(to.height),
  };
  const points = memberGeometry(element)?.points;
  if (points) {
    const sx = box.width > 0 ? to.width / box.width : 1;
    const sy = box.height > 0 ? to.height / box.height : 1;
    placement.points = points.map(([x, y]) => [round(x * sx), round(y * sy)]);
  }
  return placement;
}

/// A unit's placements spun about its centre. `elementPlacements` is rigid in
/// translation and scale; the turn is the one motion it does not speak, so it
/// is applied after — each member's centre swings round the unit's, and each
/// member's own angle takes the same delta, which is what excalidraw's own
/// multi-select rotation does.
function spun(
  placements: readonly Placement[],
  unit: Rect,
  deltaDegrees: number,
  angleOf: (id: string) => number,
): Placement[] {
  const deltaRadians = (deltaDegrees * Math.PI) / 180;
  const centre = { x: unit.x + unit.width / 2, y: unit.y + unit.height / 2 };
  const cos = Math.cos(deltaRadians);
  const sin = Math.sin(deltaRadians);

  return placements.map((placement) => {
    const dx = placement.x + placement.width / 2 - centre.x;
    const dy = placement.y + placement.height / 2 - centre.y;
    return {
      ...placement,
      x: round(centre.x + dx * cos - dy * sin - placement.width / 2),
      y: round(centre.y + dx * sin + dy * cos - placement.height / 2),
      angle: normalRadians(angleOf(placement.id) + deltaRadians),
    };
  });
}

export function transformObjects(
  elements: readonly SceneElement[],
  changes: readonly TransformChange[],
): TransformResult {
  const pages = boardPages(elements);
  const pageIds = new Set(pages.map((page) => page.id));

  const live = new Map<string, SceneElement>();
  for (const element of elements) {
    if (element.isDeleted !== true && element.id) live.set(element.id, element);
  }
  const labels = new Map<string, SceneElement[]>();
  const groups = new Map<string, SceneElement[]>();
  for (const element of live.values()) {
    const container = element.containerId;
    if (typeof container === "string" && container) {
      (labels.get(container) ?? labels.set(container, []).get(container)!).push(element);
    }
    const group = outerGroupId(element);
    if (group) (groups.get(group) ?? groups.set(group, []).get(group)!).push(element);
  }

  const transformed: string[] = [];
  const unchanged: string[] = [];
  const notFound: string[] = [];
  const refused: TransformRefusal[] = [];
  const clamped: TransformClamp[] = [];
  /// Everything an earlier change in this call already moved: two changes
  /// steering one element — the element twice, a member and its group, a page
  /// and something it carries — cannot both be honoured in one write, so the
  /// later one is refused rather than either being applied on stale geometry.
  const touched = new Set<string>();
  const writes = new Map<string, Record<string, unknown>>();
  /// Where each moved unit landed, for the ownership pass afterwards.
  const landed: { memberIds: string[]; box: Rect }[] = [];

  for (const change of changes) {
    const { objectId } = change;
    const refuse = (reason: string) => refused.push({ objectId, reason });

    const to = readPair(change.to);
    const size = readPair(change.size);
    if (to === null || size === null || (change.angle !== undefined && finite(change.angle) === null)) {
      refuse("the change carries an unreadable number");
      continue;
    }
    /// One positive extent, not two — the read's own rule for a shape (§XI.1),
    /// arriving here because the object it belongs to is not known yet. A rule
    /// lengthened is `[0, 1000]`, and a picture asked for a flat box is refused
    /// below, once there is a kind to refuse it against.
    if (size && !(size[0] >= 0 && size[1] >= 0 && (size[0] > 0 || size[1] > 0))) {
      refuse("size must be positive");
      continue;
    }
    if (!to && !size && change.angle === undefined) {
      unchanged.push(objectId);
      continue;
    }

    if (pageIds.has(objectId)) {
      if (change.angle !== undefined) {
        refuse("pages cannot rotate — excalidraw frames have no angle");
        continue;
      }
      if (size || change.stretch) {
        refuse("a page is resized with resize_page, which reports what falls off");
        continue;
      }
      const page = pageById(pages, objectId)!;
      const frame = live.get(objectId);
      if (!frame) {
        notFound.push(objectId);
        continue;
      }
      if (frame.locked === true) {
        refuse("locked");
        continue;
      }
      /// The page's geometric members ride along — a page moved without them
      /// is a rectangle abandoning its own spread. Locked members ride too:
      /// the move is addressed at the page, and leaving one behind would
      /// silently break the arrangement lock preserves.
      const carried = pageElements(elements, pages, page);
      const ids = [objectId, ...carried.map((element) => element.id)];
      if (ids.some((id) => touched.has(id))) {
        refuse("already transformed by an earlier change in this call");
        continue;
      }
      const [ymin, xmin] = to!;
      const dx = xmin - page.x;
      const dy = ymin - page.y;
      if (Math.abs(dx) <= MOVED && Math.abs(dy) <= MOVED) {
        unchanged.push(objectId);
        continue;
      }
      writes.set(objectId, { x: round(xmin), y: round(ymin) });
      for (const element of carried) {
        const box = elementBox(element)!;
        writes.set(element.id, { x: round(box.x + dx), y: round(box.y + dy) });
      }
      for (const id of ids) touched.add(id);
      transformed.push(objectId);
      continue;
    }

    const element = live.get(objectId);
    if (!element) {
      notFound.push(objectId);
      continue;
    }
    /// The page's ground is asked for on the same terms and for the same reason
    /// (§XI.4): `readableTarget` drops it too, so the refusal has to come first
    /// or a model that read a page's `background` and tried to move it is told
    /// the id does not exist.
    if (isPageBackground(element)) {
      refuse(
        'a page’s background is the page’s own, not an object on it — it is set with set_page_background and moves and resizes with its page',
      );
      continue;
    }
    /// Asked before the handle question, because a bound label has no handle:
    /// `readableTarget` drops it, and answering `notFound` here would take the
    /// dead end §XI.1 named and make it silent instead of explained.
    if (typeof element.containerId === "string" && element.containerId) {
      refuse(`a bound label travels with its container — transform ${element.containerId} instead`);
      continue;
    }
    /// What has a handle is the read's answer and only the read's
    /// (`readableTarget`) — §XI.1's own sentence is that "a kind that can be
    /// listed and not transformed is the bound-label loop again", so the fourth
    /// kind arrives here by widening nothing but the question. It carries the
    /// one-extent rule with it: a rule is a `line` nine hundred wide and zero
    /// high, and a gate asking for two positive extents dropped it.
    const target = readableTarget(element);
    const box = elementBox(element);
    if (!target || !box) {
      notFound.push(objectId);
      continue;
    }
    if (size && target.kind !== "shape" && !(size[0] > 0 && size[1] > 0)) {
      refuse("size must be positive — only a shape may be flat");
      continue;
    }
    if (element.locked === true) {
      refuse("locked");
      continue;
    }

    const group = outerGroupId(element);
    const parts = group ? (groups.get(group) ?? [element]) : [element];
    if (parts.some((part) => part.type === "frame" || part.type === "magicframe")) {
      refuse("grouped with a frame, which a rigid transform cannot honestly move");
      continue;
    }
    const pieces = parts.flatMap((part) => [part, ...(labels.get(part.id) ?? [])]);
    if (pieces.some((piece) => piece.locked === true)) {
      refuse("grouped with a locked element");
      continue;
    }
    /// A lone shape takes the box it was asked for, exactly, with no `stretch`
    /// to ask for it. Invariant 6 is about photographs — "making a photo fit a
    /// shape is a crop" — and a colour block has no proportions to preserve: a
    /// scrim told to cover the page and contained instead comes back covering a
    /// corner of it, which is §VIII's ask-answered-smaller failure at the
    /// geometry door. Grouped, it scales uniformly like everything else,
    /// because a group is an arrangement and reshaping one is not a resize.
    const exact = (change.stretch || target.kind === "shape") && pieces.length === 1;
    if (change.stretch && !(pieces.length === 1 && target.kind !== "text")) {
      refuse("stretch only applies to a lone picture or shape — text and groups scale uniformly");
      continue;
    }
    if (pieces.some((piece) => touched.has(piece.id))) {
      refuse("already transformed by an earlier change in this call");
      continue;
    }

    const members: ArrangeMember[] = [];
    let unreadable = false;
    for (const piece of pieces) {
      const member = memberGeometry(piece);
      if (!member) {
        unreadable = true;
        break;
      }
      members.push(member);
    }
    if (unreadable) {
      refuse("part of its group has no readable geometry");
      continue;
    }

    /// The dialect is the addressed object's own — the page holding it by
    /// §V.3's rule, the same one the read spoke its box in.
    const holding = pageHolding(pages, box);
    /// The no-op tolerance in that dialect: an integer thousandth converts
    /// back within half a thousandth of where the element already is, so a
    /// read box echoed back must land inside it — `MOVED` alone would call
    /// the echo's quantisation residue a move.
    const tolX = holding ? Math.max(MOVED, holding.width / 2000) : MOVED;
    const tolY = holding ? Math.max(MOVED, holding.height / 2000) : MOVED;

    const targetX = to ? (holding ? holding.x + (to[1] / 1000) * holding.width : to[1]) : box.x;
    const targetY = to ? (holding ? holding.y + (to[0] / 1000) * holding.height : to[0]) : box.y;
    let targetW = box.width;
    let targetH = box.height;
    if (size) {
      const askedH = holding ? (size[0] / 1000) * holding.height : size[0];
      const askedW = holding ? (size[1] / 1000) * holding.width : size[1];
      if (exact) {
        targetW = askedW;
        targetH = askedH;
      } else {
        /// Contain, never stretch (canvas.md invariant 6): the largest
        /// uniform scale that fits the asked box.
        const scale = Math.min(askedW / box.width, askedH / box.height);
        targetW = box.width * scale;
        targetH = box.height * scale;
      }
    }

    const delta = change.angle === undefined ? 0 : angleDelta(finite(element.angle) ?? 0, change.angle);
    const still =
      Math.abs(targetX - box.x) <= tolX &&
      Math.abs(targetY - box.y) <= tolY &&
      Math.abs(targetW - box.width) <= tolX &&
      Math.abs(targetH - box.height) <= tolY;
    if (still && delta === 0) {
      unchanged.push(objectId);
      continue;
    }

    const unitId = group ?? objectId;
    const before: ArrangeBox = { id: unitId, ...unionOf(members) };
    /// Off whichever extent the object actually has: a flat `line` is the one
    /// object here whose width or height is legitimately zero, and a ratio
    /// taken against it is a NaN that spreads through every coordinate below.
    const scale =
      box.width > 0 ? targetW / box.width : box.height > 0 ? targetH / box.height : 1;
    /// The whole unit, placed so the addressed element lands where it was
    /// asked to — the model steers by the box it read, and what it read was
    /// the element's, not the group's union.
    const moved: Rect = exact
      ? { x: targetX, y: targetY, width: targetW, height: targetH }
      : {
          x: targetX - (box.x - before.x) * scale,
          y: targetY - (box.y - before.y) * scale,
          width: before.width * scale,
          height: before.height * scale,
        };

    let placements: Placement[] = exact
      ? [exactPlacement(element, box, moved)]
      : elementPlacements([before], [{ id: unitId, ...moved, members }]);
    if (delta !== 0) {
      placements = spun(placements, moved, delta, (id) => finite(live.get(id)?.angle) ?? 0);
    }

    for (const placement of placements) {
      const write: Record<string, unknown> = {
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
      };
      if (placement.fontSize !== undefined) {
        write.fontSize = placement.fontSize;
        /// A geometry door writing words, which it does only here: the type has
        /// stopped following the box, so the breaks and the height it stands to
        /// are this call's to settle rather than the scale's. The tidy takes the
        /// same floor from the same place, because a caption scaled into a grid
        /// cell disappears exactly as readily as one scaled by a model.
        const piece = live.get(placement.id);
        const floored = piece
          ? flooredType(piece, placement, renderFontOf(piece).set)
          : null;
        if (floored) {
          write.fontSize = floored.fontSize;
          write.height = floored.height;
          if (floored.text) write.text = floored.text;
          clamped.push({
            objectId: placement.id,
            asked: placement.fontSize,
            set: floored.fontSize,
          });
        }
      }
      if (placement.points) write.points = placement.points;
      if (placement.angle !== undefined) write.angle = placement.angle;
      writes.set(placement.id, write);
      touched.add(placement.id);
    }
    transformed.push(objectId);
    landed.push({ memberIds: placements.map((placement) => placement.id), box: moved });
  }

  if (writes.size === 0) {
    return { elements: null, transformed, unchanged, notFound, refused, clamped };
  }

  let next: SceneElement[] = elements.map((element) =>
    writes.has(element.id) ? { ...element, ...writes.get(element.id)! } : element,
  );

  /// `frameId` reconciled toward geometry, the `arrangeOwners` rule: the page
  /// a unit landed on takes it, the page it left gives it up, and a section's
  /// ownership — a fact, not a copy of one (§V.1) — is never rewritten. Pages
  /// are read back from the moved scene, so a page and a photo moved in one
  /// call settle against where both ended up.
  const pagesAfter = boardPages(next);
  const pageIdsAfter = new Set(pagesAfter.map((page) => page.id));
  const owners = new Map<string, string | null>();
  for (const unit of landed) {
    const owner = pageHolding(pagesAfter, unit.box)?.id ?? null;
    for (const id of unit.memberIds) owners.set(id, owner);
  }
  let reparented = false;
  next = next.map((element) => {
    const owner = owners.get(element.id);
    if (owner === undefined) return element;
    const current = typeof element.frameId === "string" ? element.frameId : null;
    if (current === owner) return element;
    if (owner === null && !(current && pageIdsAfter.has(current))) return element;
    reparented = true;
    return { ...element, frameId: owner };
  });
  /// A page's children sit immediately before it — excalidraw's invariant,
  /// restored the way the tidy restores it whenever ownership changed hands.
  if (reparented) next = pageChildOrder(next);

  return { elements: next, transformed, unchanged, notFound, refused, clamped };
}
