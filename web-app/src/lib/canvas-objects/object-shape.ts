import type { CanvasObject } from "@/lib/canvas-objects/object-read";
import { PAGE_BOX_SCALE } from "@/lib/pages/page-blocks";
import { cropShapeAt, type CropShape } from "@/lib/references/reference-version";

/// The shape of one object on a board, read off the box the model was shown
/// (compositor-v2.md §IV.4, `crop_image`'s `toObjectId`).
///
/// Agent 6 answers "what shape should this cut be" from a template: a picture
/// sits in a slot the layout drew, and `slotShapeFor` reads the opening out of
/// the layout. Agent 8 has no templates — its openings are boxes it wrote
/// itself with `put_on_canvas` — so the only account of the shape it is filling
/// is the object standing in it.
///
/// Read off `canvasObjects` rather than off the scene, and that is the point
/// rather than a convenience: the box here is the box `read_canvas` answered
/// with, so the shape a cut is held to is the shape the model was told the
/// opening was. A second measurement of the same element could differ from the
/// first — clipped boxes are the part the page shows, not the whole picture —
/// and then the cut would be held to a rectangle nobody has seen.
///
/// No database, no scene parsing: what goes in is objects, what comes out is a
/// ratio.

export type ObjectShape = {
  objectId: string;
  kind: CanvasObject["kind"];
  /// What a cut for this box is held to, in the one vocabulary the crop path
  /// speaks: one of the named formats when the box is near one, and the
  /// measured ratio said as `w:1` when it is not.
  shape: CropShape;
  /// The box in scene pixels, which is what the ratio was measured off. Said
  /// back because a shape alone cannot tell a hero from a thumbnail, and how
  /// big the opening is decides whether cutting is worth it at all.
  width: number;
  height: number;
  pageId?: string;
  /// The picture standing in the box now — usually the one being cut, and the
  /// difference between "hold it to this shape" and "hold it to this shape and
  /// it is already the wrong picture there".
  referenceId?: string;
  /// A page's own name, for the answer that says which opening was measured.
  name?: string;
  /// The object runs off its page's edge, so the box measured is the part the
  /// page shows rather than the whole of it.
  clipped?: true;
};

/// The object's box in scene pixels.
///
/// A page and a loose object cross in pixels already. An object *on* a page is
/// a share of that page in thousandths, so the page it names is looked up in
/// the same read and the share is multiplied back out — which is why this takes
/// the whole list and not one object.
function objectPixels(
  objects: readonly CanvasObject[],
  object: CanvasObject,
): { width: number; height: number } | null {
  /// The page's recorded size rather than its own box: the box is rounded scene
  /// pixels and the size is the rectangle the page actually is, and a preset
  /// measured off a rounding is a preset that is 1:1.0007.
  if (object.kind === "page") {
    const { width, height } = object.size;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  const [ymin, xmin, ymax, xmax] = object.box;
  const width = xmax - xmin;
  const height = ymax - ymin;
  if (!(width > 0) || !(height > 0)) return null;
  if (object.boxUnit === "px") return { width, height };

  const page = objects.find(
    (other): other is Extract<CanvasObject, { kind: "page" }> =>
      other.kind === "page" && other.objectId === object.pageId,
  );
  /// A share of a page that is not in the list is a share of nothing. It cannot
  /// happen on a whole-board read and can on a page-scoped one, so it is
  /// answered as "no shape" rather than as a ratio of two thousandths.
  if (!page) return null;

  return {
    width: Math.round((width / PAGE_BOX_SCALE) * page.size.width),
    height: Math.round((height / PAGE_BOX_SCALE) * page.size.height),
  };
}

/// Which object that handle names, and what shape a cut made to fill it is held
/// to. Null for a handle this board does not carry, for a box with no area, and
/// for a sliver past `cropShapeAt`'s limit — a shape a cut cannot be held to is
/// not a shape, and the caller has a sentence for each.
export function objectShape(
  objects: readonly CanvasObject[],
  objectId: string,
): ObjectShape | null {
  const object = objects.find((candidate) => candidate.objectId === objectId);
  if (!object) return null;

  const size = objectPixels(objects, object);
  if (!size) return null;

  const shape = cropShapeAt(size.width / size.height);
  if (!shape) return null;

  return {
    objectId: object.objectId,
    kind: object.kind,
    shape,
    ...size,
    ...(object.pageId && { pageId: object.pageId }),
    ...(object.kind === "image" && object.referenceId && { referenceId: object.referenceId }),
    ...(object.kind === "page" && { name: object.name }),
    ...(object.clipped && { clipped: true as const }),
  };
}
