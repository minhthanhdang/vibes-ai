import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth/session";
import { SiteHeader } from "./site-header";

export default async function LandingPage() {
  if (await currentUser()) redirect("/home");

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-24 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Vibes</h1>
        <p className="text-base opacity-70">
          Browse references, analyze them, build a moodboard, ship the deck.
        </p>
        <Link
          href="/signin"
          className="mx-auto w-fit rounded-full border border-current/20 px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-70"
        >
          Get started
        </Link>
      </main>
    </>
  );
}
