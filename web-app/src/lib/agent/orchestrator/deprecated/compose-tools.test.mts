import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COMPOSE_MOODBOARD,
  composeMoodboardFor,
} from "@/lib/agent/orchestrator/deprecated/compose-tools";
import { LAYOUT_REQUESTS, LAYOUTS_WITH_TEXT } from "@/lib/layout/moodboard-layouts";

const declared = (state: { photographs?: number; crops?: number; boards?: number }) => {
  const tool = composeMoodboardFor({ photographs: 0, crops: 0, boards: 0, ...state });
  return {
    description: tool.description,
    properties: tool.parameters.properties as Record<
      string,
      { description?: string; type?: string } | undefined
    >,
  };
};

test("compose_moodboard only offers templates that exist, plus RANDOM", () => {
  assert.equal(COMPOSE_MOODBOARD.name, "compose_moodboard");

  const properties = COMPOSE_MOODBOARD.parameters.properties as Record<
    string,
    { enum?: string[]; description?: string }
  >;
  assert.deepEqual(properties.layout?.enum, [...LAYOUT_REQUESTS]);

  for (const id of LAYOUTS_WITH_TEXT) {
    assert.match(String(properties.layout?.description), new RegExp(id));
  }
  assert.match(String(properties.layout?.description), /leaves the line off the board/);
});

test("compose_moodboard asks for the intention and takes a board to rebuild", () => {
  assert.deepEqual(COMPOSE_MOODBOARD.parameters.required, ["intention"]);

  const properties = COMPOSE_MOODBOARD.parameters.properties as Record<string, unknown>;
  assert.ok(properties.boardId, "a board can be named to rebuild");
  assert.ok(properties.addReferenceIds, "a picture can be put on a board");
  assert.ok(properties.removeReferenceIds, "a picture can be taken off a board");
});

test("compose_moodboard says which of its page parameters replaces a page and which adds one", () => {
  const properties = declared({ photographs: 4, boards: 1 }).properties;

  assert.equal(properties.newPage?.type, "BOOLEAN");
  assert.match(String(properties.newPage?.description), /page of its own/);
  assert.match(String(properties.newPage?.description), /moved or written over/);
  assert.match(String(properties.pageId?.description), /newPage/);
});

test("compose_moodboard says a page name on its own renames the page and lays nothing out", () => {
  const properties = declared({ photographs: 4, boards: 1 }).properties;

  assert.equal(properties.pageName?.type, "STRING");
  assert.match(String(properties.pageName?.description), /newPage it names the page being added/);
  assert.match(String(properties.pageName?.description), /renames that page/);
  assert.match(String(properties.pageName?.description), /nothing on the page moves/);
  assert.match(String(properties.pageName?.description), /add_page/);
});

test("the rebuild half of compose_moodboard arrives with the first board", () => {
  const before = declared({ photographs: 4 });
  for (const key of [
    "boardId",
    "pageId",
    "newPage",
    "pageName",
    "addReferenceIds",
    "removeReferenceIds",
    "addCaptions",
    "removeCaptions",
  ]) {
    assert.ok(!before.properties[key], `${key} is not offered before there is a board`);
  }
  assert.ok(!before.description.includes("rebuild"));
  assert.ok(!before.properties.captions?.description?.includes("rebuild"));

  const after = declared({ photographs: 4, boards: 1 });
  for (const key of [
    "boardId",
    "pageId",
    "newPage",
    "pageName",
    "addReferenceIds",
    "removeReferenceIds",
    "addCaptions",
    "removeCaptions",
  ]) {
    assert.ok(after.properties[key], `${key} is offered once a board exists`);
  }
});
