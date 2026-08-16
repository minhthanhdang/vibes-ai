import "server-only";
import * as googleCse from "./google-cse";
import * as pexels from "./pexels";
import * as unsplash from "./unsplash";
import type { ImageCandidate, SearchInput } from "./types";

export { imageCandidate, searchInput } from "./types";
export type { ImageCandidate, SearchInput } from "./types";
export { trackDownload } from "./unsplash";

/// Order is the fallback order, not a ranking: Unsplash and Pexels return a
/// named photographer and an explicit blanket licence, so they are asked
/// first. Google CSE is the long tail — wider, but each hit needs its licence
/// confirmed by a human before it ships in a deck.
const PROVIDERS = [unsplash, pexels, googleCse];

export function configuredProviders() {
  return PROVIDERS.filter((provider) => provider.isConfigured()).length;
}

/// Fans out to every configured provider and interleaves the results, so a
/// search is not all one source when several are available. No relevance
/// ranking — providers are already sorted by their own relevance and we keep
/// their order.
export async function searchImages(input: SearchInput): Promise<ImageCandidate[]> {
  const available = PROVIDERS.filter((provider) => provider.isConfigured());
  if (!available.length) {
    throw new Error(
      "no image provider configured — set UNSPLASH_ACCESS_KEY, PEXELS_API_KEY, or GOOGLE_CSE_KEY + GOOGLE_CSE_CX",
    );
  }

  const settled = await Promise.allSettled(available.map((provider) => provider.search(input)));

  const failures = settled.filter((result) => result.status === "rejected");
  const lists = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  // One provider being down is survivable; all of them being down is the
  // caller's problem, and the first error explains it better than an empty list.
  if (!lists.length) throw failures[0].reason;

  return dedupe(interleave(lists)).slice(0, input.limit);
}

function interleave(lists: ImageCandidate[][]) {
  const longest = Math.max(...lists.map((list) => list.length));
  const out: ImageCandidate[] = [];
  for (let index = 0; index < longest; index++) {
    for (const list of lists) {
      if (list[index]) out.push(list[index]);
    }
  }
  return out;
}

/// The same photo can surface on more than one provider, and Google CSE
/// happily indexes Unsplash itself.
function dedupe(candidates: ImageCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.imageUrl.split("?")[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
