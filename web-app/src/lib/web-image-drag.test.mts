import { test } from "node:test";
import assert from "node:assert/strict";

import { carriesWebImageDrag, webImageDragUrl, WEB_IMAGE_DRAG_MIMES } from "./web-image-drag";
import { REFERENCE_DRAG_MIME } from "./moodboard-drop";

test("an <img> fragment wins over the uri-list, which is the link it was inside", () => {
  assert.equal(
    webImageDragUrl({
      html: `<meta charset='utf-8'><img src="https://cdn.example.com/564x/abc123" alt="">`,
      uriList: "https://example.com/pin/12345/",
      plain: "https://example.com/pin/12345/",
    }),
    "https://cdn.example.com/564x/abc123",
  );
});

test("an image src is taken without an extension; a bare link needs one", () => {
  assert.equal(
    webImageDragUrl({ html: `<img src='https://images.example.com/photo?w=1200'>` }),
    "https://images.example.com/photo?w=1200",
  );
  assert.equal(webImageDragUrl({ uriList: "https://news.example.com/an-article" }), null);
  assert.equal(
    webImageDragUrl({ uriList: "https://static.example.com/a/b/shot.JPG?v=2" }),
    "https://static.example.com/a/b/shot.JPG?v=2",
  );
});

test("&amp; in an html src is decoded, or the query string is fetched wrong", () => {
  assert.equal(
    webImageDragUrl({ html: `<img src="https://cdn.example.com/i?id=7&amp;size=large">` }),
    "https://cdn.example.com/i?id=7&size=large",
  );
});

test("an unquoted src and extra attributes before it are both read", () => {
  assert.equal(
    webImageDragUrl({ html: `<img class="x" data-src="/nope" src=https://cdn.example.com/p.png >` }),
    "https://cdn.example.com/p.png",
  );
});

test("what the server could never fetch is not offered to it", () => {
  for (const src of [
    "blob:https://example.com/9f0c-4ab1",
    "data:image/png;base64,iVBORw0KGgo=",
    "/relative/photo.jpg",
    "javascript:alert(1)",
  ]) {
    assert.equal(webImageDragUrl({ html: `<img src="${src}">` }), null, src);
  }
});

test("a uri-list's comments and later lines are handled", () => {
  assert.equal(
    webImageDragUrl({ uriList: "# comment\r\nhttps://cdn.example.com/one.webp\r\n" }),
    "https://cdn.example.com/one.webp",
  );
  /// The first usable image URL wins, not the first line.
  assert.equal(
    webImageDragUrl({ uriList: "https://example.com/page\nhttps://cdn.example.com/two.gif" }),
    "https://cdn.example.com/two.gif",
  );
});

test("nothing usable reads as null, so the drop falls through to excalidraw", () => {
  assert.equal(webImageDragUrl({}), null);
  assert.equal(webImageDragUrl({ html: "<p>hello</p>", plain: "hello" }), null);
  assert.equal(webImageDragUrl({ html: "   " }), null);
});

test("a desktop file drop and our own sidebar drag are not web drags", () => {
  assert.equal(carriesWebImageDrag(["Files", WEB_IMAGE_DRAG_MIMES.uriList]), false);
  assert.equal(carriesWebImageDrag([REFERENCE_DRAG_MIME]), false);
  assert.equal(carriesWebImageDrag(undefined), false);
  assert.equal(carriesWebImageDrag([]), false);
});

test("a cross-window drag is accepted on its type list alone", () => {
  assert.equal(carriesWebImageDrag([WEB_IMAGE_DRAG_MIMES.html]), true);
  assert.equal(carriesWebImageDrag(["text/uri-list", "text/plain"]), true);
});
