import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isTrailRoot,
  openedTrail,
  trailBack,
  trailCurrent,
  trailLabel,
  trailUpTo,
  type TrailStep,
} from "@/lib/references/reference-trail";

const step = (id: string, extra: Partial<TrailStep> = {}): TrailStep => ({
  id,
  title: id,
  thumbUrl: `/api/references/${id}/image?variant=thumb`,
  ...extra,
});

const photo = step("photo");
const crop = step("crop", { title: "photo (crop 1)", label: "just the hands" });
const cropOfCrop = step("crop-of-crop", { title: "photo (crop 1) (crop 1)", label: "one thumb" });

test("the panel opens on the photograph the gallery selected", () => {
  assert.deepEqual(trailCurrent([photo]), photo);
  assert.ok(isTrailRoot([photo]));
});

test("opening a version walks to it", () => {
  const trail = openedTrail([photo], crop);
  assert.deepEqual(trail, [photo, crop]);
  assert.deepEqual(trailCurrent(trail), crop);
  assert.ok(!isTrailRoot(trail));
});

test("a cut of a cut is another step, not a replacement", () => {
  const trail = openedTrail(openedTrail([photo], crop), cropOfCrop);
  assert.deepEqual(
    trail.map((walked) => walked.id),
    ["photo", "crop", "crop-of-crop"],
  );
});

test("opening something already on the trail truncates to it", () => {
  /// Walk in, click back to the photograph, open the same cut again: two steps
  /// deep, not three, and the breadcrumb never says one name twice.
  const deep = openedTrail(openedTrail([photo], crop), cropOfCrop);
  const back = trailUpTo(deep, photo.id);
  assert.deepEqual(openedTrail(back, crop), [photo, crop]);
});

test("opening the step already on screen changes nothing", () => {
  const trail = [photo, crop];
  assert.deepEqual(openedTrail(trail, crop), trail);
});

test("a breadcrumb click truncates to the crumb pressed", () => {
  const deep = [photo, crop, cropOfCrop];
  assert.deepEqual(trailUpTo(deep, crop.id), [photo, crop]);
  assert.deepEqual(trailUpTo(deep, photo.id), [photo]);
});

test("a crumb that is no longer on the trail is not guessed at", () => {
  const trail = [photo, crop];
  assert.deepEqual(trailUpTo(trail, "deleted"), trail);
});

test("back is one step, and never out of the photograph", () => {
  assert.deepEqual(trailBack([photo, crop, cropOfCrop]), [photo, crop]);
  assert.deepEqual(trailBack([photo]), [photo]);
});

test("neither walking nor backing rewrites the trail it was given", () => {
  const trail = [photo, crop];
  openedTrail(trail, cropOfCrop);
  trailBack(trail);
  trailUpTo(trail, photo.id);
  assert.deepEqual(trail, [photo, crop]);
});

test("a version is labelled by what it was asked for, a photograph by its title", () => {
  /// Every cut of one frame carries the same title, so a breadcrumb of titles
  /// would be a breadcrumb that distinguishes nothing.
  assert.equal(trailLabel(crop), "just the hands");
  assert.equal(trailLabel(photo), "photo");
  assert.equal(trailLabel(step("x", { title: "  ", label: "  " })), "Reference");
});
