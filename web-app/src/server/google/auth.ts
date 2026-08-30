import "server-only";
import { GoogleAuth } from "google-auth-library";
import { env } from "@/env";

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

let cached: GoogleAuth | undefined;

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
