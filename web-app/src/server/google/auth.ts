import "server-only";
import { GoogleAuth } from "google-auth-library";
import { env } from "@/env";

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

let cached: GoogleAuth | undefined;

/// Credentials are passed inline, never via GOOGLE_APPLICATION_CREDENTIALS —
/// that takes a file path and no such file exists on Vercel.
export function googleAuth() {
  cached ??= new GoogleAuth({
    credentials: env().GOOGLE_SERVICE_ACCOUNT_JSON,
    projectId: env().GOOGLE_CLOUD_PROJECT,
    scopes: [SCOPE],
  });
  return cached;
}

export async function accessToken() {
  const token = await googleAuth().getAccessToken();
  if (!token) throw new Error("failed to mint a Google access token");
  return token;
}
