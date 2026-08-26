/// The fixture set of asks compositor-v2.md §VIII calls for, run for real.
/// `npm run design:fixtures`.
///
///   npm run design:fixtures
///   npm run design:fixtures -- --board <boardId> --only banner
///
/// §VIII's second risk is the one nothing in the system answers: free placement
/// can make an ugly page, and agent 4's layout constants — which made a bad
/// arrangement impossible — are not here. The only guards are the skill, the
/// picture and the second look, and none of the three is assertable. So the
/// spec asks for a fixture set of asks — a welcome sign, a banner, a three-photo
/// spread — kept and eyeballed, and this is that set.
///
/// `npm run design:check` is one ask, typed at the moment somebody wants it;
/// this is the same three asks every time, which is what makes two runs
/// comparable. Each lands on a fresh page (§VI's `newPage`), so a run leaves its
/// pages beside whatever the board already held rather than on top of it, and
/// every page a design made is drawn afterwards and written out to look at.
///
/// The picture written here is an operator looking at their own bucket from
/// their own machine, the way `npm run render:check` and `npm run spend` are.
/// Nothing agent 8 draws is ever shown to a user (§III) and this does not
/// change that.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "dotenv";

import { formatCost, spendSummary } from "../src/lib/agent/shared/model-cost";
import { boardPages, pagesInReadingOrder } from "../src/lib/pages/board-pages";
import { planRead } from "../src/lib/render/plan-read";
import { pageRenderPlan } from "../src/lib/render/render-plan";
import { persistableElements } from "../src/lib/scene/moodboard-scene";
import { designPage } from "../src/server/agents/designer/design";
import { closeDb, db } from "../src/server/db";
import { readObject } from "../src/server/google/storage";
import { generateContent, functionCallsIn } from "../src/server/google/vertex";
import { RENDER_SOURCE_BYTE_LIMIT, renderForModel } from "../src/server/render/for-model";

config({ path: ".env.local" });
config({ path: ".env" });

/// §VIII's three, in its own order and in a director's own words — an ask is
/// the one argument agent 8 cannot read off the board, and a fixture set whose
/// asks read like tool arguments would exercise a model nobody has.
const ASKS = [
  {
    name: "welcome-sign",
    intention:
      "a welcome sign for Amara and Ines's wedding, to stand at the door — their names large, the date and the venue under them, and room around it all",
  },
  {
    name: "banner",
    intention:
      "a wide banner for the studio's spring portrait sessions — one photograph, a headline that fits on one line, and somewhere to click at the end of it",
  },
  {
    name: "photo-spread",
    intention:
      "an album spread of three photographs from this project, one large and two smaller beside it, with a caption under the big one",
  },
] as const;

const argv = process.argv.slice(2);
const valueOf = (flag: string) => {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
};

const boardWanted = valueOf("--board");
const projectWanted = valueOf("--project");
const only = valueOf("--only");
const out = valueOf("--out") ?? ".design-fixtures";

const asks = only ? ASKS.filter(({ name }) => name === only) : ASKS;
if (!asks.length) {
  console.error(`no fixture called ${only} — the set is ${ASKS.map(({ name }) => name).join(", ")}`);
  process.exit(1);
}

const seconds = (from: number) => `${((Date.now() - from) / 1000).toFixed(1)}s`;
const percent = (share: number) => `${(share * 100).toFixed(0)}%`;

/// A call, named — and for `get_skills`, named with what it asked for. Which
/// skills a design read is the first question of any change to one of them, and
/// a log that says only `get_skills` cannot answer it: a paragraph rewritten in
/// `composition` proves nothing against a run that fetched three other files.
function said(call: { name: string; args?: Record<string, unknown> | null }) {
  const asked = call.args?.skills;
  if (call.name !== "get_skills" || !Array.isArray(asked)) return call.name;
  return `${call.name}(${asked.join(",")})`;
}

const BOARD_SCENE_SELECT = {
  projectId: true,
  revision: true,
  elements: true,
  appState: true,
} as const;

const pageIdsOf = (elements: unknown) =>
  new Set(boardPages(persistableElements(elements)).map(({ id }) => id));

/// Which thirds the design actually stands on, in words, and which of them it
/// left bare. The first run of this set found every one of the three asks
/// putting its content in the upper bands and leaving the foot of the page
/// empty; that verdict came from opening three PNGs and it did not survive into
/// the next run as anything but a sentence. `planRead` is the same verdict as a
/// number, so the run after a skill is rewritten can be compared with the run
/// before it (§VIII), and `npm run design:check` prints it on a typed ask too —
/// which is what makes a question about the *wording* of an ask answerable
/// without adding a fourth fixture.
///
/// The baseline, per ask, so the next attempt starts from a number rather than
/// from a memory. The first row is the page the design chose for itself, which
/// is the whole of the flaw and is why it is now printed on every line:
///
///   welcome-sign  1080x1920  13% ink   1% / 38% / 0%   within 33% top, 38% bottom
///   banner         1920x600  60% ink  56% / 69% / 56%  no margin over the floor
///   photo-spread  1920x1080  28% ink  13% / 67% / 4%   within 26% top, 29% bottom
///
/// The banner row is the only one that has ever changed. It read 1920x1080, 22%
/// ink and 28% dead at each end for five attempts running, and moved when the
/// preset dimensions came out of the instruction's page paragraph — the comment
/// above `marginsOf` in `render/plan-read.ts` carries that argument and the two
/// asks it did not move.
///
/// Two things that baseline settled. The ask is not granting the flaw: the
/// welcome sign run without its "and room around it all" clause came back at
/// 3% / 35% / 0%, 13% inked, 32% and 39% — the same page. And the band read
/// alone is too coarse to carry the verdict: it names a bare band on the
/// welcome sign only, and the banner and the spread, which it clears, are the
/// same picture with a caption dipping far enough into the last third to pass.
/// The margin is the number that says one thing about all three.
///
/// A third thing it has now settled, against the run that took the last page
/// size out of every declaration agent 8 reads: the welcome sign is not the
/// banner's failure at a different ask. It came back at 1080x1920 / 13% / 33%
/// and 38% for the fourth time running with no number left anywhere in the
/// prompt, and `design:check` shows it writing `box: [0, 55000, 1920, 56080]`
/// itself rather than putting a page with no box and inheriting the shape of
/// the one before it on this board. A 9:16 door sign is a defensible rectangle;
/// what is wrong with that page is four lines of type set 3.5% and 6.5% of its
/// height tall, which is a scale flaw inside a right frame and not a frame
/// flaw. Chasing the two with one metric is what made them look like one thing.
///
/// That scale flaw now has a number of its own on every line, and the baseline
/// for it is the one above read again through `planRead().typed`:
///
///   welcome-sign  largest type 5% of the frame (96px, the ceiling a put sets)
///   banner        largest type 7% of the frame, 2 sizes, 1.5x apart
///   photo-spread  largest type 2–3% of the frame, one size throughout
///
/// The welcome sign's row says the rest of that sentence now: 5% of a 1080x1920
/// page is 96px, which is `LAYOUT_TEXT_MAX_FONT` and the most `put_on_canvas`
/// will set whatever box it is handed. That row cannot move until the ceiling
/// does, so an attempt at this ask that reads as having changed nothing has to
/// be checked against the star before it is called a failed lever.
///
/// The ceiling is now said in the put's own answer, with the resize that has no
/// ceiling named beside it (`designer/canvas.ts`'s `TYPE_CLAMP_NOTE`), and the
/// welcome sign's row did not move: 1080x1920 / 13% / 1% / 37% / 0% / 33% and
/// 38% / 5% at the ceiling, five rounds, $0.04. The design asked for 103px, was
/// told it had been set at 96 and declined to spend a round on seven per cent,
/// which is a reasonable reading of its own note. The lever this row is waiting
/// for is one that moves the *ask*, which was 5.4% of the frame before any door
/// touched it.
///
/// *Re-taken once the ceiling had a way round it, and the star comes off.* The
/// same ask word for word, on a 1080x1920 page made for it: the design said
/// `fontSize` on every one of its five text puts — 76px for the names, which is
/// *under* the 92 its own box would have derived — then restyled the headline to
/// **100**, and the row reads `largest type 5% of the frame (100px, past the
/// 96px a put sets)`, six rounds, $0.06. So the row moved past the ceiling and
/// the *percentage did not*. That retires the caveat above: 5% was never the
/// clamp binding, and an attempt at this ask that reads as having changed
/// nothing no longer has an alibi. The lever is the ask, as the paragraph above
/// suspected, and §VIII's type-scale flaw has nothing left standing between it
/// and the model's own taste — 512 declared, the field said on every put, and
/// 5% of the frame chosen anyway. The one ask that did move it moved it by
/// *saying so*: "the names as large as the page will carry" came back at 230px,
/// 12% of the frame, which is the largest type any page on this database
/// carries.
///
/// The other half of the same reading is which door it went through.
/// `TYPE_CLAMP_NOTE` had been naming `transform_on_canvas` since before the
/// restyle existed; both live runs raised a size with `restyle_on_canvas` and
/// neither ever reached the clamp, which is what sent that sentence to
/// `canvas.md` §XI.2's amendment.
///
/// It is not a fixture-set finding: `npm run design:pages` says the same thing
/// about all 32 pages with type on them that this database holds, and the
/// argument is above `typeOf` in `render/plan-read.ts` rather than repeated
/// here. The spread's row is the one to watch — a page whose only type is a
/// caption is a page with no hierarchy to read, and the skill it fetches for
/// that ask has a paragraph about exactly that.
///
/// Which skill each ask fetches is no longer an inference: the run row carries
/// it and `npm run design:runs` reads it back. This set asked for its own trade
/// plus `typography` every time, and then `visual-hierarchy` for the sign and
/// the banner and `composition` for the spread. So the paragraph the spread's
/// row is being read against is one the design really has, and `typography` —
/// which is entirely about the ratio between sizes and never about the largest
/// one against its field — is in front of every one of these three pages while
/// it sizes a headline. The run that recorded it: 1080x1920 / 13% / 5% at the
/// ceiling / 1.8x, 1920x600 / 60% / 7% / 1.5x, 1920x1080 / 28% / 3% / one size,
/// six, six and seven rounds, $0.19 for the set.

type Drawn = {
  file: string;
  shape: string;
  landed: string;
  ink: number;
  bands: string;
  framed: string;
  typed: string;
  read: string;
};
type Result = {
  name: string;
  rounds: number;
  line: string;
  costMicros: number | null;
  pages: Drawn[];
};

try {
  const board = await db.moodboard.findFirst({
    where: { ...(boardWanted && { id: boardWanted }), ...(projectWanted && { projectId: projectWanted }) },
    select: { id: true, projectId: true, title: true, revision: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!board) {
    console.error("no board on this database — make one in the app first");
    process.exit(1);
  }

  mkdirSync(out, { recursive: true });
  console.log(
    `project ${board.projectId}\nboard "${board.title || "untitled"}" ${board.id} @${board.revision}\n${asks.length} ask${asks.length === 1 ? "" : "s"} → ${out}/`,
  );

  const results: Result[] = [];

  for (const ask of asks) {
    console.log(`\n${"═".repeat(70)}\n${ask.name}: ${ask.intention}`);

    /// The pages the board already had, taken before the design rather than
    /// after: `design_page` answers with a pageId only when agent 6 named one,
    /// because a design on a fresh page made the page itself with
    /// `put_on_canvas` and the id of it is on the board (`tools.ts`). So the
    /// page this ask produced is the one that was not there a moment ago — and
    /// an ask that made two, as an album spread reasonably does, is two.
    const before = pageIdsOf(
      (await db.moodboard.findUniqueOrThrow({ where: { id: board.id }, select: { elements: true } }))
        .elements,
    );

    let rounds = 0;
    const watched: typeof generateContent = async (model, contents, options) => {
      rounds += 1;
      const parts = contents.flatMap(({ parts }) => parts);
      const pictures = parts.filter((part) => part.fileData || part.inlineData).length;
      const started = Date.now();
      const answer = await generateContent(model, contents, options);
      const calls = functionCallsIn(answer.candidates?.[0]?.content?.parts ?? []);
      console.log(
        `  round ${rounds}  ${pictures} picture${pictures === 1 ? "" : "s"} carried  (${seconds(started)})  ${calls.map(said).join(" ") || "answered"}`,
      );
      return answer;
    };

    const started = Date.now();
    const outcome = await designPage({
      db,
      projectId: board.projectId,
      boardId: board.id,
      intention: ask.intention,
      newPage: true,
      generate: watched,
      render: renderForModel,
    });

    if (!("line" in outcome)) {
      console.log(`  refused: ${outcome.error}`);
      results.push({ name: ask.name, rounds, line: `refused: ${outcome.error}`, costMicros: 0, pages: [] });
      continue;
    }

    const run = await db.agentRun.findUniqueOrThrow({
      where: { id: outcome.runId },
      select: { model: true, promptTokens: true, outputTokens: true, totalTokens: true, agent: true, output: true },
    });
    const spend = spendSummary([run]);

    console.log(`  line: ${outcome.line}`);
    console.log(`  called: ${outcome.calls.join(", ") || "nothing"}${outcome.stopped ? `  (stopped: ${outcome.stopped})` : ""}`);
    console.log(`  run ${outcome.runId} (${seconds(started)}): ${JSON.stringify(run.output)}  ${formatCost(spend.total.costMicros)}`);

    const result: Result = {
      name: ask.name,
      rounds,
      line: outcome.line,
      costMicros: spend.total.costMicros,
      pages: [],
    };
    results.push(result);

    /// Read after the design rather than during it: the scene the pictures are
    /// of is the one the design left behind, and a render taken mid-loop is a
    /// page halfway through being written.
    const after = await db.moodboard.findUniqueOrThrow({
      where: { id: board.id },
      select: BOARD_SCENE_SELECT,
    });
    const elements = persistableElements(after.elements);
    const pages = pagesInReadingOrder(boardPages(elements));
    const made = outcome.pageId
      ? pages.filter(({ id }) => id === outcome.pageId)
      : pages.filter(({ id }) => !before.has(id));

    if (!made.length) {
      console.log("  no page — the design ended without one on the board");
      continue;
    }

    for (const [at, page] of made.entries()) {
      const drawn = await renderForModel({ boardId: board.id, pageId: page.id, scene: after });
      if ("failed" in drawn) {
        console.log(`  page ${page.id} not drawn: ${drawn.reason}`);
        continue;
      }

      const stem = made.length > 1 ? `${ask.name}-${at + 1}` : ask.name;
      const file = join(out, `${stem}@${drawn.revision}.png`);
      writeFileSync(file, await readObject(drawn.uri, RENDER_SOURCE_BYTE_LIMIT));

      const read = planRead(
        pageRenderPlan(elements, page, {
          background: (after.appState as { viewBackgroundColor?: unknown } | null)
            ?.viewBackgroundColor,
        }),
      );

      result.pages.push({
        file,
        shape: read.shape,
        landed: read.landed,
        ink: read.ink,
        bands: read.standing,
        framed: read.framed,
        typed: read.typed,
        read: read.read,
      });
      console.log(
        `  page ${page.id}${page.name ? ` "${page.name}"` : ""} @${drawn.revision} ${drawn.drawn}: ${read.shape}, ${read.landed}, ${percent(read.ink)} of the page inked${drawn.undrawn.length ? `, not drawn: ${drawn.undrawn.map(({ type }) => type).join(", ")}` : ""}`,
      );
      console.log(`  stands on ${read.standing}`);
      if (read.framed) console.log(`  ${read.framed}`);
      if (read.typed) console.log(`  ${read.typed}`);
      if (read.read) console.log(`  ${read.read}`);
      console.log(`  ${file}`);
    }
  }

  console.log(`\n${"═".repeat(70)}\nlook at these before raising anything (§VIII):`);
  console.log(
    ["ask".padEnd(14), "rounds".padStart(7), "cost".padStart(8), "page".padStart(10), "ink".padStart(5), "stands on"].join(" "),
  );
  for (const result of results) {
    if (!result.pages.length) {
      console.log([result.name.padEnd(14), String(result.rounds).padStart(7), formatCost(result.costMicros).padStart(8), "—".padStart(10), "—".padStart(5), result.line].join(" "));
      continue;
    }
    for (const [at, page] of result.pages.entries()) {
      console.log(
        [
          (at ? "" : result.name).padEnd(14),
          (at ? "" : String(result.rounds)).padStart(7),
          (at ? "" : formatCost(result.costMicros)).padStart(8),
          page.shape.padStart(10),
          percent(page.ink).padStart(5),
          `${page.bands}${page.framed ? `\n${"".padEnd(48)}${page.framed}` : ""}${page.typed ? `\n${"".padEnd(48)}${page.typed}` : ""}\n${"".padEnd(48)}${page.landed}  ${page.file}`,
        ].join(" "),
      );
    }
  }
  /// Null-poisoned the way `spendSummary` itself is: a model with no price in
  /// the table makes the total unknown rather than makes it smaller.
  const totalMicros = results.reduce<number | null>(
    (sum, { costMicros }) => (sum === null || costMicros === null ? null : sum + costMicros),
    0,
  );
  console.log(`\n${formatCost(totalMicros)} for ${results.length} design${results.length === 1 ? "" : "s"}`);
} finally {
  await closeDb();
}
