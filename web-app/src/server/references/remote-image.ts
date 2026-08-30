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

export class RemoteImageError extends Error {
  constructor(readonly reason: RemoteImageFailure) {
    super(reason);
    this.name = "RemoteImageError";
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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
