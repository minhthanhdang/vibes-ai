import { test } from "node:test";
import assert from "node:assert/strict";

import {
  boardsStandingOn,
  cropNudge,
  cropOffer,
  cropOfferCaption,
  cropOfferShape,
  standingOnNote,
  unfittableAspect,
} from "@/lib/crop/crop-offer";
import { referenceUsageIndex } from "@/lib/references/reference-usage";
import { cropBoxOf, type CropBox } from "@/lib/references/reference-version";

function box(ymin: number, xmin: number, ymax: number, xmax: number): CropBox {
  return cropBoxOf([ymin, xmin, ymax, xmax])!;
}

const frame = { id: "ref-1", title: "Hallway", width: 4000, height: 3000 };

function offerOf(result: ReturnType<typeof cropOffer>) {
  assert.ok("offer" in result, `expected an offer, got ${JSON.stringify(result)}`);
  return result.offer;
}

test("an offer names the frame it would be cut from, not a cut of its own", () => {
  const offer = offerOf(
    cropOffer({ reference: frame, box: box(100, 200, 700, 800), intent: "the doorway" }),
  );

  assert.equal(offer.referenceId, "ref-1");
  assert.equal(offer.editIntent, "the doorway");
  assert.deepEqual(offer.cropBox, [100, 200, 700, 800]);
  assert.equal(offer.aspect, null);
});

test("the region is the box as fractions, ready for the browser to cut", () => {
  const offer = offerOf(
    cropOffer({ reference: frame, box: box(250, 500, 750, 1000), intent: "the lamp" }),
  );

  assert.deepEqual(offer.region, { x: 0.5, y: 0.25, width: 0.5, height: 0.5 });
});

test("a box asked at a format is opened out to that format before it is offered", () => {
  const offer = offerOf(
    cropOffer({ reference: frame, box: box(200, 200, 800, 500), intent: "her", aspect: "16:9" }),
  );

  assert.equal(offer.aspect, "16:9");
  const width = ((offer.cropBox[3]! - offer.cropBox[1]!) / 1000) * frame.width;
  const height = ((offer.cropBox[2]! - offer.cropBox[0]!) / 1000) * frame.height;
  assert.ok(Math.abs(width / height - 16 / 9) < 0.02, `${width}×${height} is not 16:9`);
});

test("a box asked at a measured shape is held to it and says so", () => {
  const offer = offerOf(
    cropOffer({ reference: frame, box: box(200, 200, 800, 500), intent: "her", aspect: "3.52:1" }),
  );

  assert.equal(offer.aspect, "3.52:1");
  const width = ((offer.cropBox[3]! - offer.cropBox[1]!) / 1000) * frame.width;
  const height = ((offer.cropBox[2]! - offer.cropBox[0]!) / 1000) * frame.height;
  assert.ok(Math.abs(width / height - 3.52) < 0.05, `${width}×${height} is not 3.52:1`);
});

test("a shape that is not a shape is a cut at no shape rather than a cut at NaN", () => {
  const offer = offerOf(
    cropOffer({ reference: frame, box: box(100, 200, 700, 800), intent: "her", aspect: "scope" }),
  );
  assert.equal(offer.aspect, null);
  assert.deepEqual(offer.cropBox, [100, 200, 700, 800]);
});

test("a frame whose pixels were never recorded is refused a format before the call", () => {
  const sizeless = { id: "ref-2", title: "Scan", width: null, height: null };

  assert.match(unfittableAspect(sizeless, "2.39:1") ?? "", /never recorded/);
  assert.equal(unfittableAspect(sizeless, undefined), null);
  assert.equal(unfittableAspect(frame, "2.39:1"), null);
});

test("a frame with no size still crops when no shape was asked for", () => {
  const offer = offerOf(
    cropOffer({
      reference: { id: "ref-2", title: "Scan", width: null, height: null },
      box: box(0, 0, 500, 500),
      intent: "the corner",
    }),
  );

  assert.deepEqual(offer.cropBox, [0, 0, 500, 500]);
});

test("a box that trims nothing is refused in words rather than filed as a copy", () => {
  const result = cropOffer({
    reference: frame,
    box: box(0, 0, 1000, 1000),
    intent: "all of it",
  });

  assert.ok("refused" in result);
  assert.match(result.refused, /the whole frame is the shot/);
});

test("the caption is the three readings the offer is judged on", () => {
  const offer = offerOf(
    cropOffer({ reference: frame, box: box(0, 0, 500, 500), intent: "the corner", aspect: "1:1" }),
  );

  const caption = cropOfferCaption(offer, frame);
  assert.match(caption, /^1:1 · Keeps \d+% of the frame · About \d+ × \d+ px/);
});

test("a cut too small to survive a board says so where it can still be declined", () => {
  const offer = offerOf(
    cropOffer({ reference: frame, box: box(0, 0, 40, 40), intent: "the keyhole" }),
  );

  assert.match(cropOfferCaption(offer, frame), /Soft on a board/);
  assert.equal(cropOfferCaption(offer, { width: null, height: null }), "Keeps under 1% of the frame");
});

test("a box framed to a loose shape is offered exactly as the cropper framed it", () => {
  const offer = offerOf(
    cropOffer({
      reference: frame,
      box: box(200, 200, 800, 500),
      intent: "her",
      loose: "portrait",
    }),
  );

  assert.deepEqual(offer.cropBox, [200, 200, 800, 500]);
  assert.equal(offer.aspect, null);
  assert.equal(offer.loose, "portrait");
});

test("the shape a loose cut came out is measured off the frame's pixels", () => {
  const offer = offerOf(
    cropOffer({ reference: frame, box: box(0, 0, 500, 1000), intent: "the sky", loose: "landscape" }),
  );

  assert.equal(cropOfferShape(offer, frame), "2.67:1");
  assert.equal(cropOfferShape(offer, { width: null, height: null }), null);
});

test("a loose cut's caption says the shape asked for and the shape it is", () => {
  const offer = offerOf(
    cropOffer({ reference: frame, box: box(100, 100, 700, 550), intent: "her", loose: "square" }),
  );

  const caption = cropOfferCaption(offer, frame);
  assert.match(caption, /^Roughly square · 1:1 · /);
});

test("an exact shape wins when a cut somehow carries both", () => {
  const offer = offerOf(
    cropOffer({
      reference: frame,
      box: box(200, 200, 800, 500),
      intent: "her",
      aspect: "16:9",
      loose: "portrait",
    }),
  );

  assert.equal(offer.aspect, "16:9");
  assert.equal(offer.loose, undefined);
});

test("a frame with no recorded size refuses a format and allows a loose shape", () => {
  const unmeasured = { id: "ref-2", title: "Scan" };
  assert.ok("refused" in cropOffer({ reference: unmeasured, box: box(100, 100, 700, 700), intent: "her", aspect: "16:9" }));

  const offer = offerOf(
    cropOffer({ reference: unmeasured, box: box(100, 100, 700, 700), intent: "her", loose: "square" }),
  );
  assert.equal(offer.loose, "square");
});

test("a cut asked to be changed reads as a nudge of its own box", () => {
  const edit = [{ op: "crop", box: [100, 200, 700, 800], shape: "16:9" }];
  const nudge = cropNudge({ id: "cut-1", edit, editIntent: "the doorway" });

  assert.deepEqual(nudge?.previous, { cropBox: [100, 200, 700, 800], editIntent: "the doorway" });
  assert.equal(nudge?.asked, "16:9");
  assert.deepEqual(nudge?.origin, { id: "cut-1", edit, editIntent: "the doorway" });
});

test("a nudge inherits whichever vocabulary the cut was filed under", () => {
  const cut = (shape?: string) => ({
    id: "c",
    edit: [{ op: "crop", box: [0, 0, 500, 500], ...(shape && { shape }) }],
  });
  assert.equal(cropNudge(cut("square"))?.asked, "square");
  assert.equal(cropNudge(cut())?.asked, null);
  assert.equal(cropNudge(cut("wonky"))?.asked, null);
});

test("a cut whose region was never recorded is not a nudge", () => {
  assert.equal(cropNudge({ id: "c", edit: [] }), null);
  assert.equal(cropNudge({ id: "c" }), null);
});

test("a nudge names the cut standing on the board, an ordinary crop names the frame", () => {
  const usage = referenceUsageIndex([
    { referenceId: "cut-1", boards: [{ id: "b-1", title: "Dawn" }] },
    { referenceId: "ref-1", boards: [{ id: "b-2", title: "Night" }] },
  ]);

  assert.deepEqual(boardsStandingOn(usage, { cut: "cut-1", frame: "ref-1" }), [
    { id: "b-1", title: "Dawn", takeOff: "cut-1" },
    { id: "b-2", title: "Night", takeOff: "ref-1" },
  ]);
  assert.deepEqual(boardsStandingOn(usage, { cut: null, frame: "ref-1" }), [
    { id: "b-2", title: "Night", takeOff: "ref-1" },
  ]);
});

test("a board holding the cut and the frame is named once, for the cut", () => {
  const usage = referenceUsageIndex([
    { referenceId: "ref-1", boards: [{ id: "b-1", title: "Dawn" }] },
    { referenceId: "cut-1", boards: [{ id: "b-1", title: "Dawn" }] },
  ]);

  assert.deepEqual(boardsStandingOn(usage, { cut: "cut-1", frame: "ref-1" }), [
    { id: "b-1", title: "Dawn", takeOff: "cut-1" },
  ]);
});

test("a picture on no board has nothing standing on it and nothing to say", () => {
  const usage = referenceUsageIndex([{ referenceId: "other", boards: [{ id: "b", title: "B" }] }]);

  assert.deepEqual(boardsStandingOn(usage, { cut: "cut-1", frame: "ref-1" }), []);
  assert.equal(standingOnNote([]), null);
});

test("the note names the board, forbids the claim and gives the call that closes it", () => {
  const note = standingOnNote([{ id: "b-1", title: "Dawn Pitch", takeOff: "cut-1" }])!;

  assert.match(note, /no board was changed/);
  assert.match(note, /“Dawn Pitch” \(b-1\), which is standing on cut-1/);
  assert.match(note, /call design_page with the cut's id/);
  assert.match(note, /crop again with that boardId/);
});

test("a board standing on the picture on one page of a spread says which", () => {
  const usage = referenceUsageIndex([
    {
      referenceId: "cut-1",
      boards: [{ id: "b-1", title: "Dawn", pages: [{ pageId: "pg-2", name: "Act two" }] }],
    },
  ]);
  const standing = boardsStandingOn(usage, { cut: "cut-1", frame: "ref-1" });

  assert.deepEqual(standing, [
    { id: "b-1", title: "Dawn", takeOff: "cut-1", pages: [{ pageId: "pg-2", name: "Act two" }] },
  ]);
  assert.match(standingOnNote(standing)!, /standing on cut-1 on “Act two” \(pg-2\)/);
  assert.match(
    standingOnNote([{ id: "b-1", title: "Dawn", takeOff: "cut-1" }])!,
    /standing on cut-1 —/,
  );
});

test("past the limit the boards are counted rather than dropped", () => {
  const standing = ["a", "b", "c", "d"].map((id) => ({ id, title: id, takeOff: "ref-1" }));
  const note = standingOnNote(standing)!;

  assert.match(note, /“a” \(a\)/);
  assert.match(note, /“b” \(b\)/);
  assert.doesNotMatch(note, /“c”/);
  assert.match(note, /and 2 other boards/);
  assert.match(standingOnNote(standing.slice(0, 3))!, /and 1 other board —/);
});

test("an untitled board is still named", () => {
  assert.match(standingOnNote([{ id: "b", title: "  ", takeOff: "r" }])!, /“Untitled board” \(b\)/);
});
