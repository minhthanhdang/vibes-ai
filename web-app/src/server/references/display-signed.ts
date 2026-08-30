import "server-only";
import { deterministicReadUrl } from "@/server/google/storage";

type SignableReference = { id: string; gcsUri: string; thumbGcsUri?: string | null };

export async function manyForDisplaySigned<T extends SignableReference>(
  references: readonly T[],
  sign: (gcsUri: string) => Promise<string> = deterministicReadUrl,
) {
  const signed = new Map<string, Promise<string>>();
  const urlOf = (gcsUri: string) => {
    let pending = signed.get(gcsUri);
    if (!pending) {
      pending = sign(gcsUri);
      signed.set(gcsUri, pending);
    }
    return pending;
  };

  return Promise.all(
    references.map(async ({ gcsUri, thumbGcsUri, ...reference }) => ({
      ...reference,
      displayUrl: await urlOf(gcsUri),
      thumbUrl: await urlOf(thumbGcsUri ?? gcsUri),
      hasThumbnail: thumbGcsUri != null,
    })),
  );
}

export async function forDisplaySigned<T extends SignableReference>(
  reference: T,
  sign: (gcsUri: string) => Promise<string> = deterministicReadUrl,
) {
  const [shaped] = await manyForDisplaySigned([reference], sign);
  return shaped;
}
