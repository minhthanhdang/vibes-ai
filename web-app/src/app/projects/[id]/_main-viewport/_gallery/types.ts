import type { ReferenceOrigin } from "@/generated/prisma/enums";

/// A file the browser is still uploading. The gallery renders one placeholder
/// tile per entry, so the user sees a dropped batch immediately instead of
/// after the first signed PUT and database write have both come back.
export type PendingUpload = { pendingKey: string; file: File; previewUrl?: string };

/// What a grid tile needs of a reference row. Structural rather than the query's
/// own type: the tile draws a picture and says what it is, and nothing about
/// where the row came from.
export type GalleryTileReference = {
  id: string;
  title: string;
  thumbUrl: string;
  isFavorite: boolean;
  generationPrompt?: string | null;
  origin?: ReferenceOrigin | null;
};

/// What the full-size viewer needs of a reference row — the original's bytes,
/// its shape, and the two columns the panel beside it words its sentences from.
export type LightboxReference = {
  id: string;
  title: string;
  isFavorite: boolean;
  displayUrl: string;
  width: number | null;
  height: number | null;
  /// Carried for the Remove control the gallery lends this viewer: what the
  /// conversation is told a removal took is worded off the row's provenance, and
  /// the viewer is the one place the whole picture is on screen when it goes.
  origin?: ReferenceOrigin | null;
  /// And what it was drawn from, for the panel beside the picture. The gallery
  /// hands this viewer whole rows, so the words are already here — reading them
  /// back per open reference would be a second query for a column the list has.
  generationPrompt?: string | null;
};
