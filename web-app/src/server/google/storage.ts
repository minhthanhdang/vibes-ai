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

/// An object too large to read back, told apart from a bucket that refused or a
/// locator naming nothing — the caller answers a size it cannot hold with a
/// sentence about the picture rather than with "something went wrong".
export class ObjectTooLargeError extends Error {
  override readonly name = "ObjectTooLargeError";
}

/// Read the name rather than asking `instanceof`: the two are the same question
/// only while thrower and catcher hold one instance of this module, and under
/// the test runner they do not — an `.mts` test reaches it as ESM and the app's
/// own graph as CJS, so the branch would be false in exactly the test that
/// exercises it.
export function isObjectTooLarge(cause: unknown): cause is ObjectTooLargeError {
  return cause instanceof Error && cause.name === "ObjectTooLargeError";
}

/// Whether the size GCS recorded for an object clears a ceiling. Apart from the
/// read because the read needs a bucket and this needs nothing.
///
/// Asked as "fits" rather than "is too large", which is the whole of why it is
/// safe: a size the bucket did not record parses to NaN, every comparison with
/// NaN is false, and so an unreadable size fails this test and would have passed
/// `size > maxBytes` — a bound written the other way round reads an unknown size
/// as a small one and pulls whatever is behind it into the function. GCS records
/// a size for every object it stored, so this refuses nothing that exists.
export function fitsInOneFunction(recordedSize: string | number | undefined, maxBytes: number) {
  return Number(recordedSize ?? NaN) <= maxBytes;
}

/// The bytes back out of the bucket, into the function asking for them.
///
/// Every other read here is a signed URL handed to a browser or to Vertex,
/// because uploads deliberately never cross a function (infra §VII). A crop
/// filed by a tool is the one thing that has to: the cut is made where the row
/// is written, so the original comes back in. Same reason `parseGcsUri` is used
/// rather than `bucket()` — a reference may point at an object this deployment
/// does not own the prefix of.
///
/// The ceiling is the caller's, and it is checked before the transfer rather
/// than as the bytes arrive: nothing bounds how large an upload is (it goes
/// browser → GCS against a signed URL and never passes through here), so an
/// object no function can hold is a thing that exists. `remote-image.ts` caps
/// its read chunk by chunk because a stranger's `content-length` is a claim;
/// this is our own bucket's accounting of what it stored, so one metadata call
/// refuses with nothing resident.
export async function readObject(gcsUri: string, maxBytes: number) {
  const { bucket: name, object } = parseGcsUri(gcsUri);
  const file = storage().bucket(name).file(object);

  const [metadata] = await file.getMetadata();
  if (!fitsInOneFunction(metadata.size, maxBytes)) {
    const ceiling = Math.round(maxBytes / 1_000_000);
    throw new ObjectTooLargeError(
      metadata.size === undefined
        ? `${gcsUri} has no recorded size, so it cannot be held to the ${ceiling} MB this can read into one function`
        : `${gcsUri} is ${Math.round(Number(metadata.size) / 1_000_000)} MB, past the ${ceiling} MB this can read into one function`,
    );
  }

  const [bytes] = await file.download();
  return bytes;
}
