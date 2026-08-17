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
import {
  boardPages,
  elementBox,
  pageById,
  pageChildOrder,
  pageElements,
  pageHolding,
} from "@/lib/pages/board-pages";
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
///   with the box following;
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
    if (size && !(size[0] > 0 && size[1] > 0)) {
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
    const box = element ? elementBox(element) : null;
    if (
      !element ||
      (element.type !== "image" && element.type !== "text") ||
      !box ||
      !(box.width > 0 && box.height > 0)
    ) {
      notFound.push(objectId);
      continue;
    }
    if (typeof element.containerId === "string" && element.containerId) {
      refuse(`a bound label travels with its container — transform ${element.containerId} instead`);
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
    if (change.stretch && (element.type !== "image" || pieces.length > 1)) {
      refuse("stretch only applies to a lone image — text and groups scale uniformly");
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
      if (change.stretch) {
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
    const scale = targetW / box.width;
    /// The whole unit, placed so the addressed element lands where it was
    /// asked to — the model steers by the box it read, and what it read was
    /// the element's, not the group's union.
    const moved: Rect = change.stretch
      ? { x: targetX, y: targetY, width: targetW, height: targetH }
      : {
          x: targetX - (box.x - before.x) * scale,
          y: targetY - (box.y - before.y) * scale,
          width: before.width * scale,
          height: before.height * scale,
        };

    let placements: Placement[] = change.stretch
      ? [
          {
            id: objectId,
            x: round(targetX),
            y: round(targetY),
            width: round(targetW),
            height: round(targetH),
          },
        ]
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
      if (placement.fontSize !== undefined) write.fontSize = placement.fontSize;
      if (placement.points) write.points = placement.points;
      if (placement.angle !== undefined) write.angle = placement.angle;
      writes.set(placement.id, write);
      touched.add(placement.id);
    }
    transformed.push(objectId);
    landed.push({ memberIds: placements.map((placement) => placement.id), box: moved });
  }

  if (writes.size === 0) {
    return { elements: null, transformed, unchanged, notFound, refused };
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

  return { elements: next, transformed, unchanged, notFound, refused };
}
