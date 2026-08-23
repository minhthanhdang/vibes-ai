/// What the designs already run came to. `npm run design:runs`, or
/// `npm run design:runs -- <projectId>` for one project's.
///
/// `npm run spend` reads the same table and asks what a turn cost;
/// `npm run design:fixtures` spends real money to make three more designs. This
/// asks the third question, which is free: of the designs already on this
/// database, what did they *do* — how many rounds, how many pictures, how many
/// draws, and how many of those draws were already in the bucket.
///
/// compositor-v2.md §VIII names two of these as the reading to take before
/// moving a ceiling. "Measure the cache hit rate before the render time", of
/// `renderForModel`'s per-revision cache; and, of `DESIGNER_PICTURE_LIMIT`,
/// "watch the `AgentRun` rows before raising it". `design.ts` has been writing
/// both onto every run row since the tally landed and nothing has read them
/// back — a ceiling argued from the last design somebody watched is a ceiling
/// set by anecdote.
///
/// It asks one more thing the spec does not: which of §V's thirteen skills the
/// designs were taught. Same shape of question as the declarations at the
/// bottom — thirteen summaries ride in `get_skill`'s description on every round
/// of every design, and at most three of the thirteen are ever opened.

import { config } from "dotenv";

import { AgentKind } from "../src/generated/prisma/enums";
import { designRunsRead, type CeilingRead } from "../src/lib/agent/designer/design-runs";
import { formatCost, spendSummary } from "../src/lib/agent/shared/model-cost";
import { designerToolsets } from "../src/server/agents/designer/design";
import { DESIGNER_PICTURE_LIMIT, DESIGNER_ROUND_LIMIT } from "../src/server/agents/designer/loop";
import { closeDb, db } from "../src/server/db";
import { SKILL_NAMES } from "../src/server/skills";

config({ path: ".env.local" });
config({ path: ".env" });

const projectId = process.argv[2];

const percent = (share: number) => `${Math.round(share * 100)}%`;

/// A ceiling as one line: what it is, what the designs came to under it, and how
/// many reached it. The last number is the one that decides whether the ceiling
/// is doing anything — a limit no run has ever touched is a limit nobody can
/// argue about from these rows.
const ceilingLine = (label: string, read: CeilingRead) =>
  [
    `  ${label.padEnd(10)}`,
    `limit ${String(read.limit).padStart(2)}`,
    `max ${String(read.max).padStart(2)}`,
    `mean ${read.mean.toFixed(1).padStart(4)}`,
    `${read.atLimit} of ${read.runs} at the limit`,
  ].join("  ");

try {
  const rows = await db.agentRun.findMany({
    where: { agent: AgentKind.DESIGNER, ...(projectId && { projectId }) },
    select: {
      status: true,
      output: true,
      model: true,
      promptTokens: true,
      outputTokens: true,
      totalTokens: true,
    },
    orderBy: { startedAt: "asc" },
  });

  console.log(projectId ? `project ${projectId}` : "every project on this database");
  if (!rows.length) {
    console.log("no designs on this database — run npm run design:check first");
    process.exit(0);
  }

  const read = designRunsRead(rows, {
    rounds: DESIGNER_ROUND_LIMIT,
    pictures: DESIGNER_PICTURE_LIMIT,
  });
  const { total } = spendSummary(rows.map((row) => ({ ...row, agent: "DESIGNER" })));

  console.log(
    `${read.runs} designs — ${read.byStatus.map(({ status, runs }) => `${runs} ${status}`).join(", ")}`,
  );
  console.log(`${formatCost(total.costMicros)} across all of them\n`);

  console.log("the per-call ceilings (§VII):");
  console.log(ceilingLine("rounds", read.rounds));
  console.log(`  ${" ".repeat(10)}${read.stoppedOnRounds} stopped mid-work by it`);
  console.log(ceilingLine("pictures", read.pictures));
  console.log(
    `  ${" ".repeat(10)}${read.picturesRefused} refused by it, ${read.picturesDropped} dropped by PICTURE_WINDOW`,
  );

  /// The §VIII reading, said in the order the risk says to read it: the hit rate
  /// first, because a cache that never hits makes the render time a per-look
  /// cost rather than a per-revision one.
  const { renders } = read;
  console.log("\nwhat the looking cost the bucket (§VIII):");
  console.log(
    `  ${renders.runs} of ${read.runs} designs drew at all, ${renders.made + renders.cached + renders.failed} draws between them`,
  );
  console.log(
    `  ${renders.made} made, ${renders.cached} cached, ${renders.failed} failed` +
      (renders.hitRate === null ? "" : ` — ${percent(renders.hitRate)} hit rate`),
  );

  console.log("\nwhat the rounds were spent on:");
  for (const { name, calls, runs } of read.calls) {
    console.log(
      `  ${name.padEnd(20)} ${String(calls).padStart(4)}  in ${String(runs).padStart(3)} of ${read.runs} designs`,
    );
  }

  /// And the other half of the same question. Every declaration is re-sent on
  /// every round of every design — `npm run floor` prices them — so a tool no
  /// design has ever reached for is a bill with nothing on the other side of it.
  /// Asked of `designerToolsets` rather than a list typed here, for the reason
  /// `floor.mts` gives: a tool added to agent 8 should appear below without
  /// anybody remembering to come back.
  const declared = designerToolsets({ db, projectId: projectId ?? "", boardId: "" }).flatMap(
    ({ declarations }) => declarations.map(({ name }) => name),
  );
  const called = new Set(read.calls.map(({ name }) => name));
  const unused = declared.filter((name) => !called.has(name));
  console.log(
    `\n${unused.length} of ${declared.length} declarations no design has ever called:\n  ${unused.join(", ") || "—"}`,
  );

  /// And the same question of §V's thirteen. `get_skill` is one call a design
  /// and three skills a call, so at most three of the thirteen are ever read —
  /// what this says is *which* three, and whether the other ten are summaries
  /// paid for on every round and never opened. Asked of `SKILL_NAMES` for
  /// `designerToolsets`' reason: a skill added to the registry appears below
  /// without anybody remembering to come back.
  const { skills } = read;
  console.log(
    `\nwhat the designs were taught (§V), over the ${skills.runs} of ${read.runs} that recorded it:`,
  );
  if (!skills.runs) {
    console.log("  nothing — no row here carries the key, so run a design and ask again");
  }
  for (const { name, runs } of skills.read) {
    console.log(`  ${name.padEnd(20)} read by ${String(runs).padStart(3)} of ${skills.runs}`);
  }
  if (skills.runs) {
    const opened = new Set(skills.read.map(({ name }) => name));
    const unread = SKILL_NAMES.filter((name) => !opened.has(name));
    console.log(
      `  ${unread.length} of ${SKILL_NAMES.length} skills no design has read:\n    ${unread.join(", ") || "—"}`,
    );
  }
} finally {
  await closeDb();
}
