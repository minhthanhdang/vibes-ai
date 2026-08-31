import Link from "next/link";
import { currentUser } from "@/server/auth/session";

export async function SiteHeader({ children }: { children?: React.ReactNode }) {
  const user = await currentUser();

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-current/10 px-4">
      <Link
        href={user ? "/home" : "/"}
        className="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logos/bg-64.png" alt="" width={28} height={28} className="h-7 w-7" />
        Vibes
      </Link>

      {children}

      <Link
        href="/licenses"
        className="ml-auto shrink-0 text-sm opacity-60 transition-opacity hover:opacity-100"
      >
        Licences
      </Link>

      {user ? (
        <form action="/api/auth/signout" method="post" className="flex shrink-0 items-center gap-3">
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
          className="shrink-0 rounded-full border border-current/20 px-3 py-1.5 text-sm transition-opacity hover:opacity-70"
        >
          Sign in
        </Link>
      )}
    </header>
  );
}
