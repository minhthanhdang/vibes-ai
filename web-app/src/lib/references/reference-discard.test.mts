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
  /// The id is the point, exactly as it is for a discarded board: the catalog
  /// primed into the next turn is a fresh read and this picture is simply
  /// absent, so a model holding the id from the conversation above would pass it
  /// to a tool and be told a picture it just discussed does not exist.
  assert.match(note, /no longer names anything/);
  /// The cascade, which the user may not connect to the tile they removed.
  assert.match(note, /The 2 cuts made of it went with it/);
  /// And the boards, which is the half the assistant can actually do something
  /// about — so the call that fixes it is named.
  assert.match(note, /“Act one” \(board-7\)/);
  assert.match(note, /gap where it was/);
  assert.match(note, /design_page/);
});

test("one cut is one cut, and a picture nothing was cut from says nothing about cuts", () => {
  assert.match(discardedReferenceNote({ ...GONE, cuts: 1 }), /The cut made of it went with it/);
  assert.doesNotMatch(discardedReferenceNote({ ...GONE, cuts: 0 }), /went with it/);
});

/// A cut and a photograph are different news. Removing a cut leaves the frame it
/// came out of standing, and the frame is the id the conversation goes on with.
test("a cut names the frame that stays, and never reports a cascade", () => {
  const note = discardedReferenceNote({ ...GONE, frameId: "ref-0", cuts: 0 });

  assert.match(note, /removed the cut/);
  assert.match(note, /cut from \(ref-0\) is still in the gallery/);
});

/// Absent is unknown, not none. The gallery's own Remove button announces what it
/// managed to read — a board scan that failed leaves the boards out rather than
/// claiming the picture was on none.
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

/// The hole is on a page, and the call named to fill it takes a pageId: without
/// one the swap edits whichever copy the scene array carries first, which on a
/// spread is the wrong page and says nothing about being wrong.
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

/// The offer and the thing that settles it have to agree on one string, or the
/// tile goes on offering an act that is already done. Pinned here rather than
/// asserted as a format, the same way a discarded board's key is.
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
  /// And the question rides on the tile itself rather than on a fourth kind of
  /// attachment: one picture, one tile, one click into the gallery. A picture
  /// shown for any other reason carries no question at all.
  assert.equal(offered.kind, "reference");
  assert.deepEqual(offered.discard, { cuts: 2, boards: [] });
  assert.equal(attachmentOf(picture).discard, undefined);
});

/// A drawn picture is not a photograph, and this note is where the model reads a
/// removal as fact — in the user's own voice, which is what makes a wrong noun a
/// thing it repeats back rather than a thing it doubts.
test("a picture the assistant drew is removed as a drawn picture", () => {
  const note = discardedReferenceNote({ ...GONE, origin: ReferenceOrigin.GENERATED });

  assert.match(note, /removed the drawn picture “Ridge study”/);
  assert.doesNotMatch(note, /photograph/);
  /// Everything else about the removal is unchanged: the noun is the only thing
  /// the column decides.
  assert.match(note, /no longer names anything/);
  assert.match(note, /The 2 cuts made of it went with it/);
});

/// A cut inherits its frame's origin when it is written, so the cut's own column
/// answers a question about the picture standing behind it.
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

/// An import is a picture the user has, like an upload: the one distinction the
/// noun is about is which of them nobody shot. An absent column claims nothing
/// and words the removal as it always was.
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

/// The tile is the only thing left that knows what the picture was: the browser
/// writes the note after the row is deleted, so the offer has to carry the column
/// the sentence is worded from.
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
  /// A photograph's tile says nothing at all, on the terms every other optional
  /// field on an attachment is absent by.
  assert.equal(attachmentOf({ ...drawn, origin: null }).origin, undefined);
});
