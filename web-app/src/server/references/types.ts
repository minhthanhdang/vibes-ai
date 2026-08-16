import { z } from "zod";
import { ImageProvider } from "@/generated/prisma/enums";

/// What every provider normalizes to. Attribution fields are non-optional by
/// design: a provider that cannot say who made a photo cannot be credited, and
/// crediting is the condition on which these images are free to use.
export const imageCandidate = z.object({
  provider: z.enum(ImageProvider),
  providerId: z.string(),
  title: z.string(),
  /// The photo's page on the provider — where the credit link points.
  sourceUrl: z.string(),
  /// Hotlinked at display time. Unsplash and Pexels both require their URLs to
  /// be the ones the browser loads, so this is never swapped for a mirror.
  imageUrl: z.string(),
  thumbUrl: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  creatorName: z.string(),
  creatorUrl: z.string().nullable(),
  license: z.string(),
  licenseUrl: z.string().nullable(),
  downloadTrackUrl: z.string().nullable(),
});

export type ImageCandidate = z.infer<typeof imageCandidate>;

const PROVIDER_LABEL: Record<ImageProvider, string> = {
  UNSPLASH: "Unsplash",
  PEXELS: "Pexels",
  GOOGLE_CSE: "the web",
  UPLOAD: "upload",
};

/// The one string every surface that shows a reference has to render. Both
/// provider guidelines ask for photographer *and* platform, so neither half is
/// optional; an unknown photographer says so out loud instead of going blank.
export function creditLine(reference: { creatorName: string; provider: ImageProvider }) {
  if (reference.provider === ImageProvider.UPLOAD) return reference.creatorName;
  const who = reference.creatorName || "Unknown photographer — verify before use";
  return `Photo by ${who} on ${PROVIDER_LABEL[reference.provider]}`;
}

export const searchInput = z.object({
  query: z.string().min(1).max(300),
  limit: z.number().int().min(1).max(40).default(12),
  orientation: z.enum(["landscape", "portrait", "square"]).optional(),
});

export type SearchInput = z.infer<typeof searchInput>;
