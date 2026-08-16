/// The id `delta` steps from `id` in gallery order, wrapping at both ends.
/// Null means there is nowhere to go — an unknown id, or a gallery too small to
/// have a neighbour — which is also the signal to close the full-size viewer.
export function neighborId(references: { id: string }[], id: string | null, delta: number) {
  const index = references.findIndex((reference) => reference.id === id);
  if (index < 0 || references.length < 2) return null;
  return references[(index + delta + references.length) % references.length]!.id;
}
