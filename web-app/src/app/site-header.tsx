import Link from "next/link";
import { currentUser } from "@/server/auth/session";

export async function SiteHeader() {
  const user = await currentUser();

  return (
    <header className="flex items-center justify-between gap-4 border-b border-current/10 px-6 py-4">
      <Link href={user ? "/home" : "/"} className="text-sm font-semibold tracking-tight">
        Vibes
      </Link>

      {user ? (
        <form action="/api/auth/signout" method="post" className="flex items-center gap-3">
          <span className="text-sm opacity-60">{user.name || user.email}</span>
          <button
            type="submit"
            className="rounded-full border border-current/20 px-3 py-1.5 text-sm transition-opacity hover:opacity-70"
          >
            Sign out
          </button>
        </form>
      ) : (
        <Link
          href="/signin"
          className="rounded-full border border-current/20 px-3 py-1.5 text-sm transition-opacity hover:opacity-70"
        >
          Sign in
        </Link>
      )}
    </header>
  );
}
