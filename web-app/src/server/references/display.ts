import "server-only";
import { signedReadUrl } from "@/server/google/storage";
import type { ReferenceModel } from "@/generated/prisma/models";

/// Every reference is an object in our bucket, so the browser never gets a
/// bucket path — it gets a short-lived signed URL minted per read.
export async function forDisplay(reference: ReferenceModel) {
  return { ...reference, displayUrl: await signedReadUrl(reference.gcsUri) };
}
