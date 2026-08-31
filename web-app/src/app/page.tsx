import { googleSignInOpen } from "@/server/auth/google";
import { currentUser } from "@/server/auth/session";
import { LandingShell } from "@/components/landing/landing-shell";

export default async function LandingPage() {
  const user = await currentUser();

  return (
    <LandingShell
      userName={user ? user.name || user.email : null}
      googleOpen={googleSignInOpen()}
    />
  );
}
