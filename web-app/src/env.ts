import "server-only";
import { z } from "zod";

const serviceAccountKey = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
  project_id: z.string().min(1),
});

const schema = z.object({
  DATABASE_URL: z.string().url(),

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
  // has to match what the client is registered for, scheme included.
  APP_URL: z.string().url().default("http://localhost:12000"),

  GCS_BUCKET: z.string().min(1),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  // projects/<n>/locations/global/reasoningEngines/<id> — unset until the
  // orchestrator is deployed with `adk deploy agent_engine`.
  AGENT_ENGINE_RESOURCE: z.string().optional(),

  // Reference image sources for agent 1. All optional: whichever keys are set
  // are the providers that get searched. See src/server/references/.
  UNSPLASH_ACCESS_KEY: z.string().optional(),
  PEXELS_API_KEY: z.string().optional(),
  // Google Custom Search needs both, and the engine must have image search on.
  GOOGLE_CSE_KEY: z.string().optional(),
  GOOGLE_CSE_CX: z.string().optional(),
});

function load() {
  if (process.env.SKIP_ENV_VALIDATION) {
    return process.env as unknown as z.infer<typeof schema>;
  }
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

let cached: z.infer<typeof schema> | undefined;

export function env() {
  cached ??= load();
  return cached;
}
