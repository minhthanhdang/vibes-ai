type Ordered = { isFavorite: boolean; createdAt: Date | string };

export function inGalleryOrder<T extends Ordered>(references: T[]) {
  return [...references].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export function withFavorite<T extends Ordered & { id: string }>(
  references: T[],
  id: string,
  isFavorite: boolean,
) {
  return inGalleryOrder(
    references.map((reference) => (reference.id === id ? { ...reference, isFavorite } : reference)),
  );
}

export type Pending = { pendingKey: string };

export function withPendingUploads<T extends { isFavorite: boolean }, P extends Pending>(
  references: readonly T[],
  pending: readonly P[],
): (T | P)[] {
  const firstPlain = references.findIndex((reference) => !reference.isFavorite);
  const at = firstPlain < 0 ? references.length : firstPlain;
  return [...references.slice(0, at), ...pending, ...references.slice(at)];
}

export function isPendingUpload<T extends object, P extends Pending>(tile: T | P): tile is P {
  return "pendingKey" in tile;
}

export function neighborId(references: { id: string }[], id: string | null, delta: number) {
  const index = references.findIndex((reference) => reference.id === id);
  if (index < 0 || references.length < 2) return null;
  return references[(index + delta + references.length) % references.length]!.id;
}

const VIEWER_STEP: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };

export function viewerStep(key: string, { editing = false } = {}) {
  if (editing) return 0;
  return VIEWER_STEP[key] ?? 0;
}
