import { test } from "node:test";
import assert from "node:assert/strict";

import { PICTURE_WINDOW, isPicture, pictureDroppedSaid, pictureWindow } from "./picture-window";
import type { Content } from "@/server/google/vertex";

/// What is asserted here is the one thing this window decides: which pictures a
/// long design loop is still paying for, and whether what stands in place of the
/// rest tells the model how to get one back.

const said = (text: string): Content => ({ role: "user", parts: [{ text }] });

const picture = (uri: string) => ({ fileData: { fileUri: uri, mimeType: "image/png" } });

/// A round as the designer loop builds one: the call, then the answer with the
/// picture directly before the response it belongs to — the order Vertex will
/// read, and the reason is in `loop.ts` where the round is built.
const looked = (
  name: string,
  args: Record<string, unknown>,
  uri: string | null,
  response: Record<string, unknown> = {},
): Content[] => [
  { role: "model", parts: [{ functionCall: { name, args } }] },
  {
    role: "user",
    parts: [...(uri ? [picture(uri)] : []), { functionResponse: { name, response } }],
  },
];

const urisIn = (contents: readonly Content[]) =>
  contents.flatMap(({ parts }) => parts.flatMap((part) => part.fileData?.fileUri ?? []));

const textIn = (contents: readonly Content[]) =>
  contents.flatMap(({ parts }) => parts.flatMap((part) => part.text ?? []));

const page = (at: number) =>
  looked("get_page", { boardId: "b-1", pageId: `p-${at}` }, `gs://r/${at}.png`);

test("a picture rides on its own round and the one after it", () => {
  const contents = [said("make me a welcome sign"), ...page(1), ...page(2)];
  const window = pictureWindow(contents);

  assert.equal(window.dropped, 0);
  assert.deepEqual(urisIn(window.contents), ["gs://r/1.png", "gs://r/2.png"]);
});

test("the round after that, the oldest picture is gone", () => {
  const contents = [said("make me a welcome sign"), ...page(1), ...page(2), ...page(3)];
  const window = pictureWindow(contents);

  assert.equal(window.dropped, 1);
  assert.deepEqual(urisIn(window.contents), ["gs://r/2.png", "gs://r/3.png"]);
});

test("exactly PICTURE_WINDOW rounds of pictures survive however long the turn is", () => {
  const contents = [said("design it"), ...Array.from({ length: 12 }, (_, at) => page(at)).flat()];
  const window = pictureWindow(contents);

  assert.equal(urisIn(window.contents).length, PICTURE_WINDOW);
  assert.equal(window.dropped, 12 - PICTURE_WINDOW);
});

test("what stands in the picture's place names the call that brings it back", () => {
  const contents = [said("design it"), ...page(1), ...page(2), ...page(3)];
  const window = pictureWindow(contents);

  const note = textIn(window.contents).find((text) => text.startsWith("["));
  assert.ok(note, "a dropped picture is said out loud");
  assert.match(note, /get_page/);
  assert.match(note, /p-1/);
  assert.match(note, /same arguments/);
});

test("the note stands where the picture stood, in the same content", () => {
  const contents = [said("design it"), ...page(1), ...page(2), ...page(3)];
  const window = pictureWindow(contents);

  const answered = window.contents[2]!;
  assert.equal(answered.role, "user");
  assert.equal(answered.parts.length, 2);
  assert.ok(answered.parts[0]!.text?.startsWith("["), "the picture became the line about it");
  assert.ok(answered.parts[1]!.functionResponse, "the answer itself is untouched");
});

test("nothing else in the transcript moves", () => {
  const contents = [said("design it"), ...page(1), ...page(2), ...page(3)];
  const window = pictureWindow(contents);

  assert.equal(window.contents.length, contents.length);
  assert.deepEqual(
    window.contents.map(({ role }) => role),
    contents.map(({ role }) => role),
  );
  assert.deepEqual(window.contents[0], said("design it"));
});

test("a turn that has looked at nothing is left exactly as it stands", () => {
  const contents = [
    said("design it"),
    ...looked("list_gallery", {}, null, { references: [] }),
    ...looked("read_canvas", { boardId: "b-1" }, null, { objects: [] }),
    ...looked("put_on_canvas", { boardId: "b-1" }, null, { objectId: "o-1" }),
  ];
  const window = pictureWindow(contents);

  assert.equal(window.dropped, 0);
  assert.deepEqual(window.contents, contents);
});

test("a picture the user's own message carried is not this window's to drop", () => {
  const contents: Content[] = [
    { role: "user", parts: [picture("gs://asked/page.png"), { text: "fix this" }] },
    ...page(1),
    ...page(2),
    ...page(3),
  ];
  const window = pictureWindow(contents);

  assert.ok(urisIn(window.contents).includes("gs://asked/page.png"));
  assert.equal(window.dropped, 1);
});

test("two pictures in one round each get the call they came from", () => {
  const contents: Content[] = [
    said("show me both"),
    {
      role: "model",
      parts: [
        { functionCall: { name: "get_image", args: { imageId: "ref-1" } } },
        { functionCall: { name: "get_modification", args: { modificationId: "cut-9" } } },
      ],
    },
    {
      role: "user",
      parts: [
        picture("gs://ref-1.png"),
        { functionResponse: { name: "get_image", response: {} } },
        picture("gs://cut-9.png"),
        { functionResponse: { name: "get_modification", response: {} } },
      ],
    },
    ...page(2),
    ...page(3),
  ];
  const window = pictureWindow(contents);

  assert.equal(window.dropped, 2);
  const notes = textIn(window.contents).filter((text) => text.startsWith("["));
  assert.equal(notes.length, 2);
  assert.match(notes[0]!, /get_image .*ref-1/);
  assert.match(notes[1]!, /get_modification .*cut-9/);
});

test("bytes are dropped like uris — the expensive spelling of a picture is still a picture", () => {
  const contents: Content[] = [
    said("design it"),
    {
      role: "model",
      parts: [{ functionCall: { name: "generate_image", args: { prompt: "a wreath" } } }],
    },
    {
      role: "user",
      parts: [
        { inlineData: { mimeType: "image/png", data: "AAAA" } },
        { functionResponse: { name: "generate_image", response: { referenceId: "ref-2" } } },
      ],
    },
    ...page(2),
    ...page(3),
  ];
  const window = pictureWindow(contents);

  assert.equal(window.dropped, 1);
  assert.equal(
    window.contents.flatMap(({ parts }) => parts.filter((part) => part.inlineData)).length,
    0,
  );
});

test("a transcript that is not a clean run of pairs is returned untouched", () => {
  const contents: Content[] = [
    said("design it"),
    ...page(1),
    ...page(2),
    ...page(3),
    { role: "model", parts: [{ functionCall: { name: "get_page", args: {} } }] },
  ];
  const window = pictureWindow(contents);

  assert.equal(window.dropped, 0);
  assert.deepEqual(window.contents, contents);
});

test("a picture with no response below it still gets a call named", () => {
  const contents: Content[] = [
    said("design it"),
    { role: "model", parts: [{ functionCall: { name: "get_page", args: { pageId: "p-1" } } }] },
    {
      role: "user",
      parts: [{ functionResponse: { name: "get_page", response: {} } }, picture("gs://loose.png")],
    },
    ...page(2),
    ...page(3),
  ];
  const window = pictureWindow(contents);

  assert.equal(window.dropped, 1);
  assert.match(textIn(window.contents).find((text) => text.startsWith("["))!, /get_page/);
});

test("arguments too long to be a pointer are left out rather than quoted back", () => {
  const long = "x".repeat(400);
  const contents: Content[] = [
    said("design it"),
    ...looked("get_page", { boardId: long }, "gs://long.png"),
    ...page(2),
    ...page(3),
  ];
  const window = pictureWindow(contents);

  const note = textIn(window.contents).find((text) => text.startsWith("["))!;
  assert.ok(!note.includes(long));
  assert.match(note, /get_page again/);
});

test("the line says a picture was there, which call had it, and how to get it back", () => {
  const note = pictureDroppedSaid("get_page", '{"pageId":"p-1"}');
  assert.match(note, /no longer shown/);
  assert.match(note, /get_page \{"pageId":"p-1"\}/);
  assert.match(note, /Call get_page with the same arguments/);
});

test("a picture nobody can name is still said out loud", () => {
  const note = pictureDroppedSaid(undefined, undefined);
  assert.match(note, /an earlier tool call/);
  assert.match(note, /Make that call again/);
});

test("isPicture reads both spellings and nothing else", () => {
  assert.ok(isPicture(picture("gs://a.png")));
  assert.ok(isPicture({ inlineData: { mimeType: "image/png", data: "AAAA" } }));
  assert.ok(!isPicture({ text: "gs://a.png" }));
  assert.ok(!isPicture({ functionResponse: { name: "get_page", response: {} } }));
});
