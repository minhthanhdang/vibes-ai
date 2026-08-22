import "server-only";
import { GoogleAuth } from "google-auth-library";
import { env } from "@/env";

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

let cached: GoogleAuth | undefined;

/// Credentials are passed inline, never via GOOGLE_APPLICATION_CREDENTIALS —
/// that takes a file path and no such file exists on Vercel.
///
/// Handed out as options rather than only as a built `GoogleAuth` because the
/// Gen AI SDK builds its own client from exactly this object
/// (`GoogleGenAIOptions.googleAuthOptions`), and two places deriving the same
/// credentials from the same env is one place too many to keep in step.
///
/// Left to infer its own type rather than annotated `GoogleAuthOptions`: the SDK
/// nests its own google-auth-library v10 beside this project's v11, and the two
/// spellings of that interface are not assignable to one another even though the
/// object satisfies both.
export function googleAuthOptions() {
  return {
    credentials: env().GOOGLE_SERVICE_ACCOUNT_JSON,
    projectId: env().GOOGLE_CLOUD_PROJECT,
    scopes: [SCOPE],
  };
}

export function googleAuth() {
  cached ??= new GoogleAuth(googleAuthOptions());
  return cached;
}

export async function accessToken() {
  const token = await googleAuth().getAccessToken();
  if (!token) throw new Error("failed to mint a Google access token");
  return token;
}
