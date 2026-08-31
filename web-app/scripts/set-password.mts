import { config } from "dotenv";

import { closeDb, db } from "../src/server/db";
import { hashPassword } from "../src/server/auth/password";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../src/lib/limits/password-rules";

config({ path: ".env.local" });
config({ path: ".env" });

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("usage: set-password <email> <password>");
  process.exit(1);
}
if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
  console.error(
    `a password is ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters, and that one is ${password.length}`,
  );
  process.exit(1);
}

const before = await db.user.findUnique({
  where: { email: email.toLowerCase() },
  select: { id: true, googleId: true, passwordHash: true },
});
if (!before) {
  console.error(`no account for ${email}`);
  process.exit(1);
}

await db.user.update({
  where: { id: before.id },
  data: { passwordHash: await hashPassword(password) },
});

const doors = [before.googleId && "Google", "password"].filter(Boolean).join(" and ");
console.log(
  `${email}: ${before.passwordHash ? "password replaced" : "password set"} — signs in with ${doors}`,
);
await closeDb();
