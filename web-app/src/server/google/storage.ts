import "server-only";
import { Storage } from "@google-cloud/storage";
import { env } from "@/env";

let cached: Storage | undefined;

function storage() {
  cached ??= new Storage({
    projectId: env().GOOGLE_CLOUD_PROJECT,
    credentials: env().GOOGLE_SERVICE_ACCOUNT_JSON,
  });
  return cached;
}

export function bucket() {
  return storage().bucket(env().GCS_BUCKET);
}

const GS_URI = /^gs:\/\/([^/]+)\/(.+)$/;

export function parseGcsUri(uri: string) {
  const match = GS_URI.exec(uri);
  if (!match) throw new Error(`not a gs:// uri: ${uri}`);
  return { bucket: match[1], object: match[2] };
}

/// Signs locally from the private key in the SA JSON — no signBlob call, so
/// iamcredentials and roles/iam.serviceAccountTokenCreator are not required.
export async function signedReadUrl(gcsUri: string) {
  const { bucket: name, object } = parseGcsUri(gcsUri);
  const [url] = await storage()
    .bucket(name)
    .file(object)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + env().SIGNED_URL_TTL_SECONDS * 1000,
    });
  return url;
}

export async function signedUploadUrl(objectPath: string, contentType: string) {
  const [url] = await bucket()
    .file(objectPath)
    .getSignedUrl({
      version: "v4",
      action: "write",
      contentType,
      expires: Date.now() + env().SIGNED_URL_TTL_SECONDS * 1000,
    });
  return { url, gcsUri: `gs://${env().GCS_BUCKET}/${objectPath}` };
}
