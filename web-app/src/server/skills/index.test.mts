import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { SKILLS, SKILL_NAMES, isSkillName, skillCatalogue, skillNamed } from "./index";
import { SKILL_CHAR_BUDGET } from "./skill";

/// The registry, and §V.3's three rules held against every skill in it.
///
/// The rules are not shapes and the type cannot carry them, so they are here:
/// a skill reaches the model with the authority of a system prompt, and one
/// that tells the agent how to behave is a second, unversioned instruction that
/// only the turns which fetched it get. Review catches that in the first
/// thirteen files and not in the twentieth.
///
/// All sixteen are written now, so this file names them: §V.2's list is the
/// contract and a seventeenth added without a line here is a skill nobody
/// reviewed against the three rules.

const skills = SKILL_NAMES.map((name) => SKILLS[name]);

test("the registry's keys are the skills' own names", () => {
  for (const name of SKILL_NAMES) assert.equal(SKILLS[name].name, name);
});

test("a skill lives in the directory it is named after (§V.1)", () => {
  for (const name of SKILL_NAMES) {
    assert.ok(existsSync(`src/server/skills/${name}/skill.ts`), `${name} has no directory`);
  }
});

const TRADES = [
  "wedding-designer",
  "banner-designer",
  "album-designer",
  "book-designer",
  "editorial-designer",
  "poster-designer",
  "packaging-designer",
  "presentation-designer",
  "logo-designer",
  "brand-designer",
  "art-director",
  "lettering-artist",
  "printmaker",
  "photographer",
  "illustrator",
  "digital-artist",
  "concept-artist",
  "character-artist",
  "environment-artist",
  "comic-artist",
  "storyboard-artist",
  "animator",
  "motion-designer",
  "3d-artist",
  "cinematographer",
  "production-designer",
  "screen-designer",
  "ux-designer",
  "industrial-designer",
  "architect",
  "interior-stylist",
  "exhibition-designer",
  "fashion-stylist",
  "textile-designer",
  "collage-artist",
  "floral-designer",
  "tattoo-artist",
];

const GENERAL = [
  "colour-theory",
  "composition",
  "typography",
  "visual-hierarchy",
  "light-and-shadow",
  "grid-systems",
  "depth-and-space",
  "style-and-period",
  "texture-and-materials",
  "type-and-image",
  "type-faces-display",
  "type-faces-text",
  "type-faces-voice",
  "colour-grading",
  "focal-point",
  "shape-and-form",
];

test("§V.2's names are registered, and nothing else is", () => {
  assert.deepEqual(SKILL_NAMES.slice().sort(), [...TRADES, ...GENERAL].sort());
  assert.equal(skills.filter((skill) => skill.kind === "occupation").length, TRADES.length);
  assert.equal(skills.filter((skill) => skill.kind === "foundation").length, GENERAL.length);
});

/// §V.2's split is the reason there are two kinds at all: an occupation says
/// what a *trade* does and a foundation says what *design* does, and a wedding
/// skill that re-taught colour theory would be the same six paragraphs in seven
/// files. Naming the sides here is what stops the next occupation being written
/// as a foundations digest.
test("the occupations are the trades and the foundations are the general knowledge", () => {
  const kinds = Object.fromEntries(skills.map((skill) => [skill.name, skill.kind]));
  for (const trade of TRADES) assert.equal(kinds[trade], "occupation", trade);
  for (const general of GENERAL) assert.equal(kinds[general], "foundation", general);
});

/// §V.2's catalogue column, held against the writing. A thin file passes every
/// other test here — it has a name, a kind, a summary and enough characters —
/// so the only check that catches a file written in a hurry is whether each one
/// covers what its row says it covers. These are the nouns of the trade, not
/// phrasing: a rewrite that still teaches the same trade keeps them.
///
/// `whole frame`, `row` and `foot` are here for a specific reason: the first
/// run of the fixture set (§VIII) found every design leaving the bottom of its
/// page bare, and the answer to that went into `composition` and `grid-systems`
/// as design writing rather than into the instruction as a rule. Losing it
/// should fail something.
const COVERS: Record<string, string[]> = {
  "wedding-designer": ["invitation", "save-the-date", "welcome sign", "seating chart", "menu"],
  "banner-designer": ["leaderboard", "safe area", "call to action", "90"],
  "album-designer": ["spread", "gutter", "sequencing", "bleed"],
  "book-designer": ["margin", "measure", "leading", "running head", "spine"],
  "editorial-designer": ["spread", "opener", "pull quote", "flat plan", "cover line"],
  "poster-designer": ["distance", "hierarchy", "scale", "margin", "thumbnail"],
  "packaging-designer": ["dieline", "bleed", "barcode", "shelf", "fold"],
  "presentation-designer": ["slide", "headline", "chart", "template", "24"],
  "logo-designer": ["reduction", "counter", "clear space", "monogram", "silhouette"],
  "brand-designer": ["palette", "type stack", "guideline", "photographic", "neutral"],
  "art-director": ["casting", "treatment", "reference", "hero", "aspect ratio"],
  "lettering-artist": ["stroke", "monogram", "ligature", "spacing", "skeleton"],
  printmaker: ["separation", "registration", "overprint", "screen printing", "paper"],
  photographer: ["focal length", "aperture", "depth of field", "back light", "crop"],
  illustrator: ["brief", "spot", "thumbnail", "palette", "sketch"],
  "digital-artist": ["value", "edges", "saturation", "highlight"],
  "concept-artist": ["silhouette", "orthographic", "callout", "scale reference"],
  "character-artist": ["silhouette", "shape language", "proportion", "turnaround", "expression"],
  "environment-artist": ["scale", "atmospheric perspective", "foreground", "staging"],
  "comic-artist": ["panel", "gutter", "page turn", "balloon", "reading order"],
  "storyboard-artist": ["shot size", "screen direction", "continuity", "animatic", "close-up"],
  animator: ["timing", "spacing", "arc", "anticipation", "key"],
  "motion-designer": ["easing", "stagger", "anticipation", "millisecond", "legible"],
  "3d-artist": ["topology", "roughness", "material", "render", "light"],
  cinematographer: ["aspect ratio", "focal length", "depth of field", "grade", "movement"],
  "production-designer": ["set", "dressing", "palette", "location", "lens"],
  "screen-designer": ["breakpoint", "viewport", "fold", "touch", "focus"],
  "ux-designer": ["flow", "information architecture", "wireframe", "error", "form"],
  "industrial-designer": ["ergonomic", "draft", "radii", "prototype", "finish"],
  architect: ["plan", "section", "elevation", "circulation", "daylight"],
  "interior-stylist": ["material", "ambient", "scale", "rug", "eye level"],
  "exhibition-designer": [
    "viewing distance",
    "eye level",
    "wayfinding",
    "sightline",
    "circulation",
  ],
  "fashion-stylist": ["silhouette", "fabric", "colourway", "fit", "lookbook"],
  "textile-designer": ["repeat", "half-drop", "colourway", "motif", "scale"],
  "collage-artist": ["juxtaposition", "edge", "scale", "ground", "layering"],
  "floral-designer": ["focal", "vessel", "seasonal", "texture", "proportion"],
  "tattoo-artist": ["flow", "line weight", "negative space", "ageing", "placement"],
  "colour-theory": ["hue", "value", "saturation", "complementary", "temperature"],
  composition: ["thirds", "leading line", "balance", "negative space", "whole frame"],
  typography: ["leading", "tracking", "measure", "pairing", "x-height"],
  "visual-hierarchy": ["first", "second", "contrast", "weight", "position", "distance"],
  "light-and-shadow": ["key", "fill", "hard", "soft", "direction"],
  "grid-systems": ["column", "gutter", "module", "baseline", "margin", "row", "foot"],
  "depth-and-space": ["overlap", "perspective", "atmospheric", "figure and ground", "foreground"],
  "style-and-period": ["bauhaus", "art deco", "swiss", "palette", "pastiche"],
  "texture-and-materials": ["sheen", "matt", "gloss", "grain", "coated"],
  "type-and-image": ["contrast", "scrim", "legibility", "caption", "reversed"],
  "type-faces-display": ["playfair", "bebas", "condensed", "script", "slab"],
  "type-faces-text": ["inter", "garamond", "x-height", "monospace", "weights"],
  "type-faces-voice": ["pairing", "italic", "700", "luxury", "editorial"],
  "colour-grading": ["black point", "cast", "split toning", "contrast curve", "skin"],
  "focal-point": ["gaze", "sharpest", "face", "crop", "quiet areas"],
  "shape-and-form": ["silhouette", "circle", "triangle", "corner", "organic", "container"],
};

test("every registered skill has a row saying what it covers", () => {
  assert.deepEqual(Object.keys(COVERS).sort(), SKILL_NAMES.slice().sort());
});

test("each skill covers what its §V.2 row says it covers", () => {
  for (const [name, words] of Object.entries(COVERS)) {
    /// Line breaks folded out first: the writing is wrapped at a column, so a
    /// two-word noun of the trade falls across a newline about a third of the
    /// time and a raw `includes` would be asserting where the wrap landed.
    const text = SKILLS[name as keyof typeof SKILLS].text.toLowerCase().replace(/\s+/g, " ");
    for (const word of words) assert.ok(text.includes(word), `${name} never mentions ${word}`);
  }
});

test("occupations stand before foundations in the catalogue's order", () => {
  const ranks = skills.map((skill) => (skill.kind === "occupation" ? 0 : 1));
  assert.deepEqual(ranks.slice().sort(), ranks);
});

test("every skill has a title and a one-line summary", () => {
  for (const skill of skills) {
    assert.ok(skill.title.length > 0, `${skill.name} has no title`);
    assert.ok(!skill.summary.includes("\n"), `${skill.name}'s summary is more than a line`);
    assert.ok(skill.summary.length <= 140, `${skill.name}'s summary is a paragraph`);
    assert.ok(skill.summary.endsWith("."), `${skill.name}'s summary is not a sentence`);
  }
});

/// A skill is a page of writing, not a book (§IV.5). The excerpt exists for the
/// day one of them grows past this; a skill that needs it as written is one
/// that was already answering with a cut said out loud on every call.
test("no skill is written past the budget that would cut it", () => {
  for (const skill of skills) {
    assert.ok(skill.text.length <= SKILL_CHAR_BUDGET, `${skill.name} is ${skill.text.length}`);
    assert.ok(skill.text.length > 1500, `${skill.name} is a stub at ${skill.text.length}`);
  }
});

/// §V.3, first rule: no instructions to the agent. Second person is the tell —
/// prose that addresses a reader is prose telling somebody what to do, and
/// §II.6's loop discipline is the one place that is allowed to.
test("no skill addresses the agent or names it", () => {
  for (const skill of skills) {
    assert.doesNotMatch(skill.text, /\byou\b|\byour\b|\byou're\b/i, `${skill.name}`);
    assert.doesNotMatch(skill.text, /\bthe (agent|model|assistant)\b/i, `${skill.name}`);
  }
});

/// §V.3, second rule: nothing about this project. A skill is the same text for
/// every project, which is the whole reason it can be a file.
test("no skill knows what project it is in", () => {
  for (const skill of skills) {
    for (const word of ["vibes-ai", "moodboard", "gallery", "the user", "objectId", "imageId"]) {
      assert.ok(!skill.text.toLowerCase().includes(word.toLowerCase()), `${skill.name}: ${word}`);
    }
  }
});

/// §V.3, third rule: no tool names. The toolset changes and the registry
/// should not — a skill naming a tool is a file that goes stale the first time
/// one is renamed, and nothing would say so.
test("no skill names a tool", () => {
  const tools = [
    "read_canvas",
    "put_on_canvas",
    "transform_on_canvas",
    "reorder_on_canvas",
    "remove_from_canvas",
    "get_page",
    "duplicate_page",
    "resize_page",
    "move_to_page",
    "discard_page",
    "list_gallery",
    "get_image",
    "get_modification",
    "discard_image",
    "generate_image",
    "crop_image",
    "get_skills",
    "design_page",
    "compose_moodboard",
  ];
  for (const skill of skills) {
    for (const tool of tools) assert.ok(!skill.text.includes(tool), `${skill.name}: ${tool}`);
  }
});

test("the catalogue is one line per skill, each carrying its summary (§IV.5)", () => {
  const lines = skillCatalogue().split("\n");
  assert.equal(lines.length, SKILL_NAMES.length);
  for (const [index, name] of SKILL_NAMES.entries()) {
    assert.ok(lines[index]!.startsWith(`${name} — `));
    assert.ok(lines[index]!.endsWith(SKILLS[name].summary));
  }
});

test("a name the registry does not hold is answered as unheld, not thrown at", () => {
  assert.equal(skillNamed("interior-designer"), undefined);
  assert.equal(isSkillName("interior-designer"), false);
  assert.equal(skillNamed("colour-theory"), SKILLS["colour-theory"]);
  assert.equal(isSkillName("colour-theory"), true);
});

/// `Object.hasOwn` rather than `in`, because `in` answers for the prototype:
/// a model asking for "toString" would be handed a function otherwise.
test("an inherited property is not a skill name", () => {
  assert.equal(isSkillName("toString"), false);
  assert.equal(skillNamed("constructor"), undefined);
});
