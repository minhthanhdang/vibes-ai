import "server-only";
import { ImageProvider } from "@/generated/prisma/enums";
import { env } from "@/env";
import type { ImageCandidate, SearchInput } from "./types";

/// Unsplash's guidelines require attribution links to carry the app's UTM
/// params, so photographers can see where their referrals came from.
const UTM = "utm_source=director_assistant&utm_medium=referral";

function credited(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${UTM}`;
}

type UnsplashPhoto = {
  id: string;
  description: string | null;
  alt_description: string | null;
  width: number | null;
  height: number | null;
  urls: { regular: string; small: string };
  links: { html: string; download_location?: string };
  user: { name: string; links: { html: string } };
};

/// Unsplash orientations are named differently from ours for one value only.
const ORIENTATION = { landscape: "landscape", portrait: "portrait", square: "squarish" } as const;

export function isConfigured() {
  return Boolean(env().UNSPLASH_ACCESS_KEY);
}

export async function search(input: SearchInput): Promise<ImageCandidate[]> {
  const params = new URLSearchParams({
    query: input.query,
    per_page: String(input.limit),
    // `high` drops anything Unsplash flags as sensitive.
    content_filter: "high",
  });
  if (input.orientation) params.set("orientation", ORIENTATION[input.orientation]);

  const response = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
    headers: {
      Authorization: `Client-ID ${env().UNSPLASH_ACCESS_KEY}`,
      "Accept-Version": "v1",
    },
  });
  if (!response.ok) {
    throw new Error(`unsplash search failed: ${response.status} ${await response.text()}`);
  }

  const { results = [] } = (await response.json()) as { results?: UnsplashPhoto[] };

  return results.map((photo) => ({
    provider: ImageProvider.UNSPLASH,
    providerId: photo.id,
    title: photo.description ?? photo.alt_description ?? "",
    sourceUrl: credited(photo.links.html),
    imageUrl: photo.urls.regular,
    thumbUrl: photo.urls.small,
    width: photo.width,
    height: photo.height,
    creatorName: photo.user.name,
    creatorUrl: credited(photo.user.links.html),
    license: "Unsplash License",
    licenseUrl: "https://unsplash.com/license",
    downloadTrackUrl: photo.links.download_location ?? null,
  }));
}

/// Unsplash counts a "download" when a user takes the photo for real, not when
/// it shows up in a result list — so this is deliberately not called from
/// `search`. Failure is swallowed: a missed statistic must not fail the action
/// the user actually asked for.
export async function trackDownload(downloadLocation: string) {
  try {
    await fetch(downloadLocation, {
      headers: { Authorization: `Client-ID ${env().UNSPLASH_ACCESS_KEY}` },
    });
  } catch {
    // best effort
  }
}
