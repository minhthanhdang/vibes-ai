import { test } from "node:test";
import assert from "node:assert/strict";

import { COMPOSE_MOODBOARD } from "@/lib/agent/orchestrator/handoff-tools";
import { LAYOUT_REQUESTS, LAYOUTS_WITH_TEXT,  } from "@/lib/layout/moodboard-layouts";

test("compose_moodboard only offers templates that exist, plus RANDOM", () => {
  assert.equal(COMPOSE_MOODBOARD.name, "compose_moodboard");

  const properties = COMPOSE_MOODBOARD.parameters.properties as Record<
    string,
    { enum?: string[]; description?: string }
  >;
  assert.deepEqual(properties.layout?.enum, [...LAYOUT_REQUESTS]);

  /// Which of them carry a line of text, said before the call rather than
  /// reported after it: naming a template is the one decision the model makes
  /// about a board without being told what is in it, and a headline composed at
  /// a template with no text block comes back as "unplaced" — the same word a
  /// photograph the compositor chose to leave off comes back as.
  for (const id of LAYOUTS_WITH_TEXT) {
    assert.match(String(properties.layout?.description), new RegExp(id));
  }
  assert.match(String(properties.layout?.description), /leaves the line off the board/);
});

/// A rebuild's selection can come off the board itself, so demanding the ids
/// would make the model guess at what it is already holding. Only the intention
/// is genuinely required of both shapes of call.
test("compose_moodboard asks for the intention and takes a board to rebuild", () => {
  assert.deepEqual(COMPOSE_MOODBOARD.parameters.required, ["intention"]);

  const properties = COMPOSE_MOODBOARD.parameters.properties as Record<string, unknown>;
  assert.ok(properties.boardId, "a board can be named to rebuild");
  /// And the two ways of changing what is on it without naming the whole of it —
  /// which the model cannot do, since a board is primed by id and title only.
  assert.ok(properties.addReferenceIds, "a picture can be put on a board");
  assert.ok(properties.removeReferenceIds, "a picture can be taken off a board");
});
