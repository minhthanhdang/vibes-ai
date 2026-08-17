import "server-only";
import { lookup } from "node:dns/promises";
import {
  importableContentType,
  importableUrl,
  isBlockedAddress,
  isIpLiteral,
  REMOTE_IMAGE_BYTE_LIMIT,
  REMOTE_IMAGE_MAX_REDIRECTS,
  REMOTE_IMAGE_TIMEOUT_MS,
} from "@/lib/intake/remote-image";
import type { RemoteImageFailure } from "@/lib/intake/remote-image";
import type { UploadContentType } from "@/lib/intake/image-types";

/// Fetching an image the user dragged in from a web page. The rules for
/// which URLs are fetchable at all are in `@/lib/remote-image` and tested
/// without a network; this is the request that applies them.

export class RemoteImageError extends Error {
  constructor(readonly reason: RemoteImageFailure) {
    super(reason);
    this.name = "RemoteImageError";
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/// The hostname check that `importableUrl` cannot do, because it needs DNS: a
/// name that resolves to a private address reaches the same places a private
/// literal would, and is how the literal block is walked around.
///
/// This is a check *before* the request rather than a guarantee about it —
/// `fetch` resolves the name again itself, so a record that changes between the
/// two still gets through. Closing that needs a connection-level hook, which
/// undici does not expose without replacing the dispatcher; this raises the cost
/// of the attack from trivial to a timing race, and the allowlist of content
/// types plus the byte cap bound what comes back either way.
async function resolvesPublicly(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIpLiteral(host)) return !isBlockedAddress(host);

  try {
    const addresses = await lookup(host, { all: true });
    return addresses.length > 0 && !addresses.some(({ address }) => isBlockedAddress(address));
  } catch {
    return false;
  }
}

/// Read with the cap applied as the body arrives rather than after. A
/// `content-length` is a claim, and an origin that lies about it — or omits it —
/// would otherwise be allowed to fill the function's memory.
async function readCapped(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader();
  if (!reader) throw new RemoteImageError("unreachable");

  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > REMOTE_IMAGE_BYTE_LIMIT) {
      await reader.cancel();
      throw new RemoteImageError("too-large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/// Redirects are followed by hand so every hop is checked. `redirect: "follow"`
/// would have already made the request to wherever the chain ended — including
/// straight at a metadata service — before anything here could look at it.
export async function fetchRemoteImage(
  target: URL,
): Promise<{ contentType: UploadContentType; bytes: Uint8Array<ArrayBuffer> }> {
  let url = target;

  for (let hop = 0; hop <= REMOTE_IMAGE_MAX_REDIRECTS; hop += 1) {
    if (!(await resolvesPublicly(url))) throw new RemoteImageError("blocked");

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        /// No cookies, no referrer: this is our server fetching on a user's
        /// behalf, not the user's browser, and anything the origin would
        /// personalise is not something we should be carrying.
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { accept: "image/*" },
        signal: AbortSignal.timeout(REMOTE_IMAGE_TIMEOUT_MS),
      });
    } catch {
      throw new RemoteImageError("unreachable");
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      void response.body?.cancel();
      const location = response.headers.get("location");
      let next: URL | null = null;
      try {
        next = location ? importableUrl(new URL(location, url).toString()) : null;
      } catch {
        next = null;
      }
      if (!next) throw new RemoteImageError("blocked");
      url = next;
      continue;
    }

    if (!response.ok) {
      void response.body?.cancel();
      throw new RemoteImageError("unreachable");
    }

    const contentType = importableContentType(response.headers.get("content-type"));
    if (!contentType) {
      void response.body?.cancel();
      /// An SVG, a HEIC, or an HTML error page served with a 200 — the same
      /// answer either way: not something this project can hold.
      throw new RemoteImageError("unsupported-type");
    }

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > REMOTE_IMAGE_BYTE_LIMIT) {
      void response.body?.cancel();
      throw new RemoteImageError("too-large");
    }

    return { contentType, bytes: await readCapped(response) };
  }

  throw new RemoteImageError("unreachable");
}
