import "server-only";
import { z } from "zod";

const serviceAccountKey = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
  project_id: z.string().min(1),
});

const schema = z.object({
  DATABASE_URL: z.string().url(),

  CLOUD_SQL_INSTANCE: z.string().min(1),
  CLOUD_SQL_USER: z.string().min(1),
  CLOUD_SQL_PASSWORD: z.string().min(1),
  CLOUD_SQL_DATABASE: z.string().min(1),

  GOOGLE_SERVICE_ACCOUNT_JSON: z
    .string()
    .transform((raw, ctx) => {
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

  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
  APP_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:12000"),

  GCS_BUCKET: z.string().min(1),
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

  AGENT_TRANSCRIPT_DIR: z.preprocess(
    (raw) => (typeof raw === "string" && raw.trim() === "" ? undefined : raw),
    z.string().optional(),
  ),
});

export function parseEnv(source: Record<string, string | undefined> = process.env) {
  if (source.SKIP_ENV_VALIDATION) {
    return source as unknown as z.infer<typeof schema>;
  }
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

let cached: z.infer<typeof schema> | undefined;

export function env() {
  cached ??= parseEnv();
  return cached;
}
