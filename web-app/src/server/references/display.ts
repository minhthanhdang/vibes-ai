function imageRoute(id: string) {
  return `/api/references/${id}/image`;
}

/// A reference's bytes are a private object in our bucket, so the browser is
/// never handed a bucket path — it gets this app URL, which redirects to a
/// freshly signed read URL. The path is stable per reference, so re-rendering
/// the gallery after every upload does not change any <img src>, and a tab
/// left open past a signature's lifetime still shows its images.
export function referenceImagePath(id: string, variant?: "thumb") {
  const path = imageRoute(id);
  return variant ? `${path}?variant=${variant}` : path;
}

/// The same bytes behind the same check, streamed through the app instead of
/// redirected to the bucket — so the image is same-origin.
///
/// That matters for exactly one thing, and it is not cosmetic: the redirect
/// makes an `<img>` cross-origin, a canvas that has drawn a cross-origin image
/// is tainted, and reading a tainted canvas back throws. Exporting a moodboard
/// is drawing it to a canvas and reading it back, so a board whose photos came
/// through the redirect cannot be exported at all — every "Export image" on it
/// is a `SecurityError`. The moodboard therefore loads its images here.
///
/// The gallery keeps the redirect: it is the cheaper of the two, its bytes
/// never leave the bucket's CDN, and nothing reads its pixels.
///
/// `variant` is which copy of the reference the board needs at the size it
/// draws it — see `boardImageVariant`. Asking for a thumbnail a row has not got
/// is answered with the original, so the URL depends only on what was asked
/// for: the drop, which cannot see the row, and the load, which can, agree on
/// one cache entry.
export function referenceCanvasImagePath(id: string, variant?: "thumb") {
  const query = variant ? `?stream=1&variant=${variant}` : "?stream=1";
  return `${imageRoute(id)}${query}`;
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
