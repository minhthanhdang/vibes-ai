import { isUploadContentType, type UploadContentType } from "@/lib/intake/image-types";

export const REMOTE_IMAGE_BYTE_LIMIT = 20_000_000;

export const REMOTE_IMAGE_MAX_REDIRECTS = 3;

export const REMOTE_IMAGE_TIMEOUT_MS = 15_000;

export const REMOTE_IMAGE_URL_LIMIT = 4096;

export const IMPORTED_IMAGE_TITLE = "Saved from the web";

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function ipv4Octets(host: string): number[] | null {
  const match = IPV4.exec(host);
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

function isBlockedIpv4(octets: readonly number[]): boolean {
  const [a = 0, b = 0] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return a >= 224;
}

function ipv6Groups(host: string): number[] | null {
  if (!host.includes(":")) return null;

  const [head = "", tail, extra] = host.split("::");
  if (extra !== undefined) return null;

  const parse = (part: string) => (part ? part.split(":") : []);
  const leading = parse(head);
  const trailing = tail === undefined ? [] : parse(tail);

  const last = trailing.at(-1) ?? leading.at(-1);
  const dotted = last?.includes(".") ? ipv4Octets(last) : null;
  if (last?.includes(".")) {
    if (!dotted) return null;
    const replacement = [
      ((dotted[0] ?? 0) << 8) | (dotted[1] ?? 0),
      ((dotted[2] ?? 0) << 8) | (dotted[3] ?? 0),
    ].map((group) => group.toString(16));
    (trailing.length ? trailing : leading).splice(-1, 1, ...replacement);
  }

  const groups = [...leading, ...trailing];
  if (groups.length > 8) return null;
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;

  const filled =
    tail === undefined
      ? groups
      : [...leading, ...Array(8 - groups.length).fill("0"), ...trailing];
  if (filled.length !== 8) return null;

  return filled.map((group) => parseInt(group, 16));
}

export function isBlockedAddress(address: string): boolean {
  const host = address.trim().replace(/^\[|\]$/g, "").split("%")[0]?.toLowerCase() ?? "";
  if (!host) return true;

  const octets = ipv4Octets(host);
  if (octets) return isBlockedIpv4(octets);

  const groups = ipv6Groups(host);
  if (!groups) return true;

  const [g0 = 0] = groups;
  const prefixIsZero = groups.slice(0, 5).every((group) => group === 0);
  if (prefixIsZero && (groups[5] === 0xffff || groups[5] === 0)) {
    const embedded = [groups[6] ?? 0, groups[7] ?? 0].flatMap((group) => [group >> 8, group & 0xff]);
    return isBlockedIpv4(embedded);
  }

  if ((g0 & 0xfe00) === 0xfc00) return true;
  if ((g0 & 0xffc0) === 0xfe80) return true;
  return (g0 & 0xff00) === 0xff00;
}

export function isIpLiteral(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "");
  return ipv4Octets(bare) !== null || bare.includes(":");
}

export function importableUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  const host = url.hostname.toLowerCase();
  if (!host) return null;
  if (isIpLiteral(host)) return isBlockedAddress(host) ? null : url;
  if (host === "localhost") return null;
  if (PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
  if (!host.includes(".")) return null;

  return url;
}

export function importableContentType(header: string | null | undefined): UploadContentType | null {
  const type = header?.split(";")[0]?.trim().toLowerCase() ?? "";
  return isUploadContentType(type) ? type : null;
}

const REMOTE_IMAGE_MESSAGES = {
  blocked: "That link is not one this app will fetch.",
  unreachable: "That image could not be downloaded — the site may block saving.",
  "unsupported-type": "That is not an image format this project can hold.",
  "too-large": "That image is too large to save here.",
} as const;

export type RemoteImageFailure = keyof typeof REMOTE_IMAGE_MESSAGES;

export function remoteImageFailureMessage(reason: unknown): string {
  if (typeof reason === "string" && reason in REMOTE_IMAGE_MESSAGES) {
    return REMOTE_IMAGE_MESSAGES[reason as RemoteImageFailure];
  }
  return "That image could not be saved to this project.";
}
