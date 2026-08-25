import { redirect } from "next/navigation";
import { internalPath } from "@/server/auth/google";
import { currentUser } from "@/server/auth/session";
import { SiteHeader } from "../site-header";

const MESSAGES: Record<string, string> = {
  access_denied: "You cancelled the Google sign-in.",
  invalid_request: "That sign-in link expired. Try again.",
  exchange_failed: "Google rejected the sign-in. Try again.",
};

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const { error, next } = await searchParams;
  const destination = internalPath(typeof next === "string" ? next : null);

  if (await currentUser()) redirect(destination);

  const message = typeof error === "string" ? (MESSAGES[error] ?? "Sign-in failed. Try again.") : null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm opacity-60">
            Your projects, references, and decks are tied to your Google account.
          </p>
        </div>

        {message && (
          <p className="rounded-lg border border-current/20 px-4 py-3 text-sm opacity-80">{message}</p>
        )}

        <a
          href={`/api/auth/google?next=${encodeURIComponent(destination)}`}
          className="rounded-lg border border-current/20 px-4 py-3 text-center text-sm font-medium transition-opacity hover:opacity-70"
        >
          Continue with Google
        </a>
      </main>
    </>
  );
}
