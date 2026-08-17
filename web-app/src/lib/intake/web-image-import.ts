/// An image arriving from another web page — Pinterest, Are.na, Behance, a
/// Google image search — by either of the two routes a browser offers: dragged
/// onto the board, or copied there and pasted. It is how a moodboard is actually
/// built, and it is the one route onto the canvas that neither the sidebar drag
/// nor adoption covers: what the browser hands over is a *URL*, never bytes.
///
/// Left alone, neither route works. Excalidraw reads a dropped URL as an
/// embeddable and — for anything that is not one of the handful of providers it
/// recognises — does nothing at all; a pasted image URL it does try to fetch,
/// but from the browser, where a cross-origin image CDN answers without
/// `Access-Control-Allow-Origin` and the paste ends as "failed to fetch image".
/// So both are taken over here and fetched by the server instead.
///
/// No DOM here: a drag is three strings and a paste is two, and what comes out
/// is the URLs worth fetching.

export const WEB_IMAGE_MIMES = {
  html: "text/html",
  uriList: "text/uri-list",
  plain: "text/plain",
} as const;

export type WebImageDrag = {
  html?: string | null;
  uriList?: string | null;
  plain?: string | null;
};

/// A URL whose path already says "image". Only the *fallback* readings need it:
/// `text/uri-list` on a drag from a page is whatever the browser thought was
/// being dragged, which for an image wrapped in a link is the link. Requiring an
/// image extension there is what keeps a dragged article link from being fetched
/// as a photo, while a real image URL still lands.
const IMAGE_URL_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif"]);

/// Matched rather than parsed: this runs where there is no DOM (and must stay
/// testable without one), and the payload is a fragment the browser built around
/// the element being dragged, not a document.
///
/// The whitespace before `src` is load-bearing, not tidiness: `\bsrc` also
/// matches inside `data-src`, and lazy-loading markup puts a placeholder there —
/// so without it the fragment's real image URL loses to a 1px spacer.
const HTML_IMG_SRC = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/i;

/// Only the entities a URL in an HTML attribute can actually carry. A full
/// entity table would be a second HTML parser for the sake of query strings,
/// which is where `&amp;` comes from and where it stops.
function decodeAttribute(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

/// http(s) and absolute, because the fetch happens on the server and a relative
/// or `data:`/`blob:` src means nothing there — a `blob:` URL in particular is
/// scoped to the page that made it and is unreadable anywhere else.
function absoluteHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
}

function looksLikeImageUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  const extension = url.pathname.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_URL_EXTENSIONS.has(extension);
}

/// `text/uri-list` is a line list where `#` starts a comment, and browsers do
/// write more than one line into it.
function uriListEntries(uriList: string): string[] {
  return uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/// The image URL a cross-window drag is about, or null to leave the drop to
/// excalidraw.
///
/// `text/html` is read first and trusted without an extension check: the browser
/// only writes an `<img>` fragment when an image element is what was dragged, so
/// the src is an image however the CDN chose to name it — and most do not name
/// it anything at all. Everything else is a guess, and a guess is only taken
/// when the URL itself says image.
export function webImageDragUrl(drag: WebImageDrag): string | null {
  const html = drag.html?.trim();
  if (html) {
    const match = HTML_IMG_SRC.exec(html);
    const src = match?.[1] ?? match?.[2] ?? match?.[3];
    if (src) {
      const url = absoluteHttpUrl(decodeAttribute(src));
      if (url) return url;
    }
  }

  const candidates = [
    ...uriListEntries(drag.uriList ?? ""),
    ...(drag.plain ? [drag.plain] : []),
  ];
  for (const candidate of candidates) {
    const url = absoluteHttpUrl(candidate);
    if (url && looksLikeImageUrl(url)) return url;
  }

  return null;
}

/// Read during `dragover`, where the payload is deliberately unreadable and only
/// the type list is visible — so the question there is the weaker "could this be
/// one", answered again for real at drop.
///
/// A drag carrying `Files` is a desktop file drop: those already reach the board
/// with their bytes, and excalidraw's own handler plus adoption is the shorter
/// path for them.
export function carriesWebImageDrag(types: readonly string[] | undefined): boolean {
  if (!types || types.includes("Files")) return false;
  return Object.values(WEB_IMAGE_MIMES).some((mime) => types.includes(mime));
}

export type WebImagePaste = {
  html?: string | null;
  text?: string | null;
};

const HTML_IMG_SRC_ALL = new RegExp(HTML_IMG_SRC.source, "gi");

/// Everything that is markup rather than words, including the two element
/// bodies that are markup *inside* the text — a `<style>` block copied along
/// with the fragment is not something the user pasted.
const HTML_MARKUP = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>|<!--[\s\S]*?-->|<[^>]*>/gi;

/// Whether the fragment carries words as well as pictures. A copy of an image
/// alone is an `<img>` wrapped in the browser's own boilerplate, which leaves
/// nothing behind once the tags are gone; a copy of part of an article leaves
/// its sentences.
function htmlCarriesText(html: string): boolean {
  return html.replace(HTML_MARKUP, " ").replace(/&nbsp;/gi, " ").trim().length > 0;
}

function unique(urls: readonly string[]): string[] {
  return [...new Set(urls)];
}

/// The images a paste is about, or nothing — which leaves the paste to
/// excalidraw.
///
/// A paste is a drag with one difference that matters: what is on the clipboard
/// is as often *part of a page* as it is a picture. So an `<img>` fragment is
/// only ours when the fragment is images and nothing else — a copied region with
/// sentences in it still goes to excalidraw, which turns those sentences into
/// text elements, and taking it over would silently drop them.
///
/// Plain text is read the way the drag reads its uri-list: taken only when the
/// URL itself says image, and only when every line does. A note with a link in
/// it is a note, and an excalidraw scene on the clipboard is JSON.
export function pastedImageUrls(paste: WebImagePaste): string[] {
  const html = paste.html?.trim();
  if (html) {
    if (htmlCarriesText(html)) return [];
    /// Every `<img>` in the fragment, not the first: a copied contact sheet is a
    /// batch, and the board lays a batch out as a grid. A src the server could
    /// never fetch — `data:`, `blob:`, relative — drops out here.
    return unique(
      [...html.matchAll(HTML_IMG_SRC_ALL)].flatMap((match) => {
        const src = match[1] ?? match[2] ?? match[3];
        const url = src ? absoluteHttpUrl(decodeAttribute(src)) : null;
        return url ? [url] : [];
      }),
    );
  }

  const lines = (paste.text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const urls: string[] = [];
  for (const line of lines) {
    const url = absoluteHttpUrl(line);
    if (!url || !looksLikeImageUrl(url)) return [];
    urls.push(url);
  }

  return unique(urls);
}
