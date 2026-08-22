import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CANVAS_BACKGROUND_DEFAULT,
  canvasBackgroundColour,
  setCanvasBackground,
} from "@/lib/boards/board-background";

/// canvas.md §XI.3. The board's ground is a field rather than an element, so
/// what there is to get wrong is all in the two lines around the field: which
/// spellings are a colour, and which repaints are worth a revision.

test("a hex paints the board and is written back normalised", () => {
  const edit = setCanvasBackground({ appState: {}, colour: "#0C111C" });

  assert.ok(edit);
  assert.equal(edit.colour, "#0c111c");
  assert.equal(edit.was, null);
  assert.equal(edit.appState?.viewBackgroundColor, "#0c111c");
});

/// The shorthand the palette accepts everywhere else accepts here too — a model
/// that writes `#fff` means white and being refused for it is a round spent on
/// a spelling.
test("the palette's own spellings are colours here", () => {
  assert.equal(setCanvasBackground({ appState: {}, colour: "0c111c" })?.colour, "#0c111c");
  assert.equal(
    setCanvasBackground({ appState: { viewBackgroundColor: "#000000" }, colour: " #F4E " })?.colour,
    "#ff44ee",
  );
});

/// `"default"` is the absence of a stored colour rather than a colour: the key
/// goes, and excalidraw and the renderer both fall back to the same white.
/// Left as `#ffffff` instead, a board would be carrying a colour nobody set and
/// every later "is it painted?" would have to answer yes.
test("default drops the key rather than writing white over it", () => {
  const edit = setCanvasBackground({
    appState: { viewBackgroundColor: "#0c111c", gridSize: 20 },
    colour: CANVAS_BACKGROUND_DEFAULT,
  });

  assert.ok(edit);
  assert.equal(edit.colour, null);
  assert.equal(edit.was, "#0c111c");
  assert.equal("viewBackgroundColor" in edit.appState!, false);
  /// Everything else the board was opened on rides through: this returns a whole
  /// appState for a whole column, so a key dropped here is a setting the user
  /// loses to a repaint.
  assert.equal(edit.appState?.gridSize, 20);
});

/// The no-op, and the reason it is asked against the colour the board is
/// *drawn* on: a board with no stored colour and a board carrying #ffffff are
/// the same white, so both spellings of "leave it as it is" have to be free.
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

/// A word for a colour is not a colour. Refused here as null so the door can say
/// the word back rather than paint the board something nobody asked for.
test("anything that is not a hex or default is refused rather than guessed at", () => {
  for (const colour of ["warm sand", "", "  ", "#12345", "rgb(0,0,0)", null, 12, undefined]) {
    assert.equal(setCanvasBackground({ appState: {}, colour }), null, String(colour));
  }
  /// `"default"` however the model cases it: it is a word this door chose, so
  /// the model's capitalisation of it is not a refusal worth a round.
  assert.ok(setCanvasBackground({ appState: { viewBackgroundColor: "#000" }, colour: "Default" }));
});

/// Written straight into a `Json` column, so what comes out is allowlisted on
/// the way exactly as the tab's own save is — a row carrying a collaborators Map
/// or a megabyte of pasted state does not get it carried forward by a repaint.
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
