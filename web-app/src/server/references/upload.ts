import "server-only";
import { randomUUID } from "node:crypto";
import { env } from "@/env";
import { signedUploadUrl } from "@/server/google/storage";
import { IMAGE_EXTENSIONS, type UploadContentType } from "@/lib/image-types";

/// Every object a project owns lives under one prefix, which is what makes the
/// locator the client hands back verifiable.
const prefixOf = (projectId: string) => `projects/${projectId}/references/`;

export function referenceUploadUrl(projectId: string, contentType: UploadContentType) {
  const objectPath = `${prefixOf(projectId)}${randomUUID()}.${IMAGE_EXTENSIONS[contentType]}`;
  return signedUploadUrl(objectPath, contentType);
}

/// The browser PUTs the bytes and then tells us where they landed, so the uri
/// is client input: anything outside this project's prefix is a forged
/// locator, not an upload.
export function isProjectUpload(projectId: string, gcsUri: string) {
  return gcsUri.startsWith(`gs://${env().GCS_BUCKET}/${prefixOf(projectId)}`);
}
