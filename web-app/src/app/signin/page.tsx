import { redirect } from "next/navigation";
import { googleSignInOpen, internalPath } from "@/server/auth/google";
import { judgeSignupOpen } from "@/server/auth/judge";
import { currentUser } from "@/server/auth/session";
import { SigninTabs } from "@/components/signin/signin-tabs";
import { SiteHeader } from "../site-header";

const MESSAGES: Record<string, string> = {
  access_denied: "You cancelled the Google sign-in.",
  invalid_request: "That sign-in link expired. Try again.",
  exchange_failed: "Google rejected the sign-in. Try again.",
  invalid_code: "That access code is not one we hand out. Check it and try again.",
  email_taken: "An account already uses that email. Sign in instead.",
  invalid_credentials: "That email and password do not match an account.",
  weak_password: "Pick a password of at least 10 characters.",
  invalid_email: "That is not an email address we can read.",
  too_many_attempts: "Too many attempts. Wait a few minutes and try again.",
  google_closed: "Sign-in with Google is off in this environment. Use an email and password.",
};

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const { error, next, tab } = await searchParams;
  const destination = internalPath(typeof next === "string" ? next : null);

  if (await currentUser()) redirect(destination);

  const message =
    typeof error === "string" ? (MESSAGES[error] ?? "Sign-in failed. Try again.") : null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm opacity-60">
            Your projects, references, and decks live on the account you sign in with.
          </p>
        </div>

        {message && (
          <p className="rounded-lg border border-current/20 px-4 py-3 text-sm opacity-80">
            {message}
          </p>
        )}

        <SigninTabs
          next={destination}
          googleOpen={googleSignInOpen()}
          judgesOpen={judgeSignupOpen()}
          initialTab={typeof tab === "string" ? tab : null}
        />
      </main>
    </>
  );
}
