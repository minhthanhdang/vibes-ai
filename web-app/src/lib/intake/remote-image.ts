import { isUploadContentType, type UploadContentType } from "@/lib/intake/image-types";

/// Fetching an image the director dragged in off a web page is the one place
/// this app makes a request to an address a *user* chose, so the rules for which
/// addresses those may be live here, away from the fetch and testable without a
/// network.
///
/// The thing being guarded against is not a bad photo. It is that our server
/// sits inside a network with things in it that answer to no one on the public
/// internet — a metadata service, a database, another service's health endpoint
/// — and "fetch this URL for me" is a request to reach them from the inside.

/// Enough for a print-resolution photo off a portfolio site, far under what a
/// function can hold in memory while it hashes and re-uploads it.
export const REMOTE_IMAGE_BYTE_LIMIT = 20_000_000;

/// Shorteners and CDN indirection are normal; a chain longer than this is a
/// redirector being used as one, and every extra hop is another address to
/// check.
export const REMOTE_IMAGE_MAX_REDIRECTS = 3;

/// A slow origin should not hold a function open until its own timeout.
export const REMOTE_IMAGE_TIMEOUT_MS = 15_000;

/// Signed CDN URLs are long; past this a "URL" is a payload wearing one.
export const REMOTE_IMAGE_URL_LIMIT = 4096;

/// A saved-from-the-web image has no filename worth inheriting — the last path
/// segment of a CDN URL is a hash — and an untitled tile appearing in the
/// gallery reads as something having gone wrong.
export const IMPORTED_IMAGE_TITLE = "Saved from the web";

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/// Names that resolve inside a network rather than on the internet. `.local` is
/// mDNS, `.internal` is what cloud DNS zones are called, and `localhost` is
/// itself — none of them are ever a photo.
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function ipv4Octets(host: string): number[] | null {
  const match = IPV4.exec(host);
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

/// Every range that is not a public host, by the block that defines it: this
/// host, private use, loopback, link-local (which is where cloud metadata
/// lives), carrier NAT, protocol assignments, benchmarking, multicast and
/// reserved.
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

/// The eight 16-bit groups of an IPv6 address, or null if it is not one. Written
/// out rather than pattern-matched on the text because `new URL` rewrites what
/// it is given — `[::ffff:169.254.169.254]` comes back as `[::ffff:a9fe:a9fe]`,
/// and a check that looked for the dotted tail would pass it straight through.
function ipv6Groups(host: string): number[] | null {
  if (!host.includes(":")) return null;

  const [head = "", tail, extra] = host.split("::");
  if (extra !== undefined) return null;

  const parse = (part: string) => (part ? part.split(":") : []);
  const leading = parse(head);
  const trailing = tail === undefined ? [] : parse(tail);

  /// A trailing dotted quad (`::ffff:1.2.3.4`) is two groups written in v4.
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

/// True for anything that is not a routable public address. An unparseable
/// string reads as blocked rather than as allowed: this decides whether to make
/// a request, so not understanding the answer has to mean no.
export function isBlockedAddress(address: string): boolean {
  const host = address.trim().replace(/^\[|\]$/g, "").split("%")[0]?.toLowerCase() ?? "";
  if (!host) return true;

  const octets = ipv4Octets(host);
  if (octets) return isBlockedIpv4(octets);

  const groups = ipv6Groups(host);
  if (!groups) return true;

  const [g0 = 0] = groups;
  const prefixIsZero = groups.slice(0, 5).every((group) => group === 0);
  /// IPv4-mapped (`::ffff:a.b.c.d`) and IPv4-compatible (`::a.b.c.d`) are the
  /// same v4 addresses wearing a v6 hat, and are how the v4 block above is
  /// walked around if they are not unwrapped.
  if (prefixIsZero && (groups[5] === 0xffff || groups[5] === 0)) {
    const embedded = [groups[6] ?? 0, groups[7] ?? 0].flatMap((group) => [group >> 8, group & 0xff]);
    /// `::` and `::1` are unspecified and loopback, which `isBlockedIpv4` also
    /// answers for — 0.0.0.0 and 0.0.0.1 are both in 0.0.0.0/8.
    return isBlockedIpv4(embedded);
  }

  /// fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast.
  if ((g0 & 0xfe00) === 0xfc00) return true;
  if ((g0 & 0xffc0) === 0xfe80) return true;
  return (g0 & 0xff00) === 0xff00;
}

export function isIpLiteral(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "");
  return ipv4Octets(bare) !== null || bare.includes(":");
}

/// The URL if it is one this server may fetch, null otherwise. Used both on the
/// way in and on every redirect hop, because a public URL that redirects to
/// `169.254.169.254` is the whole attack and the first check would have passed.
///
/// Credentials in the URL are refused rather than stripped: they are not
/// something a dragged image carries, and forwarding them is handing a third
/// party whatever they were for.
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
  /// A single-label name ("intranet") only resolves through a search domain,
  /// which is by definition an internal one.
  if (!host.includes(".")) return null;

  return url;
}

/// The upload type a response's `content-type` names, or null when the project
/// cannot hold it. The header carries parameters (`; charset=`), and servers
/// disagree about case.
export function importableContentType(header: string | null | undefined): UploadContentType | null {
  const type = header?.split(";")[0]?.trim().toLowerCase() ?? "";
  return isUploadContentType(type) ? type : null;
}

/// Why an import did not happen, in the director's terms. The board's banner and
/// the procedure's error message are the two ends of this: the reason crosses
/// the wire as the message, so a reason renamed on one side without the other
/// fails here rather than showing "something went wrong" for a file that is
/// simply too big.
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
