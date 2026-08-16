/// A reference's bytes are a private object in our bucket, so the browser is
/// never handed a bucket path — it gets this app URL, which redirects to a
/// freshly signed read URL. The path is stable per reference, so re-rendering
/// the gallery after every upload does not change any <img src>, and a tab
/// left open past a signature's lifetime still shows its images.
export function referenceImagePath(id: string, variant?: "thumb") {
  const path = `/api/references/${id}/image`;
  return variant ? `${path}?variant=${variant}` : path;
}

/// The rest destructure is what drops the bucket paths from the payload.
/// `thumbUrl` falls back to the original for rows uploaded before thumbnails
/// existed (and for images already small enough to need none), which keeps the
/// tile and the viewer on one cache entry in that case.
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
  };
}
