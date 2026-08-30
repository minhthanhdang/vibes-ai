import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_VALIDATION = "1";
process.env.GCS_BUCKET = "test-bucket";

const { forDisplaySigned, manyForDisplaySigned } = await import("./display-signed");
const { forDisplay } = await import("./display");

function signer() {
  const asked: string[] = [];
  const urls = new Map<string, string>();
  const sign = async (gcsUri: string) => {
    asked.push(gcsUri);
    let url = urls.get(gcsUri);
    if (!url) {
      url = `https://signed.test/${urls.size + 1}`;
      urls.set(gcsUri, url);
    }
    return url;
  };
  return { asked, urls, sign };
}

const original = {
  id: "r1",
  title: "A title",
  width: 4000,
  height: 2000,
  gcsUri: "gs://test-bucket/projects/p1/references/a.png",
  thumbGcsUri: "gs://test-bucket/projects/p1/references/a-thumb.jpg",
};

test("the signed shape carries the same fields the routed shape does", async () => {
  const { sign } = signer();
  const signed = await forDisplaySigned(original, sign);
  const routed = forDisplay(original);

  assert.deepEqual(Object.keys(signed).sort(), Object.keys(routed).sort());
  assert.equal(signed.hasThumbnail, routed.hasThumbnail);
  assert.equal(signed.title, original.title);
});

test("displayUrl and thumbUrl are the signed objects, not app routes", async () => {
  const { sign, urls } = signer();
  const signed = await forDisplaySigned(original, sign);

  assert.equal(signed.displayUrl, urls.get(original.gcsUri));
  assert.equal(signed.thumbUrl, urls.get(original.thumbGcsUri));
  assert.equal(signed.hasThumbnail, true);
});

test("no locator leaks into what goes over the wire", async () => {
  const { sign } = signer();
  const signed = await manyForDisplaySigned([original, { ...original, id: "r2" }], sign);
  assert.ok(!JSON.stringify(signed).includes("gs://"));
});

test("a reference with no thumbnail falls back to its signed original", async () => {
  const { sign } = signer();
  const bare = { ...original, thumbGcsUri: null };
  const signed = await forDisplaySigned(bare, sign);

  assert.equal(signed.thumbUrl, signed.displayUrl);
  assert.equal(signed.hasThumbnail, false);
});

test("each object is signed once however many rows share it", async () => {
  const { sign, asked } = signer();
  const rows = [
    original,
    { ...original, id: "r2", thumbGcsUri: null },
    { ...original, id: "r3" },
  ];

  const signed = await manyForDisplaySigned(rows, sign);
  assert.equal(signed.length, 3);
  assert.equal(asked.length, 2);
  assert.deepEqual([...new Set(asked)].sort(), [original.gcsUri, original.thumbGcsUri].sort());
});
