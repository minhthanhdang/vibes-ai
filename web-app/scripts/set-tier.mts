import { config } from "dotenv";

import { closeDb, db } from "../src/server/db";
import { AccountTier } from "../src/generated/prisma/enums";

config({ path: ".env.local" });
config({ path: ".env" });

const args = process.argv.slice(2);
const resetBoards = args.includes("--reset-boards");
const [email, asked] = args.filter((arg) => !arg.startsWith("--"));
if (!email || !asked) {
  console.error("usage: set-tier <email> <TIER_1|TIER_2|TIER_3> [--reset-boards]");
  process.exit(1);
}
if (!(asked in AccountTier)) {
  console.error(`${asked} is not a tier — one of ${Object.keys(AccountTier).join(", ")}`);
  process.exit(1);
}

const before = await db.user.findUnique({ where: { email }, select: { tier: true } });
if (!before) {
  console.error(`no account for ${email}`);
  process.exit(1);
}

const after = await db.user.update({
  where: { email },
  data: { tier: asked as keyof typeof AccountTier, ...(resetBoards && { vibesBoardsUsed: 0 }) },
  select: { email: true, tier: true, vibesBoardsUsed: true },
});
console.log(
  `${after.email}: ${before.tier} -> ${after.tier} (boards used ${after.vibesBoardsUsed}${resetBoards ? ", reset" : ""})`,
);
await closeDb();
