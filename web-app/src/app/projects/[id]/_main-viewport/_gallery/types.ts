import type { ReferenceOrigin } from "@/generated/prisma/enums";

export type PendingUpload = { pendingKey: string; file: File; previewUrl?: string };

export type GalleryTileReference = {
  id: string;
  title: string;
  thumbUrl: string;
  isFavorite: boolean;
  generationPrompt?: string | null;
  origin?: ReferenceOrigin | null;
};

export type LightboxReference = {
  id: string;
  title: string;
  isFavorite: boolean;
  displayUrl: string;
  width: number | null;
  height: number | null;
  origin?: ReferenceOrigin | null;
  generationPrompt?: string | null;
};
