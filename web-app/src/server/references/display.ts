function imageRoute(id: string) {
  return `/api/references/${id}/image`;
}

export function referenceImagePath(id: string, variant?: "thumb") {
  const path = imageRoute(id);
  return variant ? `${path}?variant=${variant}` : path;
}

export function referenceCanvasImagePath(id: string, variant?: "thumb") {
  const query = variant ? `?stream=1&variant=${variant}` : "?stream=1";
  return `${imageRoute(id)}${query}`;
}

export function forDisplay<T extends { id: string; gcsUri: string; thumbGcsUri?: string | null }>({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  gcsUri,
  thumbGcsUri,
  ...reference
}: T) {
  return {
    ...reference,
    displayUrl: referenceImagePath(reference.id),
    thumbUrl: referenceImagePath(reference.id, thumbGcsUri ? "thumb" : undefined),
    hasThumbnail: thumbGcsUri != null,
  };
}
