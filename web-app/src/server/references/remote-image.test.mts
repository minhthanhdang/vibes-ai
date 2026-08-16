import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { fetchRemoteImage, RemoteImageError } from "./remote-image";
import { REMOTE_IMAGE_BYTE_LIMIT, REMOTE_IMAGE_MAX_REDIRECTS } from "@/lib/remote-image";

/// Public IP literals throughout: `fetchRemoteImage` only reaches for DNS when
/// the host is a name, so a literal keeps the test off the network entirely
/// while still going through the same address check a real host would.
const PUBLIC = "http://93.184.216.34";
const METADATA = "http://169.254.169.254";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function respondWith(route: (url: string) => Response) {
  const requested: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = input.toString();
    requested.push(url);
    return Promise.resolve(route(url));
  }) as typeof fetch;
  return requested;
}

function image(bytes: number, contentType = "image/png") {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": contentType, "content-length": String(bytes) },
  });
}

function redirectTo(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
    return null;
  } catch (error) {
    assert.ok(error instanceof RemoteImageError, `${String(error)} is not a RemoteImageError`);
    return error.reason;
  }
}

test("an image response comes back with its bytes and allowlisted type", async () => {
  respondWith(() => image(64, "image/JPEG; charset=binary"));
  const result = await fetchRemoteImage(new URL(`${PUBLIC}/photo`));
  assert.equal(result.contentType, "image/jpeg");
  assert.equal(result.bytes.length, 64);
});

test("redirects are followed one hop at a time, and each hop is a fresh request", async () => {
  const requested = respondWith((url) =>
    url.endsWith("/final.png") ? image(8) : redirectTo(`${PUBLIC}/final.png`),
  );
  const result = await fetchRemoteImage(new URL(`${PUBLIC}/go`));
  assert.equal(result.bytes.length, 8);
  assert.deepEqual(requested, [`${PUBLIC}/go`, `${PUBLIC}/final.png`]);
});

test("a redirect into the private network is refused — the whole point of hop-by-hop", async () => {
  const requested = respondWith((url) =>
    url.startsWith(PUBLIC) ? redirectTo(`${METADATA}/latest/meta-data/`) : image(8),
  );
  assert.equal(await failureOf(fetchRemoteImage(new URL(`${PUBLIC}/go`))), "blocked");
  /// The blocked address was never requested, which is what `redirect: "manual"`
  /// buys over letting fetch follow the chain itself.
  assert.deepEqual(requested, [`${PUBLIC}/go`]);
});

test("a relative Location is resolved against the hop it came from", async () => {
  const requested = respondWith((url) =>
    url.endsWith("/deep/final.png") ? image(4) : redirectTo("final.png"),
  );
  await fetchRemoteImage(new URL(`${PUBLIC}/deep/start`));
  assert.deepEqual(requested, [`${PUBLIC}/deep/start`, `${PUBLIC}/deep/final.png`]);
});

test("a redirect loop ends rather than running forever", async () => {
  const requested = respondWith(() => redirectTo(`${PUBLIC}/round`));
  assert.equal(await failureOf(fetchRemoteImage(new URL(`${PUBLIC}/round`))), "unreachable");
  assert.equal(requested.length, REMOTE_IMAGE_MAX_REDIRECTS + 1);
});

test("a Location that is missing or unfetchable is blocked, not followed", async () => {
  respondWith(() => new Response(null, { status: 302 }));
  assert.equal(await failureOf(fetchRemoteImage(new URL(`${PUBLIC}/go`))), "blocked");

  respondWith(() => redirectTo("file:///etc/passwd"));
  assert.equal(await failureOf(fetchRemoteImage(new URL(`${PUBLIC}/go`))), "blocked");
});

test("an HTML error page served as 200 is an unsupported type, not an image", async () => {
  respondWith(() => image(1000, "text/html; charset=utf-8"));
  assert.equal(await failureOf(fetchRemoteImage(new URL(`${PUBLIC}/gone`))), "unsupported-type");

  respondWith(() => image(1000, "image/svg+xml"));
  assert.equal(await failureOf(fetchRemoteImage(new URL(`${PUBLIC}/logo.svg`))), "unsupported-type");
});

test("a 404 and a connection that never opens are both unreachable", async () => {
  respondWith(() => new Response(null, { status: 404 }));
  assert.equal(await failureOf(fetchRemoteImage(new URL(`${PUBLIC}/gone`))), "unreachable");

  globalThis.fetch = (() => Promise.reject(new Error("ECONNREFUSED"))) as typeof fetch;
  assert.equal(await failureOf(fetchRemoteImage(new URL(`${PUBLIC}/gone`))), "unreachable");
});

test("the cap is applied to the body, not only to the content-length it claimed", async () => {
  respondWith(
    () =>
      new Response(new Uint8Array(REMOTE_IMAGE_BYTE_LIMIT + 1), {
        status: 200,
        /// No content-length and no honesty: the stream is what has to be capped.
        headers: { "content-type": "image/png" },
      }),
  );
  assert.equal(await failureOf(fetchRemoteImage(new URL(`${PUBLIC}/huge.png`))), "too-large");
});

test("a declared content-length past the cap is enough on its own", async () => {
  /// A body well under the cap, so only the header can be what refuses it —
  /// which is the point: an origin that announces a gigabyte should not have
  /// that gigabyte streamed before anyone objects.
  respondWith(
    () =>
      new Response(new Uint8Array(16), {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(REMOTE_IMAGE_BYTE_LIMIT + 1),
        },
      }),
  );
  assert.equal(await failureOf(fetchRemoteImage(new URL(`${PUBLIC}/huge.png`))), "too-large");
});

test("a private literal is never requested at all", async () => {
  const requested = respondWith(() => image(8));
  assert.equal(await failureOf(fetchRemoteImage(new URL(`${METADATA}/latest/`))), "blocked");
  assert.deepEqual(requested, []);
});
