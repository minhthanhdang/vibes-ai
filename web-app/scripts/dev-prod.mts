import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { config } from "dotenv";

const FILE = ".env.production.local";

if (!existsSync(FILE)) {
  console.error(
    `${FILE} is not there. Put the production values in it — start from\n` +
      "  ./scripts/deploy.sh prod-env --secrets > .env.production.local\n" +
      "and add GOOGLE_OAUTH_CLIENT_SECRET. It is gitignored, and `next dev` never loads it on its own.",
  );
  process.exit(1);
}

config({ path: FILE, override: true, quiet: true });

const dev = spawn("npx", ["next", "dev"], {
  stdio: "inherit",
  env: { ...process.env, PORT: process.env.PORT ?? "12000" },
});

dev.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
