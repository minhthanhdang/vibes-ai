import { test } from "node:test";
import assert from "node:assert/strict";

import {
  carriesWebImageDrag,
  pastedImageUrls,
  webImageDragUrl,
  WEB_IMAGE_MIMES,
} from "@/lib/intake/web-image-import";
import { REFERENCE_DRAG_MIME } from "@/lib/canvas/moodboard-drop";

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
  assert.equal(carriesWebImageDrag(["Files", WEB_IMAGE_MIMES.uriList]), false);
  assert.equal(carriesWebImageDrag([REFERENCE_DRAG_MIME]), false);
  assert.equal(carriesWebImageDrag(undefined), false);
  assert.equal(carriesWebImageDrag([]), false);
});

test("a cross-window drag is accepted on its type list alone", () => {
  assert.equal(carriesWebImageDrag([WEB_IMAGE_MIMES.html]), true);
  assert.equal(carriesWebImageDrag(["text/uri-list", "text/plain"]), true);
});

test("an image copied off a page is what the browser wraps in its own boilerplate", () => {
  assert.deepEqual(
    pastedImageUrls({
      html: `<html><body><!--StartFragment--><img alt="a still" src="https://cdn.example.com/564x/abc">
             <!--EndFragment--></body></html>`,
      text: "https://example.com/pin/12345/",
    }),
    ["https://cdn.example.com/564x/abc"],
  );
});

test("several images in one copied fragment all land, and a repeat lands once", () => {
  assert.deepEqual(
    pastedImageUrls({
      html: `<a href="/p/1"><img src="https://cdn.example.com/1.jpg"></a>
             <a href="/p/2"><img src="https://cdn.example.com/2.jpg"></a>
             <img src="https://cdn.example.com/1.jpg">`,
    }),
    ["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg"],
  );
});

test("a copied fragment with words in it stays excalidraw's", () => {
  assert.deepEqual(
    pastedImageUrls({
      html: `<p>The shot that started it</p><img src="https://cdn.example.com/1.jpg">`,
    }),
    [],
  );
});

test("markup that came with the fragment does not read as words", () => {
  assert.deepEqual(
    pastedImageUrls({
      html: `<meta charset='utf-8'><style>.x{color:red}</style><figure><img src="https://cdn.example.com/1.jpg"></figure>`,
    }),
    ["https://cdn.example.com/1.jpg"],
  );
});

test("an image address pasted as plain text is taken, a link and a note are not", () => {
  assert.deepEqual(pastedImageUrls({ text: "  https://static.example.com/a/shot.JPG?v=2 " }), [
    "https://static.example.com/a/shot.JPG?v=2",
  ]);
  assert.deepEqual(pastedImageUrls({ text: "https://news.example.com/an-article" }), []);
  assert.deepEqual(pastedImageUrls({ text: "look at https://cdn.example.com/1.jpg" }), []);
  assert.deepEqual(pastedImageUrls({ text: "" }), []);
});

test("every line has to be an image, so an excalidraw scene on the clipboard is not one", () => {
  assert.deepEqual(
    pastedImageUrls({ text: "https://cdn.example.com/1.jpg\nhttps://cdn.example.com/2.png\n" }),
    ["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.png"],
  );
  assert.deepEqual(pastedImageUrls({ text: `{"type":"excalidraw/clipboard","elements":[]}` }), []);
  assert.deepEqual(pastedImageUrls({ text: "https://cdn.example.com/1.jpg\nand this one too" }), []);
});

test("a fragment of images the server could never fetch is nothing to import", () => {
  assert.deepEqual(pastedImageUrls({ html: `<img src="data:image/png;base64,iVBORw0KGgo=">` }), []);
  assert.deepEqual(pastedImageUrls({ html: `<img src="/relative/photo.jpg">` }), []);
});

test("the paste reading and the drag reading agree about a lone <img>", () => {
  const html = `<meta charset='utf-8'><img src="https://cdn.example.com/i?id=7&amp;size=large">`;
  assert.deepEqual(pastedImageUrls({ html }), [webImageDragUrl({ html })]);
});
