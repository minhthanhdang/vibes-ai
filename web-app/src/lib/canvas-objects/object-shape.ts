import type { CanvasObject } from "@/lib/canvas-objects/object-read";
import { PAGE_BOX_SCALE } from "@/lib/pages/page-blocks";
import { cropShapeAt, type CropShape } from "@/lib/references/reference-version";

export type ObjectShape = {
  objectId: string;
  kind: CanvasObject["kind"];
  shape: CropShape;
  width: number;
  height: number;
  pageId?: string;
  referenceId?: string;
  name?: string;
  clipped?: true;
};

function objectPixels(
  objects: readonly CanvasObject[],
  object: CanvasObject,
): { width: number; height: number } | null {
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
  if (!page) return null;

  return {
    width: Math.round((width / PAGE_BOX_SCALE) * page.size.width),
    height: Math.round((height / PAGE_BOX_SCALE) * page.size.height),
  };
}

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
