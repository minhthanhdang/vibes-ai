import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.GOOGLE_CLOUD_PROJECT = "test-project";
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "{}";

const { THROTTLE_RETRIES, apiHost, client, throttleRetried } = await import(
  "@/server/google/vertex"
);

const hostAt = (location: string) => {
  process.env.GOOGLE_CLOUD_LOCATION = location;
  return apiHost();
};

test("a region is served from its own subdomain, and `global` from the bare host", () => {
  const global = hostAt("global");
  const region = hostAt("us-central1");

  assert.notEqual(region, global);
  assert.equal(region, global.replace("https://", "https://us-central1-"));
});

test("every region gets its own, so the prefix is the location and not a constant", () => {
  assert.equal(hostAt("europe-west4"), hostAt("global").replace("https://", "https://europe-west4-"));
});

async function attemptsUnderDefaultBudget(throwing: () => unknown) {
  const slept = globalThis.setTimeout;
  globalThis.setTimeout = ((run: () => void) => slept(run, 0)) as typeof setTimeout;
  let attempts = 0;
  try {
    await throttleRetried(async () => {
      attempts += 1;
      throw throwing();
    });
  } catch {
  } finally {
    globalThis.setTimeout = slept;
  }
  return attempts;
}

const throttling404 = () =>
  Object.assign(new Error(JSON.stringify({ error: { message: "<!DOCTYPE html>", code: 404 } })), {
    name: "ApiError",
    status: 404,
  });

test("a caller that names no budget gets THROTTLE_RETRIES asks after the first", async () => {
  assert.equal(await attemptsUnderDefaultBudget(throttling404), THROTTLE_RETRIES + 1);
});

test("the budget is four, which is the number `image-generator.ts` tells the user about", () => {
  assert.equal(THROTTLE_RETRIES, 4);
});

test("no retry loop writes its budget as a literal — all name the one constant", async () => {
  const source = await readFile(new URL("./vertex.ts", import.meta.url), "utf8");

  assert.equal(source.match(/retries = THROTTLE_RETRIES\b/g)?.length, 3);
  assert.match(source, /retries = /);
  assert.doesNotMatch(source, /retries = (?!THROTTLE_RETRIES\b)/);
});

test("a failure the loop does not own is not asked again on the default budget either", async () => {
  const attempts = await attemptsUnderDefaultBudget(() => new TypeError("fetch failed"));

  assert.equal(attempts, 1);
});

test("the process holds one client, because a client per call is a token per call", () => {
  const said = console.debug;
  console.debug = () => {};
  try {
    assert.equal(client(), client());
  } finally {
    console.debug = said;
  }
});
