type Ordered = { isFavorite: boolean; createdAt: Date | string };

/// The server's gallery order — favorites first, newest first within each group
/// — mirrored on the client so an optimistic toggle lands the tile where the
/// refetch will put it. Any drift between the two shows up as a tile that jumps
/// once the mutation settles, so this has to match reference.listByProject.
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

/// Where an upload still in flight belongs in the grid: the row it will become
/// is never a favorite and is always the newest, so the placeholder goes at the
/// head of the non-favorite block. Anywhere else and the tile jumps sideways the
/// moment the row lands. `references` is assumed to already be in gallery order.
export function withPendingUploads<T extends { isFavorite: boolean }, P extends Pending>(
  references: T[],
  pending: P[],
): (T | P)[] {
  const firstPlain = references.findIndex((reference) => !reference.isFavorite);
  const at = firstPlain < 0 ? references.length : firstPlain;
  return [...references.slice(0, at), ...pending, ...references.slice(at)];
}

export function isPendingUpload<T extends object, P extends Pending>(tile: T | P): tile is P {
  return "pendingKey" in tile;
}

/// The id `delta` steps from `id` in gallery order, wrapping at both ends.
/// Null means there is nowhere to go — an unknown id, or a gallery too small to
/// have a neighbour — which is also the signal to close the full-size viewer.
export function neighborId(references: { id: string }[], id: string | null, delta: number) {
  const index = references.findIndex((reference) => reference.id === id);
  if (index < 0 || references.length < 2) return null;
  return references[(index + delta + references.length) % references.length]!.id;
}
