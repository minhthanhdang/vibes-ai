import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defaultWeightOf,
  fallbackOfCategory,
  googleFamiliesOf,
  googleFontInt,
  nearestFamilyName,
  variantOf,
  variantsSentence,
  type GoogleFamily,
  type GoogleFontRef,
} from "@/lib/render/font-google";
import { measureSet, setsLatin } from "@/lib/render/font-measure";
import { FONT_NAMES } from "@/lib/canvas-objects/object-style";

const CACHE_DIR = join(tmpdir(), "google-fonts");
const METADATA_URL = "https://fonts.google.com/metadata/fonts";
const METADATA_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

export type ResolvedGoogleFont = {
  int: number;
  font: GoogleFontRef;
  ttfPath: string;
};

export type GoogleFontRefusal = { refusal: string };

export type GoogleFontResolution = ResolvedGoogleFont | GoogleFontRefusal;

const CLASSIC_STAND = `the classic names (${FONT_NAMES.join(", ")}) still stand`;

const UNREACHABLE = `the font library could not be reached — ${CLASSIC_STAND}, and every face already on the board keeps drawing`;

async function fetchWithin(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

let familiesPromise: Promise<Map<string, GoogleFamily>> | null = null;

async function loadFamilies(): Promise<Map<string, GoogleFamily>> {
  const cachePath = join(CACHE_DIR, "metadata.json");
  const cached = await stat(cachePath).catch(() => null);
  if (cached && Date.now() - cached.mtimeMs < METADATA_TTL_MS) {
    try {
      return parseFamilies(await readFile(cachePath, "utf8"));
    } catch {
    }
  }

  const response = await fetchWithin(METADATA_URL);
  if (!response.ok) throw new Error(`metadata answered ${response.status}`);
  const body = await response.text();
  const families = parseFamilies(body);
  if (families.size === 0) throw new Error("metadata parsed to no families");
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath, body).catch(() => undefined);
  return families;
}

function parseFamilies(body: string): Map<string, GoogleFamily> {
  return googleFamiliesOf(JSON.parse(body.replace(/^\)\]\}'/, "")) as unknown);
}

function familiesOnce(): Promise<Map<string, GoogleFamily>> {
  familiesPromise ??= loadFamilies().catch((cause: unknown) => {
    familiesPromise = null;
    throw cause;
  });
  return familiesPromise;
}

const ttfPromises = new Map<string, Promise<string>>();

function ttfCachePath(family: string, weight: number, italic: boolean): string {
  const digest = createHash("sha256").update(`${family}|${weight}|${italic}`).digest("hex");
  return join(CACHE_DIR, `${digest}.ttf`);
}

async function downloadTtf(family: string, weight: number, italic: boolean): Promise<string> {
  const path = ttfCachePath(family, weight, italic);
  if (await stat(path).catch(() => null)) return path;

  const query = `family=${encodeURIComponent(family).replace(/%20/g, "+")}:ital,wght@${italic ? 1 : 0},${weight}`;
  const css = await fetchWithin(`https://fonts.googleapis.com/css2?${query}`);
  if (!css.ok) throw new Error(`css2 answered ${css.status}`);
  const url = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(await css.text())?.[1];
  if (!url) throw new Error("css2 answered with no font url");

  const font = await fetchWithin(url);
  if (!font.ok) throw new Error(`the font file answered ${font.status}`);
  const bytes = Buffer.from(await font.arrayBuffer());

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path, bytes);
  return path;
}

function ttfOnce(family: string, weight: number, italic: boolean): Promise<string> {
  const key = `${family}|${weight}|${italic}`;
  let pending = ttfPromises.get(key);
  if (!pending) {
    pending = downloadTtf(family, weight, italic).catch((cause: unknown) => {
      ttfPromises.delete(key);
      throw cause;
    });
    ttfPromises.set(key, pending);
  }
  return pending;
}

const metricPromises = new Map<string, Promise<GoogleFontRef["set"]>>();

function metricOnce(family: string, weight: number, italic: boolean, ttfPath: string) {
  const key = `${family}|${weight}|${italic}`;
  let pending = metricPromises.get(key);
  if (!pending) {
    pending = readFile(ttfPath).then((bytes) => measureSet(bytes));
    metricPromises.set(key, pending);
  }
  return pending;
}

export type GoogleFontAsked = {
  family: string;
  weight?: number;
  italic?: boolean;
};

export async function resolveGoogleFont(asked: GoogleFontAsked): Promise<GoogleFontResolution> {
  const name = asked.family.trim();
  const italic = asked.italic ?? false;

  let families: Map<string, GoogleFamily>;
  try {
    families = await familiesOnce();
  } catch {
    return { refusal: UNREACHABLE };
  }

  const family = families.get(name.toLowerCase());
  if (!family) {
    const nearest = nearestFamilyName(name, families.values());
    return {
      refusal:
        `there is no Google Fonts family called ${JSON.stringify(name)}` +
        (nearest ? ` — the nearest name is ${JSON.stringify(nearest)}` : "") +
        ` (${CLASSIC_STAND})`,
    };
  }
  if (!family.latin) {
    return {
      refusal: `${family.family} sets no Latin text — pick a family that carries the latin subset`,
    };
  }

  const weight = asked.weight ?? defaultWeightOf(family, italic);
  const cut = weight === null ? null : variantOf(family, weight, italic);
  if (!cut) {
    return {
      refusal:
        weight === null
          ? `${family.family} has no ${italic ? "italic" : "roman"} cuts at all — it comes in ${variantsSentence(family)}`
          : `${family.family} is not cut in ${weight}${italic ? " italic" : ""} — it comes in ${variantsSentence(family)}`,
    };
  }

  try {
    const ttfPath = await ttfOnce(family.family, cut.weight, cut.italic);
    const set = await metricOnce(family.family, cut.weight, cut.italic, ttfPath);
    return {
      int: googleFontInt(family.family, cut.weight, cut.italic),
      font: {
        family: family.family,
        weight: cut.weight,
        italic: cut.italic,
        set,
        fallback: fallbackOfCategory(family.category),
      },
      ttfPath,
    };
  } catch {
    return { refusal: UNREACHABLE };
  }
}

export async function googleFontFile(font: {
  family: string;
  weight: number;
  italic: boolean;
}): Promise<string | null> {
  try {
    const path = await ttfOnce(font.family, font.weight, font.italic);
    return path;
  } catch {
    return null;
  }
}

export { setsLatin };
