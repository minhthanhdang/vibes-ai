import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Next.js reads .env.local; the Prisma CLI does not load anything on its own in v7.
config({ path: ".env.local" });
config({ path: ".env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
