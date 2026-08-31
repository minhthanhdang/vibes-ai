import "server-only";
import { GoogleAuth } from "google-auth-library";
import { googleCredentials, googleProject } from "@/env";

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

let cached: GoogleAuth | undefined;

export function googleAuthOptions() {
  return {
    credentials: googleCredentials(),
    projectId: googleProject(),
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
