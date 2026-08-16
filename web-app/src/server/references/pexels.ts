import "server-only";
import { ImageProvider } from "@/generated/prisma/enums";
import { env } from "@/env";
import type { ImageCandidate, SearchInput } from "./types";

type PexelsPhoto = {
  id: number;
  url: string;
  width: number | null;
  height: number | null;
  alt: string | null;
  photographer: string;
  photographer_url: string;
  src: { large: string; medium: string; tiny: string };
};

export function isConfigured() {
  return Boolean(env().PEXELS_API_KEY);
}

export async function search(input: SearchInput): Promise<ImageCandidate[]> {
  const params = new URLSearchParams({ query: input.query, per_page: String(input.limit) });
  if (input.orientation) params.set("orientation", input.orientation);

  const response = await fetch(`https://api.pexels.com/v1/search?${params}`, {
    headers: { Authorization: env().PEXELS_API_KEY ?? "" },
  });
  if (!response.ok) {
    throw new Error(`pexels search failed: ${response.status} ${await response.text()}`);
  }

  const { photos = [] } = (await response.json()) as { photos?: PexelsPhoto[] };

  return photos.map((photo) => ({
    provider: ImageProvider.PEXELS,
    providerId: String(photo.id),
    title: photo.alt ?? "",
    sourceUrl: photo.url,
    imageUrl: photo.src.large,
    thumbUrl: photo.src.medium,
    width: photo.width,
    height: photo.height,
    creatorName: photo.photographer,
    creatorUrl: photo.photographer_url,
    license: "Pexels License",
    licenseUrl: "https://www.pexels.com/license/",
    downloadTrackUrl: null,
  }));
}
