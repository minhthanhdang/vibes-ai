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

/// The id `delta` steps from `id` in gallery order, wrapping at both ends.
/// Null means there is nowhere to go — an unknown id, or a gallery too small to
/// have a neighbour — which is also the signal to close the full-size viewer.
export function neighborId(references: { id: string }[], id: string | null, delta: number) {
  const index = references.findIndex((reference) => reference.id === id);
  if (index < 0 || references.length < 2) return null;
  return references[(index + delta + references.length) % references.length]!.id;
}
