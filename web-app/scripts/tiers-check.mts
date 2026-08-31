import { config } from "dotenv";

import { closeDb, db } from "../src/server/db";

config({ path: ".env.local" });
config({ path: ".env" });

const users = await db.user.findMany({
  select: { email: true, tier: true, vibesBoardsUsed: true, googleId: true, passwordHash: true },
  orderBy: { createdAt: "asc" },
});
for (const user of users) {
  console.log(
    `${user.tier}  boards=${user.vibesBoardsUsed}  google=${user.googleId ? "yes" : "no "}  password=${user.passwordHash ? "yes" : "no "}  ${user.email}`,
  );
}
console.log(`${users.length} accounts`);
await closeDb();
