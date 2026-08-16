import assert from "node:assert/strict";
import test, { afterEach, beforeEach, describe } from "node:test";

import { ImageProvider } from "@/generated/prisma/enums";
import { configuredProviders, searchImages } from "@/server/references";
import * as googleCse from "@/server/references/google-cse";
import * as pexels from "@/server/references/pexels";
import { creditLine, imageCandidate } from "@/server/references/types";
import * as unsplash from "@/server/references/unsplash";

/// Payloads trimmed from the shapes each provider documents. They exist so the
/// normalizers are exercised without an API key — the fields asserted below are
/// the ones the licence terms hang on, not just the ones that render.
const UNSPLASH_BODY = {
  total: 2,
  results: [
    {
      id: "abc123",
      description: null,
      alt_description: "a gloomy mansion at dusk",
      width: 4000,
      height: 3000,
      urls: { regular: "https://images.unsplash.com/photo-1?w=1080", small: "https://images.unsplash.com/photo-1?w=400" },
      links: {
        html: "https://unsplash.com/photos/abc123",
        download_location: "https://api.unsplash.com/photos/abc123/download",
      },
      user: { name: "Ada Rivers", links: { html: "https://unsplash.com/@ada" } },
    },
    {
      id: "def456",
      description: "Fog over the estate",
      alt_description: "ignored when description is set",
      width: null,
      height: null,
      urls: { regular: "https://images.unsplash.com/photo-2?w=1080", small: "https://images.unsplash.com/photo-2?w=400" },
      links: { html: "https://unsplash.com/photos/def456?utm_campaign=x" },
      user: { name: "Bo Lane", links: { html: "https://unsplash.com/@bo" } },
    },
  ],
};

const PEXELS_BODY = {
  photos: [
    {
      id: 7788,
      url: "https://www.pexels.com/photo/haunted-house-7788/",
      width: 5000,
      height: 3333,
      alt: "Haunted house",
      photographer: "Cy Vance",
      photographer_url: "https://www.pexels.com/@cy",
      src: {
        large: "https://images.pexels.com/photos/7788/pexels-photo.jpeg?h=650",
        medium: "https://images.pexels.com/photos/7788/pexels-photo.jpeg?h=350",
        tiny: "https://images.pexels.com/photos/7788/pexels-photo.jpeg?h=130",
      },
    },
  ],
};

const CSE_BODY = {
  items: [
    {
      title: "Victorian mansion, 1890",
      link: "https://upload.wikimedia.org/mansion.jpg",
      displayLink: "upload.wikimedia.org",
      image: {
        contextLink: "https://commons.wikimedia.org/wiki/File:Mansion.jpg",
        thumbnailLink: "https://encrypted-tbn0.gstatic.com/images?q=tbn:mansion",
        width: 1600,
        height: 1200,
      },
    },
  ],
};

type Route = { body: unknown; status?: number };

let calls: string[] = [];
let headers: Record<string, string>[] = [];
let realFetch: typeof fetch;

/// Routes by host so a single stub can serve a fan-out over several providers.
function stubFetch(routes: Record<string, Route | Error>) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    headers.push((init?.headers ?? {}) as Record<string, string>);
    const key = Object.keys(routes).find((host) => url.includes(host));
    if (!key) throw new Error(`unstubbed fetch: ${url}`);
    const route = routes[key];
    if (route instanceof Error) throw route;
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function paramsOf(url: string) {
  return new URL(url).searchParams;
}

beforeEach(() => {
  realFetch = globalThis.fetch;
  calls = [];
  headers = [];
  process.env.SKIP_ENV_VALIDATION = "1";
  process.env.UNSPLASH_ACCESS_KEY = "unsplash-key";
  process.env.PEXELS_API_KEY = "pexels-key";
  process.env.GOOGLE_CSE_KEY = "cse-key";
  process.env.GOOGLE_CSE_CX = "cse-cx";
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("unsplash", () => {
  test("normalizes a search response", async () => {
    stubFetch({ "api.unsplash.com": { body: UNSPLASH_BODY } });

    const [first, second] = await unsplash.search({ query: "gloomy mansion", limit: 12 });

    assert.deepEqual(imageCandidate.safeParse(first).success, true);
    assert.equal(first.provider, ImageProvider.UNSPLASH);
    assert.equal(first.providerId, "abc123");
    assert.equal(first.title, "a gloomy mansion at dusk");
    assert.equal(first.imageUrl, UNSPLASH_BODY.results[0].urls.regular);
    assert.equal(first.thumbUrl, UNSPLASH_BODY.results[0].urls.small);
    assert.equal(first.creatorName, "Ada Rivers");
    assert.equal(first.license, "Unsplash License");
    assert.equal(first.licenseUrl, "https://unsplash.com/license");
    assert.equal(first.downloadTrackUrl, "https://api.unsplash.com/photos/abc123/download");
    // description wins over alt_description, and a missing download_location is
    // null rather than undefined so the column stays writable.
    assert.equal(second.title, "Fog over the estate");
    assert.equal(second.downloadTrackUrl, null);
  });

  test("attribution links carry the required utm params", async () => {
    stubFetch({ "api.unsplash.com": { body: UNSPLASH_BODY } });

    const [first, second] = await unsplash.search({ query: "mansion", limit: 12 });

    for (const link of [first.sourceUrl, first.creatorUrl, second.sourceUrl, second.creatorUrl]) {
      const params = paramsOf(link!);
      assert.equal(params.get("utm_source"), "director_assistant");
      assert.equal(params.get("utm_medium"), "referral");
    }
    // The second photo's link already had a query string — the params are
    // appended, not allowed to clobber it with a second `?`.
    assert.equal(paramsOf(second.sourceUrl).get("utm_campaign"), "x");
  });

  test("sends the key, the api version and the safe content filter", async () => {
    stubFetch({ "api.unsplash.com": { body: UNSPLASH_BODY } });

    await unsplash.search({ query: "mansion", limit: 7, orientation: "square" });

    const params = paramsOf(calls[0]);
    assert.equal(params.get("query"), "mansion");
    assert.equal(params.get("per_page"), "7");
    assert.equal(params.get("content_filter"), "high");
    // Unsplash spells the square orientation "squarish".
    assert.equal(params.get("orientation"), "squarish");
    assert.equal(headers[0].Authorization, "Client-ID unsplash-key");
    assert.equal(headers[0]["Accept-Version"], "v1");
  });

  test("throws with the status when the api rejects", async () => {
    stubFetch({ "api.unsplash.com": { body: { errors: ["Rate Limit Exceeded"] }, status: 403 } });

    await assert.rejects(unsplash.search({ query: "mansion", limit: 12 }), /unsplash search failed: 403/);
  });

  test("a failed download ping does not surface to the caller", async () => {
    stubFetch({ "api.unsplash.com": new Error("network down") });

    await unsplash.trackDownload("https://api.unsplash.com/photos/abc123/download");
  });
});

describe("pexels", () => {
  test("normalizes a search response", async () => {
    stubFetch({ "api.pexels.com": { body: PEXELS_BODY } });

    const [photo] = await pexels.search({ query: "haunted house", limit: 12 });

    assert.deepEqual(imageCandidate.safeParse(photo).success, true);
    assert.equal(photo.provider, ImageProvider.PEXELS);
    assert.equal(photo.providerId, "7788");
    assert.equal(photo.sourceUrl, "https://www.pexels.com/photo/haunted-house-7788/");
    assert.equal(photo.imageUrl, PEXELS_BODY.photos[0].src.large);
    assert.equal(photo.creatorName, "Cy Vance");
    assert.equal(photo.creatorUrl, "https://www.pexels.com/@cy");
    assert.equal(photo.license, "Pexels License");
    assert.equal(headers[0].Authorization, "pexels-key");
  });

  test("passes orientation through unchanged", async () => {
    stubFetch({ "api.pexels.com": { body: PEXELS_BODY } });

    await pexels.search({ query: "house", limit: 5, orientation: "square" });

    assert.equal(paramsOf(calls[0]).get("orientation"), "square");
  });
});

describe("google cse", () => {
  test("constrains the search to reusable licences and safe results", async () => {
    stubFetch({ "googleapis.com": { body: CSE_BODY } });

    await googleCse.search({ query: "mansion", limit: 40 });

    const params = paramsOf(calls[0]);
    assert.equal(params.get("searchType"), "image");
    assert.equal(params.get("rights"), "cc_publicdomain|cc_attribute|cc_sharealike");
    assert.equal(params.get("safe"), "active");
    // The endpoint caps a page at 10 whatever we ask for.
    assert.equal(params.get("num"), "10");
  });

  test("an authorless hit is flagged rather than silently uncredited", async () => {
    stubFetch({ "googleapis.com": { body: CSE_BODY } });

    const [hit] = await googleCse.search({ query: "mansion", limit: 10 });

    assert.deepEqual(imageCandidate.safeParse(hit).success, true);
    assert.equal(hit.creatorName, "");
    assert.match(creditLine(hit), /Unknown photographer — verify before use/);
    assert.match(hit.license, /confirm terms at source/);
    assert.equal(hit.sourceUrl, "https://commons.wikimedia.org/wiki/File:Mansion.jpg");
  });
});

describe("searchImages", () => {
  test("interleaves the configured providers instead of draining one", async () => {
    delete process.env.GOOGLE_CSE_KEY;
    stubFetch({
      "api.unsplash.com": { body: UNSPLASH_BODY },
      "api.pexels.com": { body: PEXELS_BODY },
    });

    const results = await searchImages({ query: "mansion", limit: 12 });

    assert.deepEqual(
      results.map((candidate) => candidate.provider),
      [ImageProvider.UNSPLASH, ImageProvider.PEXELS, ImageProvider.UNSPLASH],
    );
  });

  test("drops the same photo reached through two providers", async () => {
    delete process.env.PEXELS_API_KEY;
    // Google CSE indexes Unsplash, so the same file comes back under a
    // different query string.
    stubFetch({
      "api.unsplash.com": { body: UNSPLASH_BODY },
      "googleapis.com": {
        body: { items: [{ ...CSE_BODY.items[0], link: "https://images.unsplash.com/photo-1?w=2400" }] },
      },
    });

    const results = await searchImages({ query: "mansion", limit: 12 });

    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((candidate) => candidate.provider),
      [ImageProvider.UNSPLASH, ImageProvider.UNSPLASH],
    );
  });

  test("honours the limit", async () => {
    delete process.env.GOOGLE_CSE_KEY;
    stubFetch({
      "api.unsplash.com": { body: UNSPLASH_BODY },
      "api.pexels.com": { body: PEXELS_BODY },
    });

    const results = await searchImages({ query: "mansion", limit: 2 });

    assert.equal(results.length, 2);
  });

  test("one provider being down is survivable", async () => {
    delete process.env.GOOGLE_CSE_KEY;
    stubFetch({
      "api.unsplash.com": new Error("unsplash is down"),
      "api.pexels.com": { body: PEXELS_BODY },
    });

    const results = await searchImages({ query: "mansion", limit: 12 });

    assert.deepEqual(
      results.map((candidate) => candidate.provider),
      [ImageProvider.PEXELS],
    );
  });

  test("every provider being down raises the first error, not an empty list", async () => {
    delete process.env.PEXELS_API_KEY;
    delete process.env.GOOGLE_CSE_KEY;
    stubFetch({ "api.unsplash.com": new Error("unsplash is down") });

    await assert.rejects(searchImages({ query: "mansion", limit: 12 }), /unsplash is down/);
  });

  test("no configured provider names the keys that are missing", async () => {
    delete process.env.UNSPLASH_ACCESS_KEY;
    delete process.env.PEXELS_API_KEY;
    delete process.env.GOOGLE_CSE_KEY;
    delete process.env.GOOGLE_CSE_CX;

    assert.equal(configuredProviders(), 0);
    await assert.rejects(
      searchImages({ query: "mansion", limit: 12 }),
      /UNSPLASH_ACCESS_KEY, PEXELS_API_KEY, or GOOGLE_CSE_KEY \+ GOOGLE_CSE_CX/,
    );
  });

  test("google cse needs both halves of its config to count as available", async () => {
    delete process.env.UNSPLASH_ACCESS_KEY;
    delete process.env.PEXELS_API_KEY;
    delete process.env.GOOGLE_CSE_CX;

    assert.equal(configuredProviders(), 0);
  });
});

describe("creditLine", () => {
  test("names the photographer and the platform", () => {
    assert.equal(
      creditLine({ creatorName: "Ada Rivers", provider: ImageProvider.UNSPLASH }),
      "Photo by Ada Rivers on Unsplash",
    );
    assert.equal(
      creditLine({ creatorName: "Cy Vance", provider: ImageProvider.PEXELS }),
      "Photo by Cy Vance on Pexels",
    );
  });

  test("an upload credits whoever the row says, with no platform", () => {
    assert.equal(creditLine({ creatorName: "Shot by the director", provider: ImageProvider.UPLOAD }), "Shot by the director");
  });
});
