import { test } from "node:test";
import assert from "node:assert/strict";

import { analysisAskSaid } from "./analysis-ask";

test("an uploaded photograph is still introduced by the name the user filed it under", () => {
  assert.equal(
    analysisAskSaid({ title: "dune-corridor.jpg", origin: "UPLOADED" }),
    'Analyze this reference. The user filed it as "dune-corridor.jpg".',
  );
  assert.equal(analysisAskSaid({ title: "  ", origin: "UPLOADED" }), "Analyze this reference.");
  assert.equal(analysisAskSaid({}), "Analyze this reference.");
});

test("an imported picture is worded as an upload is — somebody still chose it", () => {
  assert.equal(
    analysisAskSaid({ title: "Grain of a lit wall", origin: "IMPORTED" }),
    'Analyze this reference. The user filed it as "Grain of a lit wall".',
  );
});

test("a drawn picture is named as drawn, quoting what it was asked for rather than its title", () => {
  const said = analysisAskSaid({
    title: "A warm grey paper texture (2)",
    origin: "GENERATED",
    generationPrompt: "A warm grey paper texture, lit flat, no grain",
  });

  assert.match(said, /drawn by an image model rather than shot/);
  assert.match(said, /"A warm grey paper texture, lit flat, no grain"/);
  assert.doesNotMatch(said, /The user filed it as/, "nobody filed or named this one");
  assert.doesNotMatch(said, /\(2\)/, "the number is a disambiguator, not part of what it is of");
});

test("the description is handed over as evidence, not as a reading of the frame", () => {
  assert.match(
    analysisAskSaid({ origin: "GENERATED", generationPrompt: "rain on a window at night" }),
    /Read what is in the frame — a drawing does not always hold everything it was asked for\./,
  );
});

test("a cut of a drawn picture inherits the origin and not the words, so it falls back to its name", () => {
  assert.equal(
    analysisAskSaid({ title: "A warm grey paper texture (crop 2)", origin: "GENERATED" }),
    'Analyze this reference. This picture was drawn by an image model rather than shot. It is filed as "A warm grey paper texture (crop 2)".',
  );
  assert.equal(
    analysisAskSaid({ origin: "GENERATED", generationPrompt: "   " }),
    "Analyze this reference. This picture was drawn by an image model rather than shot.",
  );
});
