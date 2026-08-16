import { test } from "node:test";
import assert from "node:assert/strict";

import {
  importableContentType,
  importableUrl,
  isBlockedAddress,
  isIpLiteral,
  remoteImageFailureMessage,
  REMOTE_IMAGE_BYTE_LIMIT,
} from "./remote-image";

test("a public image URL is importable", () => {
  const url = importableUrl("https://cdn.example.com/photo.jpg?w=1200");
  assert.equal(url?.toString(), "https://cdn.example.com/photo.jpg?w=1200");
  assert.equal(importableUrl("  http://images.example.com/a.png  ")?.hostname, "images.example.com");
});

test("only http(s), and never with credentials attached", () => {
  for (const raw of [
    "ftp://example.com/a.jpg",
    "file:///etc/passwd",
    "gopher://example.com/",
    "data:image/png;base64,iVBORw0KGgo=",
    "https://user:pass@example.com/a.jpg",
    "https://user@example.com/a.jpg",
    "not a url",
    "",
  ]) {
    assert.equal(importableUrl(raw), null, raw);
  }
  assert.equal(importableUrl(undefined), null);
  assert.equal(importableUrl(42), null);
});

test("the addresses a request must never be made to", () => {
  for (const raw of [
    "http://localhost/a.jpg",
    "http://LOCALHOST:8080/a.jpg",
    "http://app.localhost/a.jpg",
    "http://printer.local/a.jpg",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://intranet/a.jpg",
    "http://127.0.0.1/a.jpg",
    "http://127.9.9.9/a.jpg",
    "http://0.0.0.0/a.jpg",
    "http://10.1.2.3/a.jpg",
    "http://172.16.0.1/a.jpg",
    "http://172.31.255.254/a.jpg",
    "http://192.168.1.1/a.jpg",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.100.100.200/a.jpg",
    "http://[::1]/a.jpg",
    "http://[fd00::1]/a.jpg",
    "http://[fe80::1]/a.jpg",
    "http://[::ffff:169.254.169.254]/a.jpg",
  ]) {
    assert.equal(importableUrl(raw), null, raw);
  }
});

test("a public IP literal and a hostname that merely looks internal are allowed", () => {
  assert.equal(importableUrl("http://93.184.216.34/a.jpg")?.hostname, "93.184.216.34");
  assert.equal(importableUrl("http://172.32.0.1/a.jpg")?.hostname, "172.32.0.1");
  assert.equal(importableUrl("https://local.example.com/a.jpg")?.hostname, "local.example.com");
});

test("an unparseable address reads as blocked — not understanding it has to mean no", () => {
  assert.equal(isBlockedAddress(""), true);
  assert.equal(isBlockedAddress("nonsense"), true);
  assert.equal(isBlockedAddress("999.1.1.1"), true);
  assert.equal(isBlockedAddress("8.8.8.8"), false);
  assert.equal(isBlockedAddress("[2606:4700::1111]"), false);
  assert.equal(isBlockedAddress("fe80::1%eth0"), true);
});

test("an ip literal is told from a hostname, since only the latter needs DNS", () => {
  assert.equal(isIpLiteral("93.184.216.34"), true);
  assert.equal(isIpLiteral("[2606:4700::1111]"), true);
  assert.equal(isIpLiteral("cdn.example.com"), false);
});

test("the content type is read past its parameters and its case", () => {
  assert.equal(importableContentType("image/jpeg"), "image/jpeg");
  assert.equal(importableContentType("IMAGE/PNG; charset=binary"), "image/png");
  assert.equal(importableContentType(" image/webp "), "image/webp");
  assert.equal(importableContentType("image/svg+xml"), null);
  assert.equal(importableContentType("text/html; charset=utf-8"), null);
  assert.equal(importableContentType(null), null);
  assert.equal(importableContentType(undefined), null);
});

test("every failure the procedure can raise has a line of its own", () => {
  const messages = ["blocked", "unreachable", "unsupported-type", "too-large"].map(
    remoteImageFailureMessage,
  );
  assert.equal(new Set(messages).size, messages.length);

  const generic = remoteImageFailureMessage("INTERNAL_SERVER_ERROR");
  assert.ok(!messages.includes(generic));
  assert.equal(remoteImageFailureMessage(null), generic);
});

test("the byte cap is under what a serverless function can hold", () => {
  assert.ok(REMOTE_IMAGE_BYTE_LIMIT <= 32_000_000);
});
