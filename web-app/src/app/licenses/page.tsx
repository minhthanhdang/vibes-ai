import type { Metadata } from "next";
import generated from "@/generated/third-party.json";
import type { PublishedNotice } from "@/lib/licenses/notice";
import { SiteHeader } from "../site-header";

const thirdParty = generated as unknown as PublishedNotice;

export const metadata: Metadata = {
  title: "Third-party licences — Vibes",
  description: "The open-source packages and fonts Vibes is built from, and the terms they are used under.",
};

const sourceOffers = thirdParty.groups
  .flatMap((group) => group.entries)
  .filter((entry) => entry.sourceUrl)
  .sort((a, b) => a.name.localeCompare(b.name));

export default function LicensesPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
        <header className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Third-party licences</h1>
          <p className="text-sm opacity-70">
            Vibes is built on {thirdParty.packageCount} open-source npm packages and {thirdParty.fonts.length} font
            families. Each is used under its own terms, and every copyright notice and licence text is reproduced in
            full in the notice file.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/NOTICE.txt"
              className="w-fit rounded-full border border-current/20 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-70"
            >
              Read the full NOTICE →
            </a>
            <span className="text-xs opacity-50">Generated {thirdParty.generatedAt}</span>
          </div>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium opacity-60">Fonts served from this origin</h2>
          <ul className="flex flex-col gap-px overflow-hidden rounded-2xl border border-current/10 bg-current/10">
            {thirdParty.fonts.map((font) => (
              <li key={font.family} className="flex flex-col gap-1 bg-[var(--background)] px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{font.family}</span>
                  <span className="font-mono text-xs opacity-50">{font.licence}</span>
                </div>
                <span className="text-sm opacity-60">{font.servedFrom}</span>
              </li>
            ))}
          </ul>
        </section>

        {sourceOffers.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium opacity-60">Written offer of source</h2>
            <div className="flex flex-col gap-4 rounded-2xl border border-current/10 px-5 py-4">
              <p className="text-sm opacity-70">
                These components are covered by reciprocal licences. Their complete corresponding source is available
                at the links below.
              </p>
              <ul className="flex flex-col gap-2">
                {sourceOffers.map((entry) => (
                  <li key={entry.name} className="flex flex-col gap-0.5">
                    <span className="font-mono text-xs">
                      {entry.name}@{entry.version} · {entry.licence}
                    </span>
                    <a
                      href={entry.sourceUrl ?? undefined}
                      rel="noreferrer"
                      target="_blank"
                      className="text-sm underline underline-offset-4 opacity-70 transition-opacity hover:opacity-100"
                    >
                      {entry.sourceUrl}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium opacity-60">npm packages</h2>
          <div className="flex flex-col gap-3">
            {thirdParty.groups.map((group) => (
              <details key={group.licence} className="rounded-2xl border border-current/10 px-5 py-4">
                <summary className="flex cursor-pointer items-baseline justify-between gap-4 text-sm">
                  <span className="font-medium">{group.licence}</span>
                  <span className="opacity-50">
                    {group.entries.length} package{group.entries.length === 1 ? "" : "s"}
                  </span>
                </summary>
                <ul className="mt-4 flex flex-col gap-2 border-t border-current/10 pt-4">
                  {group.entries.map((entry) => (
                    <li key={entry.name} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                      {entry.homepage ? (
                        <a
                          href={entry.homepage}
                          rel="noreferrer"
                          target="_blank"
                          className="font-mono text-xs underline underline-offset-4 opacity-80 transition-opacity hover:opacity-100"
                        >
                          {entry.name}
                        </a>
                      ) : (
                        <span className="font-mono text-xs opacity-80">{entry.name}</span>
                      )}
                      <span className="font-mono text-xs opacity-40">{entry.version}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </section>

        <p className="text-xs opacity-50">
          Each component named here remains the property of its authors. Nothing on this page grants you rights in it;
          the terms in the NOTICE file do.
        </p>
      </main>
    </>
  );
}
