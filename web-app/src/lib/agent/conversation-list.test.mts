import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CONVERSATION_TITLE_LIMIT,
  NEW_CHAT_TITLE,
  conversationAfterRemoval,
  conversationLabel,
  derivedConversationTitle,
  normalizedConversationTitle,
  openConversationId,
  withConversationTitle,
} from "@/lib/agent/conversation-list";

const NOTHING = new Set<string>();

const said = (text: string) => [{ type: "text", text }];

test("a thread with no written title is named by its own first user message", () => {
  assert.equal(
    conversationLabel({ title: "", firstUserParts: said("Low-key light, deep shadows") }),
    "Low-key light, deep shadows",
  );
});

test("a thread nobody has spoken in reads as a new chat rather than as a blank row", () => {
  assert.equal(conversationLabel({ title: "" }), NEW_CHAT_TITLE);
  assert.equal(conversationLabel({ title: "", firstUserParts: [] }), NEW_CHAT_TITLE);
});

test("a title is cut at a word boundary and marked where it was cut", () => {
  const long =
    "A gloomy historical mansion at dusk, low-key light, deep shadows and a very long corridor";
  const title = derivedConversationTitle(long);

  assert.ok(title.length <= CONVERSATION_TITLE_LIMIT, `${title.length} characters`);
  assert.ok(title.endsWith("…"));
  /// Cut between words, not through one: what is kept is a prefix of the
  /// sentence ending where a space was.
  assert.ok(long.startsWith(title.slice(0, -1)));
  assert.ok(!title.slice(0, -1).endsWith(" "));
  assert.equal(long[title.length - 1], " ");
});

test("a sentence that fits is not cut and carries no ellipsis", () => {
  assert.equal(derivedConversationTitle("A poster for the dusk wedding"), "A poster for the dusk wedding");
});

test("a first word longer than the whole limit is cut through rather than left to overflow", () => {
  const title = derivedConversationTitle("A".repeat(200));
  assert.ok(title.length <= CONVERSATION_TITLE_LIMIT);
  assert.ok(title.endsWith("…"));
});

test("only the first line names it, so a pasted brief is one line in the switcher", () => {
  assert.equal(
    derivedConversationTitle("The brief\n\nThree acts, one location, shot at dusk.\nSecond page."),
    "The brief",
  );
  /// Including when the paste opens with blank lines: the first line that says
  /// anything is the one that names the thread.
  assert.equal(derivedConversationTitle("\n\n  Act two  \nand the rest"), "Act two");
});

test("a first message that is an event rather than a sentence still names the thread", () => {
  /// A cut taken with the column collapsed opens the thread it is recorded in,
  /// and its note is the only thing said in it. `spoken` reads a note the same
  /// way it reads words, so the switcher has a name either way.
  assert.equal(
    conversationLabel({
      title: "",
      firstUserParts: [
        { type: "event", event: "cut_taken", note: "I cut the doorway out of Hall.", payload: null },
      ],
    }),
    "I cut the doorway out of Hall.",
  );
});

test("a hand-written title survives being emptied", () => {
  /// `clear` leaves the row and no messages, so there is no first message to
  /// derive from — and a name the user wrote is about the thread rather than
  /// about the message that started it.
  assert.equal(conversationLabel({ title: "Poster ideas", firstUserParts: [] }), "Poster ideas");
  assert.equal(conversationLabel({ title: "  Poster ideas  " }), "Poster ideas");
});

test("a written title outranks the sentence the thread would derive one from", () => {
  assert.equal(
    conversationLabel({ title: "Act two", firstUserParts: said("Low-key light, deep shadows") }),
    "Act two",
  );
});

test("a part from a build this one has not met leaves the thread named rather than unnamed", () => {
  /// A row is never rejected on read. An unknown part is skipped and the words
  /// beside it still name the thread…
  assert.equal(
    conversationLabel({
      title: "",
      firstUserParts: [{ type: "hologram", frames: 12 }, { type: "text", text: "The dusk wedding" }],
    }),
    "The dusk wedding",
  );
  /// …and a message that is *nothing but* unknown parts reads as a new chat
  /// rather than as an empty row.
  assert.equal(
    conversationLabel({ title: "", firstUserParts: [{ type: "hologram", frames: 12 }] }),
    NEW_CHAT_TITLE,
  );
  /// The same for a payload that is not a part array at all.
  assert.equal(conversationLabel({ title: "", firstUserParts: "the dusk wedding" }), NEW_CHAT_TITLE);
});

test("a rename of nothing but whitespace is a cancelled rename", () => {
  assert.equal(normalizedConversationTitle("   \n  "), null);
  assert.equal(normalizedConversationTitle(""), null);
});

test("a rename is one line, collapsed, and cut to the limit", () => {
  assert.equal(normalizedConversationTitle("  Act   two\nand three  "), "Act two and three");
  assert.equal(normalizedConversationTitle("x".repeat(200)), "x".repeat(CONVERSATION_TITLE_LIMIT));
});

const LIST = [
  { id: "newest", title: "Poster ideas", updatedAt: "2026-08-23" },
  { id: "older", title: "Act two", updatedAt: "2026-08-20" },
];

test("a selection naming a thread since deleted falls back to the most recent", () => {
  assert.equal(openConversationId(LIST, "gone", NOTHING, "fresh"), "newest");
});

test("a project with no selection opens the thread it last spoke in", () => {
  assert.equal(openConversationId(LIST, null, NOTHING, "fresh"), "newest");
  assert.equal(openConversationId(LIST, "older", NOTHING, "fresh"), "older");
});

test("a thread this session minted and has not spoken in yet stays open when it is not in the list", () => {
  /// "New chat" writes no row, so the id is in no list — and the column must
  /// not jump off it the moment the list lands.
  assert.equal(openConversationId(LIST, "unspoken", new Set(["unspoken"]), "fresh"), "unspoken");
});

test("a project with no threads gets a fresh id", () => {
  assert.equal(openConversationId([], null, NOTHING, "fresh"), "fresh");
  /// And so does one whose list has not landed yet, so the column opens on
  /// something rather than on nothing.
  assert.equal(openConversationId(undefined, null, NOTHING, "fresh"), "fresh");
});

test("deleting a thread you are not looking at leaves you where you were", () => {
  assert.equal(conversationAfterRemoval(LIST, "older", "newest"), "newest");
  /// Including when where you were is an unspoken thread that is in no list.
  assert.equal(conversationAfterRemoval(LIST, "older", "unspoken"), "unspoken");
});

test("deleting the open one lands on the most recently updated of the rest", () => {
  assert.equal(conversationAfterRemoval(LIST, "newest", "newest"), "older");
});

test("deleting the last one lands nowhere, and the caller opens a fresh chat", () => {
  assert.equal(conversationAfterRemoval([LIST[0]!], "newest", "newest"), null);
});

test("an optimistic rename rewrites one row and leaves the others alone", () => {
  assert.deepEqual(withConversationTitle(LIST, "older", "Act two, revisited"), [
    LIST[0],
    { id: "older", title: "Act two, revisited", updatedAt: "2026-08-20" },
  ]);
});
