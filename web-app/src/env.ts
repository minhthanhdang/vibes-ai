import "server-only";
import { z } from "zod";

const serviceAccountKey = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
  project_id: z.string().min(1),
});

const schema = z.object({
  // Read by the Prisma CLI through prisma.config.ts for `migrate`/`studio`,
  // which do not go through `server/db.ts`, and by `docker-compose.yml`'s local
  // Postgres. The running app dials Cloud SQL through the connector instead —
  // see the CLOUD_SQL_* keys below and context/tech-spec.md §VIII.
  DATABASE_URL: z.string().url(),

  // Cloud SQL, reached through the connector in server/google/cloud-sql.ts,
  // which is the only file allowed to name that package. Required rather
  // than optional because `server/db.ts` has no other path to a database: a
  // missing key here is an app with no storage, which should fail at boot and
  // not on the first query. infra.md §XVI holds the provisioned values.
  CLOUD_SQL_INSTANCE: z.string().min(1),
  CLOUD_SQL_USER: z.string().min(1),
  CLOUD_SQL_PASSWORD: z.string().min(1),
  CLOUD_SQL_DATABASE: z.string().min(1),

  // Vercel has no metadata server, so there is no ambient ADC — every Vertex
  // and GCS call needs this key passed explicitly. See context/infra.md §VI.
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
  // `global`, not a region: the Managed Agents API and the gemini-3.x models
  // are only served from global. infra.md §VI, §X.
  GOOGLE_CLOUD_LOCATION: z.string().min(1).default("global"),
  GOOGLE_GENAI_USE_ENTERPRISE: z.string().default("1"),

  // Sign-in with Google. The client is a "Web application" client created in
  // the Cloud Console — gcloud cannot mint one. Its authorized redirect URI
  // must be exactly `${APP_URL}/api/auth/google/callback`.
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
  // Origin this deployment answers on. Drives the OAuth redirect URI, so it
  // has to match what the client is registered for, scheme included — and the
  // scheme is why this is not a plain `.url()`: zod reads `localhost:12000` as
  // a URL whose protocol is `localhost:`, which would build a redirect Google
  // rejects. Constrained to http(s) rather than to https so the local origin
  // above stays legal.
  APP_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:12000"),

  GCS_BUCKET: z.string().min(1),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  // projects/<n>/locations/global/reasoningEngines/<id> — unset until the
  // orchestrator is deployed with `adk deploy agent_engine`.
  AGENT_ENGINE_RESOURCE: z.string().optional(),

  // Shared secret Cloud Scheduler presents to the analyzer worker endpoint.
  // Unset disables the endpoint: it is session-less, so without a secret it
  // would be an open door to Vertex spend. Queued jobs simply wait.
  //
  // Blank counts as unset — `.env.example` carries the key with an empty value,
  // and a copied-but-unfilled line must disable the route, not fail every
  // request in the app on a length check.
  ANALYZER_WORKER_SECRET: z.preprocess(
    (raw) => (typeof raw === "string" && raw.trim() === "" ? undefined : raw),
    z.string().min(16).optional(),
  ),

  // The vibes worker's secret, same rules and same reasons — and deliberately
  // its own key rather than the analyzer's: rotating one must not break the
  // other (multi-vibes-and-preview-prd §II.5).
  VIBES_WORKER_SECRET: z.preprocess(
    (raw) => (typeof raw === "string" && raw.trim() === "" ? undefined : raw),
    z.string().min(16).optional(),
  ),

  // Where per-turn agent transcripts are written. Unset disables them entirely,
  // which is the state every deployment is in: Vercel's filesystem is read-only
  // outside /tmp, so this is a local instrument by construction. Blank counts as
  // unset, for ANALYZER_WORKER_SECRET's reason — a copied-but-unfilled line in
  // .env.example must disable the feature, not fail the app at boot.
  AGENT_TRANSCRIPT_DIR: z.preprocess(
    (raw) => (typeof raw === "string" && raw.trim() === "" ? undefined : raw),
    z.string().optional(),
  ),
});

/// Exported, and taking the environment as an argument, because `env()`
/// memoises: a test that reached the rules through it would parse one
/// environment per process and then be asserting the cache. The argument is
/// also what makes the escape hatch assertable — `SKIP_ENV_VALIDATION` is read
/// off the same source, so it means "this source is trusted", not "this
/// process is".
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
