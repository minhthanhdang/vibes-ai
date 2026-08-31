import "server-only";
import { z } from "zod";
import type { AccountTier } from "@/generated/prisma/enums";

const serviceAccountKey = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
  project_id: z.string().min(1),
});

const base = {
  DATABASE_URL: z.string().url(),

  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().transform((raw, ctx) => {
    try {
      return serviceAccountKey.parse(JSON.parse(raw));
    } catch {
      ctx.addIssue({ code: "custom", message: "not a valid service account key JSON" });
      return z.NEVER;
    }
  }),

  GOOGLE_CLOUD_PROJECT: z.string().min(1),

  GOOGLE_CLOUD_LOCATION: z.string().min(1).default("global"),
  GOOGLE_GENAI_USE_ENTERPRISE: z.string().default("1"),

  APP_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:12000"),

  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  AGENT_ENGINE_RESOURCE: z.string().optional(),

  ANALYZER_WORKER_SECRET: z.preprocess(
    (raw) => (typeof raw === "string" && raw.trim() === "" ? undefined : raw),
    z.string().min(16).optional(),
  ),

  VIBES_WORKER_SECRET: z.preprocess(
    (raw) => (typeof raw === "string" && raw.trim() === "" ? undefined : raw),
    z.string().min(16).optional(),
  ),

  JUDGE_SIGNUP_CODES: z.preprocess(
    (raw) => (typeof raw === "string" && raw.trim() === "" ? undefined : raw),
    z
      .string()
      .refine(
        (raw) =>
          raw
            .split(",")
            .map((code) => code.trim())
            .every((code) => code.length >= 24),
        "each comma-separated code must be at least 24 characters",
      )
      .optional(),
  ),

  AGENT_TRANSCRIPT_DIR: z.preprocess(
    (raw) => (typeof raw === "string" && raw.trim() === "" ? undefined : raw),
    z.string().optional(),
  ),
};

const productionSchema = z.object({
  ...base,
  APP_ENV: z.literal("production"),

  CLOUD_SQL_INSTANCE: z.string().min(1),
  CLOUD_SQL_USER: z.string().min(1),
  CLOUD_SQL_PASSWORD: z.string().min(1),
  CLOUD_SQL_DATABASE: z.string().min(1),

  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),

  GCS_BUCKET: z.string().min(1),
});

const developmentSchema = z.object({
  ...base,
  APP_ENV: z.literal("development"),

  DEV_BUCKET: z.string().min(1),
  DEV_SIGNUP_TIER: z.enum(["TIER_1", "TIER_2", "TIER_3"]).default("TIER_1"),
});

const schema = z.discriminatedUnion("APP_ENV", [productionSchema, developmentSchema]);

export type ProdEnv = z.infer<typeof productionSchema>;
export type DevEnv = z.infer<typeof developmentSchema>;
export type Env = z.infer<typeof schema>;

const APP_ENVS = ["development", "production"] as const;

function switched(source: Record<string, string | undefined>) {
  return (APP_ENVS as readonly string[]).includes(source.APP_ENV ?? "");
}

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  if (source.SKIP_ENV_VALIDATION) {
    return source as unknown as Env;
  }
  if (!switched(source)) {
    const said = source.APP_ENV === undefined ? "it is unset" : `it is "${source.APP_ENV}"`;
    throw new Error(
      `Invalid environment:\nAPP_ENV must be development or production — nothing defaults it, and ${said}`,
    );
  }
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv();
  return cached;
}

export function developing(): boolean {
  return env().APP_ENV === "development";
}

export function cloudEnv(): ProdEnv {
  const current = env();
  if (current.APP_ENV === "development") {
    throw new Error("a production-only value was read under APP_ENV=development");
  }
  return current;
}

export function localPostgresUrl(): string {
  const current = env();
  if (current.APP_ENV !== "development") {
    throw new Error("the local Postgres URL is only the app's database under APP_ENV=development");
  }
  return current.DATABASE_URL;
}

export function googleCredentials() {
  return env().GOOGLE_SERVICE_ACCOUNT_JSON;
}

export function googleProject(): string {
  return env().GOOGLE_CLOUD_PROJECT;
}


export function devSignupTier(): AccountTier | null {
  const current = env();
  return current.APP_ENV === "development" ? current.DEV_SIGNUP_TIER : null;
}

export function bucketName(): string {
  const current = env();
  return current.APP_ENV === "development" ? current.DEV_BUCKET : current.GCS_BUCKET;
}

