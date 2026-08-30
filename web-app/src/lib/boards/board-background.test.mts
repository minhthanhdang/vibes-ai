import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CANVAS_BACKGROUND_DEFAULT,
  canvasBackgroundColour,
  setCanvasBackground,
} from "@/lib/boards/board-background";

test("a hex paints the board and is written back normalised", () => {
  const edit = setCanvasBackground({ appState: {}, colour: "#0C111C" });

  assert.ok(edit);
  assert.equal(edit.colour, "#0c111c");
  assert.equal(edit.was, null);
  assert.equal(edit.appState?.viewBackgroundColor, "#0c111c");
});

test("the palette's own spellings are colours here", () => {
  assert.equal(setCanvasBackground({ appState: {}, colour: "0c111c" })?.colour, "#0c111c");
  assert.equal(
    setCanvasBackground({ appState: { viewBackgroundColor: "#000000" }, colour: " #F4E " })?.colour,
    "#ff44ee",
  );
});

test("default drops the key rather than writing white over it", () => {
  const edit = setCanvasBackground({
    appState: { viewBackgroundColor: "#0c111c", gridSize: 20 },
    colour: CANVAS_BACKGROUND_DEFAULT,
  });

  assert.ok(edit);
  assert.equal(edit.colour, null);
  assert.equal(edit.was, "#0c111c");
  assert.equal("viewBackgroundColor" in edit.appState!, false);
  assert.equal(edit.appState?.gridSize, 20);
});

test("a repaint that moves no pixel asks for no write", () => {
  const same = setCanvasBackground({
    appState: { viewBackgroundColor: "#0c111c" },
    colour: "#0C111C",
  });
  assert.equal(same?.appState, null);
  assert.equal(same?.colour, "#0c111c");
  assert.equal(same?.was, "#0c111c");

  assert.equal(
    setCanvasBackground({ appState: {}, colour: CANVAS_BACKGROUND_DEFAULT })?.appState,
    null,
  );
  assert.equal(setCanvasBackground({ appState: {}, colour: "#ffffff" })?.appState, null);
  assert.equal(
    setCanvasBackground({ appState: { viewBackgroundColor: "#ffffff" }, colour: "default" })
      ?.appState,
    null,
  );
});

test("anything that is not a hex or default is refused rather than guessed at", () => {
  for (const colour of ["warm sand", "", "  ", "#12345", "rgb(0,0,0)", null, 12, undefined]) {
    assert.equal(setCanvasBackground({ appState: {}, colour }), null, String(colour));
  }
  assert.ok(setCanvasBackground({ appState: { viewBackgroundColor: "#000" }, colour: "Default" }));
});

test("the appState it hands back is the allowlisted one", () => {
  const edit = setCanvasBackground({
    appState: { viewBackgroundColor: "#fff", zenModeEnabled: true, selectedElementIds: { a: true } },
    colour: "#0c111c",
  });

  assert.ok(edit);
  assert.equal(edit.appState?.zenModeEnabled, true);
  assert.equal("selectedElementIds" in edit.appState!, false);
});

test("the colour a board stands on is read back as null when nobody has painted it", () => {
  assert.equal(canvasBackgroundColour({}), null);
  assert.equal(canvasBackgroundColour(null), null);
  assert.equal(canvasBackgroundColour({ viewBackgroundColor: "transparent" }), null);
  assert.equal(canvasBackgroundColour({ viewBackgroundColor: "#0C111C" }), "#0c111c");
});
