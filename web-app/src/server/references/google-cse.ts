import "server-only";
import { ImageProvider } from "@/generated/prisma/enums";
import { env } from "@/env";
import type { ImageCandidate, SearchInput } from "./types";

/// Only licences that permit reuse. Without this the API returns the whole
/// indexed web, almost none of which is safe to put in a client deck.
const CC_ONLY = "cc_publicdomain|cc_attribute|cc_sharealike";

/// The API caps a single request at 10 results, and paging costs another
/// round trip — agent 1 asks the cheaper providers first, so one page is
/// enough here.
const MAX_PER_REQUEST = 10;

type CseItem = {
  title?: string;
  link: string;
  displayLink?: string;
  image?: { contextLink?: string; thumbnailLink?: string; width?: number; height?: number };
};

export function isConfigured() {
  return Boolean(env().GOOGLE_CSE_KEY && env().GOOGLE_CSE_CX);
}

/// Unlike Unsplash and Pexels, a CSE hit carries no author field — the licence
/// is known but the person to credit is not. Rows land with an empty
/// `creatorName`, and the UI surfaces that as "verify before use" rather than
/// pretending the image is cleared.
export async function search(input: SearchInput): Promise<ImageCandidate[]> {
  const params = new URLSearchParams({
    key: env().GOOGLE_CSE_KEY ?? "",
    cx: env().GOOGLE_CSE_CX ?? "",
    q: input.query,
    searchType: "image",
    rights: CC_ONLY,
    safe: "active",
    num: String(Math.min(input.limit, MAX_PER_REQUEST)),
  });

  const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`);
  if (!response.ok) {
    throw new Error(`google cse search failed: ${response.status} ${await response.text()}`);
  }

  const { items = [] } = (await response.json()) as { items?: CseItem[] };

  return items.map((item) => ({
    provider: ImageProvider.GOOGLE_CSE,
    providerId: item.link,
    title: item.title ?? "",
    sourceUrl: item.image?.contextLink ?? item.link,
    imageUrl: item.link,
    thumbUrl: item.image?.thumbnailLink ?? item.link,
    width: item.image?.width ?? null,
    height: item.image?.height ?? null,
    creatorName: "",
    creatorUrl: item.image?.contextLink ?? null,
    license: "Creative Commons — confirm terms at source",
    licenseUrl: item.image?.contextLink ?? null,
    downloadTrackUrl: null,
  }));
}
