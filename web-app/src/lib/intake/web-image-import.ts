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

const IMAGE_URL_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif"]);

const HTML_IMG_SRC = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/i;

function decodeAttribute(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

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

function uriListEntries(uriList: string): string[] {
  return uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

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

export function carriesWebImageDrag(types: readonly string[] | undefined): boolean {
  if (!types || types.includes("Files")) return false;
  return Object.values(WEB_IMAGE_MIMES).some((mime) => types.includes(mime));
}

export type WebImagePaste = {
  html?: string | null;
  text?: string | null;
};

const HTML_IMG_SRC_ALL = new RegExp(HTML_IMG_SRC.source, "gi");

const HTML_MARKUP = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>|<!--[\s\S]*?-->|<[^>]*>/gi;

function htmlCarriesText(html: string): boolean {
  return html.replace(HTML_MARKUP, " ").replace(/&nbsp;/gi, " ").trim().length > 0;
}

function unique(urls: readonly string[]): string[] {
  return [...new Set(urls)];
}

export function pastedImageUrls(paste: WebImagePaste): string[] {
  const html = paste.html?.trim();
  if (html) {
    if (htmlCarriesText(html)) return [];
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
