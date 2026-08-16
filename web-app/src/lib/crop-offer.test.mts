import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cropNudge,
  cropOffer,
  cropOfferCaption,
  cropOfferShape,
  cropOfferTitle,
  cropPreview,
  unfittableAspect,
} from "./crop-offer";
import { cropBoxOf, type CropBox } from "./reference-version";

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

/// The six names are the vocabulary a *director* asks in. An opening on a
/// moodboard is whatever ratio the template made it, and the widest of those is
/// wider than anything on the list — so a cut made to fill one is held to a shape
/// that has no name, and the offer carries the measurement instead.
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
  /// And costs nothing when no shape was asked for, which is the common ask.
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

test("the offer is titled by what the cut keeps, since the frame is what is drawn", () => {
  const offer = offerOf(
    cropOffer({ reference: frame, box: box(0, 0, 400, 400), intent: "her hands" }),
  );

  assert.equal(cropOfferTitle(offer), "her hands");
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

test("the preview scales the thumbnail so only the kept region is in the box", () => {
  /// A quarter of the frame, off its top-left corner: the thumbnail is drawn at
  /// twice the box on each axis, with its own origin at the box's.
  const preview = cropPreview([0, 0, 500, 500], frame)!;

  assert.deepEqual(preview.image, { width: 200, height: 200, left: 0, top: 0 });
});

test("the preview pulls the thumbnail up and left by however much is cut off", () => {
  /// The bottom-right quarter: same scale, and shifted by the whole of the box.
  const preview = cropPreview([500, 500, 1000, 1000], frame)!;

  assert.deepEqual(preview.image, { width: 200, height: 200, left: -100, top: -100 });
});

test("a tight box is a bigger blow-up, which is what a 4% cut looks like", () => {
  const preview = cropPreview([400, 400, 500, 600], frame)!;

  assert.equal(preview.image.width, 500);
  assert.equal(preview.image.height, 1000);
  assert.equal(preview.image.left, -200);
  assert.equal(preview.image.top, -400);
});

test("the box is the cut's own shape in pixels, not the box's share of the frame", () => {
  /// Half the width and half the height of a 4:3 frame is still 4:3 — but a box
  /// that is square *in units of the frame* is 4:3 in pixels, and drawing it
  /// square is what would stretch the picture.
  const square = cropPreview([0, 0, 500, 500], frame)!;

  assert.equal(square.aspectRatio, 1.33);
  assert.equal(cropPreview([0, 0, 1000, 500], frame)!.aspectRatio, 0.67);
});

test("a frame whose pixels were never recorded has no preview rather than a stretched one", () => {
  assert.equal(cropPreview([0, 0, 500, 500], { width: null, height: null }), null);
  assert.equal(cropPreview("not a box", frame), null);
  assert.equal(cropPreview([500, 500, 500, 900], frame), null);
});

test("an offer carries its own preview, since the frame's pixel size never crosses", () => {
  const offer = offerOf(
    cropOffer({ reference: frame, box: box(0, 0, 500, 500), intent: "the corner" }),
  );

  assert.deepEqual(cropPreview(offer.cropBox, frame)?.image, {
    width: 200,
    height: 200,
    left: 0,
    top: 0,
  });
});

/// The whole difference between the two vocabularies, at the one place it shows:
/// an exact shape is arithmetic on the box, a loose one is a promise the model
/// kept or did not, so the box comes through untouched.
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

  /// Half the height of a 4000×3000 frame across its whole width: 4000×1500.
  assert.equal(cropOfferShape(offer, frame), "2.67:1");
  assert.equal(cropOfferShape(offer, { width: null, height: null }), null);
});

/// Both halves: what it was framed for, and what it came out. One without the
/// other is a promise with no evidence, or a number nobody asked for.
test("a loose cut's caption says the shape asked for and the shape it is", () => {
  const offer = offerOf(
    cropOffer({ reference: frame, box: box(100, 100, 700, 550), intent: "her", loose: "square" }),
  );

  const caption = cropOfferCaption(offer, frame);
  assert.match(caption, /^Roughly square · 1:1 · /);
});

/// A word and a ratio in the same ask is a caller mistake rather than a
/// director's — and the ratio is the one with arithmetic behind it, so a cut
/// labelled with the loose word would be labelled with the shape it is not.
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

/// `unfittableAspect` is about a ratio of pixels; a loose shape has no ratio, so
/// a frame nobody measured is still worth cutting — the ask simply goes unchecked.
test("a frame with no recorded size refuses a format and allows a loose shape", () => {
  const unmeasured = { id: "ref-2", title: "Scan" };
  assert.ok("refused" in cropOffer({ reference: unmeasured, box: box(100, 100, 700, 700), intent: "her", aspect: "16:9" }));

  const offer = offerOf(
    cropOffer({ reference: unmeasured, box: box(100, 100, 700, 700), intent: "her", loose: "square" }),
  );
  assert.equal(offer.loose, "square");
});

/// Asking about a cut is asking about the box that cut is, not about the picture
/// it produced. The nested crop it would otherwise mean can only ever take less
/// of the photograph, and it files a version of a version — a row the properties
/// panel has no way in at.
test("a cut asked to be changed reads as a nudge of its own box", () => {
  const nudge = cropNudge({
    id: "cut-1",
    cropBox: [100, 200, 700, 800],
    editIntent: "the doorway",
    editAspect: "16:9",
  });

  assert.deepEqual(nudge?.previous, { cropBox: [100, 200, 700, 800], editIntent: "the doorway" });
  assert.equal(nudge?.asked, "16:9");
  assert.deepEqual(nudge?.origin, {
    id: "cut-1",
    cropBox: [100, 200, 700, 800],
    editIntent: "the doorway",
    editAspect: "16:9",
  });
});

/// The loose word is the shape a nudge of that row has to be asked at, exactly as
/// a ratio is: a cut framed square nudged unconstrained comes back a rectangle.
test("a nudge inherits whichever vocabulary the cut was filed under", () => {
  assert.equal(cropNudge({ id: "c", cropBox: [0, 0, 500, 500], editAspect: "square" })?.asked, "square");
  /// A cut drawn by hand on the board carries no shape at all, and holding a
  /// nudge of it to a ratio nobody ever stated would answer "more headroom" by
  /// taking width off the sides.
  assert.equal(cropNudge({ id: "c", cropBox: [0, 0, 500, 500] })?.asked, null);
  assert.equal(cropNudge({ id: "c", cropBox: [0, 0, 500, 500], editAspect: "wonky" })?.asked, null);
});

/// Nothing to move. Said rather than silently cropped, which is the one case
/// where the nested cut would have happened anyway.
test("a cut whose region was never recorded is not a nudge", () => {
  assert.equal(cropNudge({ id: "c", cropBox: [] }), null);
  assert.equal(cropNudge({ id: "c" }), null);
});
