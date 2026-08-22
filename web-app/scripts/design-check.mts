/// One real `design_page` call, against Vertex, from the command line.
/// `npm run design:check`.
///
///   npm run design:check -- --board <boardId> "a wedding welcome sign, calligraphic"
///   npm run design:check -- --board <boardId> --page <pageId> --images a,b "tighten this"
///
/// Agent 8 was built with the model call injected — every round of every test in
/// `src/server/agents/designer/` hands `designPage` a `generate` that answers
/// from a script. That is what made twenty-seven iterations of it cost nothing,
/// and it is also the reason nothing here has ever been read by a model: a fake
/// answers with the tool names the test wrote down, so a declaration a real
/// model cannot follow, an ask it reads the wrong way and a picture it cannot
/// see all look identical from inside the suite.
///
/// This is the other half, the way `npm run smoke` is the other half of agent 6:
/// the deliberate call. It runs `designPage` — the same function `design_page`
/// runs behind agent 6's door — and prints the loop from the outside: what each
/// round sent, how many pictures rode on it, what the model asked for, what the
/// bucket was asked to draw, and what the whole thing came to on the
/// `AgentKind.DESIGNER` row it just wrote.
///
/// It writes to a real board, because that is what agent 8 does. With no
/// `--page` it asks for a fresh one (§VI's `newPage`), so the work lands beside
/// what is already on the board rather than on top of it.

import { config } from "dotenv";

import { formatCost, spendSummary } from "../src/lib/agent/model-cost";
import { designPage } from "../src/server/agents/designer/design";
import { closeDb, db } from "../src/server/db";
import { renderForModel } from "../src/server/render/for-model";
import { generateContent, functionCallsIn, textOf, type Content } from "../src/server/google/vertex";

config({ path: ".env.local" });
config({ path: ".env" });

const argv = process.argv.slice(2);
const valueOf = (flag: string) => {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
};

const FLAGS = ["--project", "--board", "--page", "--images"];
const boardWanted = valueOf("--board");
const projectWanted = valueOf("--project");
const pageWanted = valueOf("--page");
const imageIds = (valueOf("--images") ?? "").split(",").filter(Boolean);
const newPage = argv.includes("--new-page") || !pageWanted;

/// Everything that is not a flag or a flag's value is the intention, joined —
/// so a quoted sentence and a bare one both arrive as the user's own words,
/// which is the one argument agent 8 cannot read off the board.
const intention = argv
  .filter((word, at) => !word.startsWith("--") && !FLAGS.includes(argv[at - 1] ?? ""))
  .join(" ")
  .trim();

if (!intention) {
  console.error(
    'usage: npm run design:check -- [--project <id>] [--board <id>] [--page <id>] [--images <id,id>] "<what the design is for>"',
  );
  process.exit(1);
}

const seconds = (from: number) => `${((Date.now() - from) / 1000).toFixed(1)}s`;

/// What a request carries, read off the parts rather than off the loop: the
/// window is the dominant cost lever (§III.1) and the only honest reading of it
/// is the body that really went up.
function sent(contents: Content[]) {
  const parts = contents.flatMap(({ parts }) => parts);
  const pictures = parts.filter((part) => part.fileData || part.inlineData).length;
  const dropped = parts.filter(
    (part) => typeof part.text === "string" && part.text.startsWith("[The picture"),
  ).length;
  return { contents: contents.length, pictures, dropped };
}

/// The shape of the body, one letter per turn and one letter per part. Vertex
/// refuses a request whose last turn is the model's, and a loop that builds its
/// transcript out of two windows and a pinned slice can produce that shape from
/// code that reads correctly — so the shape goes in the log rather than being
/// reconstructed from the error afterwards.
const shape = (contents: Content[]) =>
  contents
    .map(
      ({ role, parts }) =>
        `${role[0]}[${parts
          .map((part) =>
            part.functionCall
              ? "c"
              : part.functionResponse
                ? "r"
                : part.fileData || part.inlineData
                  ? "P"
                  : part.text
                    ? "t"
                    : "?",
          )
          .join("")}]`,
    )
    .join(" ");

const shortly = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 48 ? `${text.slice(0, 45)}…` : text;
};

const named = ({ name, args }: { name: string; args?: Record<string, unknown> }) =>
  `${name}(${Object.entries(args ?? {})
    .map(([key, value]) => `${key}=${shortly(value)}`)
    .join(", ")})`;

let round = 0;

/// The two injected seams, wrapped rather than replaced — everything below runs
/// for real and the wrapper only watches.
const watchedGenerate: typeof generateContent = async (model, contents, options) => {
  round += 1;
  const carried = sent(contents);
  const started = Date.now();
  let answer;
  try {
    answer = await generateContent(model, contents, options);
  } catch (cause) {
    console.log(`\nround ${round} refused by Vertex — sent ${shape(contents)}`);
    throw cause;
  }
  const parts = answer.candidates?.[0]?.content?.parts ?? [];
  const calls = functionCallsIn(parts);
  const text = textOf(parts);

  console.log(
    `\nround ${round}  ${carried.contents} contents, ${carried.pictures} picture${carried.pictures === 1 ? "" : "s"}${carried.dropped ? `, ${carried.dropped} dropped` : ""}  (${seconds(started)})`,
  );
  console.log(`  sent: ${shape(contents)}`);
  if (calls.length) console.log(`  asked: ${calls.map(named).join("  ")}`);
  if (text) console.log(`  said: ${text.trim()}`);
  if (!calls.length && !text) console.log(`  said nothing (${answer.candidates?.[0]?.finishReason})`);
  return answer;
};

const watchedRender: typeof renderForModel = async (request, options) => {
  const started = Date.now();
  const drawn = await renderForModel(request, options);
  const what = request.pageId ? `page ${request.pageId}` : `board ${request.boardId}`;
  console.log(
    "failed" in drawn
      ? `  drew ${what} — refused: ${drawn.reason}`
      : `  drew ${what} @${drawn.revision} ${drawn.drawn} in ${seconds(started)}${drawn.undrawn.length ? ` — not drawn: ${drawn.undrawn.map(({ type }) => type).join(", ")}` : ""}`,
  );
  return drawn;
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

  console.log(
    `project ${board.projectId}\nboard "${board.title || "untitled"}" ${board.id} @${board.revision}`,
  );
  console.log(`asking for: ${intention}${newPage ? "  (on a fresh page)" : ""}`);

  const started = Date.now();
  const outcome = await designPage({
    db,
    projectId: board.projectId,
    boardId: board.id,
    ...(pageWanted && { pageId: pageWanted }),
    intention,
    imageIds,
    newPage,
    generate: watchedGenerate,
    render: watchedRender,
  });

  console.log(`\n${"─".repeat(70)}`);
  if (!("line" in outcome)) {
    console.log(`refused: ${outcome.error}`);
    process.exit(1);
  }

  console.log(`line: ${outcome.line}`);
  console.log(`called: ${outcome.calls.join(", ") || "nothing"}`);
  if (outcome.notFound?.length) console.log(`pictures not in this project: ${outcome.notFound.join(", ")}`);
  if (outcome.stopped) console.log(`stopped: ${outcome.stopped}`);

  /// Read back off the row rather than off the outcome, because the row is what
  /// anybody looking at this design tomorrow will have — a design whose
  /// `renders` say `made` twelve times is one that redrew the board every round
  /// (§VIII), and that is only visible here.
  const run = await db.agentRun.findUniqueOrThrow({
    where: { id: outcome.runId },
    select: { model: true, agent: true, promptTokens: true, outputTokens: true, totalTokens: true, output: true },
  });
  console.log(`\nrun ${outcome.runId} (${seconds(started)}): ${JSON.stringify(run.output)}`);

  const spend = spendSummary([run]);
  console.log(
    `${run.model}  ${spend.total.usage.promptTokens} in ${spend.total.usage.outputTokens} out  ${formatCost(spend.total.costMicros)}`,
  );

  const after = await db.moodboard.findUniqueOrThrow({
    where: { id: board.id },
    select: { revision: true },
  });
  console.log(`board @${board.revision} → @${after.revision}`);
} finally {
  await closeDb();
}
