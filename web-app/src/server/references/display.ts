/// A reference's bytes are a private object in our bucket, so the browser is
/// never handed a bucket path — it gets this app URL, which redirects to a
/// freshly signed read URL. The path is stable per reference, so re-rendering
/// the gallery after every upload does not change any <img src>, and a tab
/// left open past a signature's lifetime still shows its images.
export function referenceImagePath(id: string) {
  return `/api/references/${id}/image`;
}

/// The rest destructure is what drops gcsUri from the payload.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function forDisplay<T extends { id: string; gcsUri: string }>({ gcsUri, ...reference }: T) {
  return { ...reference, displayUrl: referenceImagePath(reference.id) };
}
