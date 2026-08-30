import { test } from "node:test";
import assert from "node:assert/strict";

import { ReferenceOrigin } from "@/generated/prisma/enums";
import {
  discardedReferenceNote,
  pictureNoun,
  referenceDiscardKey,
  type DiscardedReference,
} from "@/lib/references/reference-discard";
import { attachmentKey, attachmentOf } from "@/lib/agent/shared/attachments";

const GONE: DiscardedReference = {
  referenceId: "ref-1",
  title: "Ridge study",
  cuts: 2,
  boards: [{ id: "board-7", title: "Act one" }],
};

test("the note names the picture, kills the id, and says what went with it", () => {
  const note = discardedReferenceNote(GONE);

  assert.match(note, /Ridge study/);
  assert.match(note, /ref-1/);
  assert.match(note, /photograph/);
  assert.match(note, /no longer names anything/);
  assert.match(note, /The 2 cuts made of it went with it/);
  assert.match(note, /“Act one” \(board-7\)/);
  assert.match(note, /gap where it was/);
  assert.match(note, /design_page/);
});

test("one cut is one cut, and a picture nothing was cut from says nothing about cuts", () => {
  assert.match(discardedReferenceNote({ ...GONE, cuts: 1 }), /The cut made of it went with it/);
  assert.doesNotMatch(discardedReferenceNote({ ...GONE, cuts: 0 }), /went with it/);
});

test("a cut names the frame that stays, and never reports a cascade", () => {
  const note = discardedReferenceNote({ ...GONE, frameId: "ref-0", cuts: 0 });

  assert.match(note, /removed the cut/);
  assert.match(note, /cut from \(ref-0\) is still in the gallery/);
});

test("what the door did not know is left unsaid rather than said as nothing", () => {
  const note = discardedReferenceNote({ referenceId: "ref-1", title: "Ridge study" });

  assert.match(note, /gone, and that id no longer names anything/);
  assert.doesNotMatch(note, /went with it/);
  assert.doesNotMatch(note, /gap/);
});

test("an untitled picture is still named, and boards past the second are counted", () => {
  const note = discardedReferenceNote({
    referenceId: "ref-1",
    title: "   ",
    boards: [
      { id: "b1", title: "Act one" },
      { id: "b2", title: "" },
      { id: "b3", title: "Act three" },
    ],
  });

  assert.match(note, /“Untitled”/);
  assert.match(note, /“Act one” \(b1\), “Untitled board” \(b2\) and 1 more/);
  assert.match(note, /now have a gap/);
});

test("a hole on a spread is named page and all, with the id the swap takes", () => {
  const note = discardedReferenceNote({
    ...GONE,
    boards: [
      {
        id: "board-7",
        title: "Act one",
        pages: [{ pageId: "pg-2", name: "Exteriors" }],
      },
    ],
  });

  assert.match(note, /“Act one” \(board-7\) on “Exteriors” \(pg-2\)/);
  assert.match(note, /passing the pageId named beside the board/);
});

test("a board of one page is told as it always was", () => {
  const note = discardedReferenceNote(GONE);

  assert.match(note, /“Act one” \(board-7\) — now has a gap/);
  assert.doesNotMatch(note, /pageId/);
});

test("a removed picture's key is the key its tile was drawn under", () => {
  const picture = {
    id: "ref-1",
    title: "Ridge study",
    thumbUrl: "https://example.test/thumb.jpg",
    width: 4000,
    height: 3000,
  };
  const offered = attachmentOf(picture, { cuts: 2, boards: [] });

  assert.equal(referenceDiscardKey("ref-1"), attachmentKey(offered));
  assert.equal(offered.kind, "reference");
  assert.deepEqual(offered.discard, { cuts: 2, boards: [] });
  assert.equal(attachmentOf(picture).discard, undefined);
});

test("a picture the assistant drew is removed as a drawn picture", () => {
  const note = discardedReferenceNote({ ...GONE, origin: ReferenceOrigin.GENERATED });

  assert.match(note, /removed the drawn picture “Ridge study”/);
  assert.doesNotMatch(note, /photograph/);
  assert.match(note, /no longer names anything/);
  assert.match(note, /The 2 cuts made of it went with it/);
});

test("a cut of a drawn picture leaves a drawn picture standing, not a photograph", () => {
  const note = discardedReferenceNote({
    ...GONE,
    frameId: "ref-0",
    cuts: 0,
    origin: ReferenceOrigin.GENERATED,
  });

  assert.match(note, /removed the cut/);
  assert.match(note, /The drawn picture it was cut from \(ref-0\) is still in the gallery/);
});

test("an imported or unread origin is worded exactly as an upload is", () => {
  for (const origin of [ReferenceOrigin.UPLOADED, ReferenceOrigin.IMPORTED, undefined, null]) {
    assert.match(discardedReferenceNote({ ...GONE, origin }), /removed the photograph/);
  }
});

test("the noun is read off the column and nothing else", () => {
  assert.equal(pictureNoun(ReferenceOrigin.GENERATED), "drawn picture");
  assert.equal(pictureNoun(ReferenceOrigin.IMPORTED), "photograph");
  assert.equal(pictureNoun(undefined), "photograph");
});

test("a discard offer's tile carries the provenance the note is written from", () => {
  const drawn = {
    id: "ref-9",
    title: "Warm grey paper",
    thumbUrl: "https://example.test/thumb.jpg",
    origin: ReferenceOrigin.GENERATED,
  };

  assert.equal(attachmentOf(drawn, { cuts: 0, boards: [] }).origin, ReferenceOrigin.GENERATED);
  assert.match(
    discardedReferenceNote({
      referenceId: drawn.id,
      title: drawn.title,
      origin: attachmentOf(drawn).origin,
    }),
    /removed the drawn picture “Warm grey paper”/,
  );
  assert.equal(attachmentOf({ ...drawn, origin: null }).origin, undefined);
});
