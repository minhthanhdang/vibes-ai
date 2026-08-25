/// A file the browser is still uploading. The gallery renders one placeholder
/// tile per entry, so the user sees a dropped batch immediately instead of
/// after the first signed PUT and database write have both come back.
export type PendingUpload = { pendingKey: string; file: File; previewUrl?: string };
