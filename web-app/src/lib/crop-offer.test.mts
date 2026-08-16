import { test } from "node:test";
import assert from "node:assert/strict";

import { cropOffer, cropOfferCaption, cropOfferTitle, unfittableAspect } from "./crop-offer";
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
