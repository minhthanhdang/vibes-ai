"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/lib/motion/tokens";
import { HomeTab } from "./home-tab";
import { AboutTab } from "./about-tab";
import { ArchitectureTab } from "./architecture-tab";
import { DemoTab } from "./demo-tab";

const TABS = [
  { id: "home", label: "Home" },
  { id: "about", label: "About" },
  { id: "architecture", label: "Architecture" },
  { id: "demo", label: "Demo" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function tabFromHash(hash: string): TabId {
  const id = hash.replace(/^#\/?/, "");
  return TABS.some((t) => t.id === id) ? (id as TabId) : "home";
}

const PANELS: Record<TabId, React.ComponentType<{ googleOpen: boolean }>> = {
  home: HomeTab,
  about: AboutTab,
  architecture: ArchitectureTab,
  demo: DemoTab,
};

export function LandingShell({
  userName = null,
  googleOpen,
}: {
  userName?: string | null;
  googleOpen: boolean;
}) {
  const [tab, setTab] = useState<TabId>("home");
  const reduce = useReducedMotion();

  useEffect(() => {
    const sync = () => setTab(tabFromHash(window.location.hash));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  const Panel = PANELS[tab];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-20 shrink-0 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-6">
          <a
            href="#home"
            className="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/bg-64.png" alt="" width={28} height={28} className="h-7 w-7" />
            Vibes
          </a>

          <nav className="flex items-center gap-1 text-sm">
            {TABS.map((t) => (
              <a
                key={t.id}
                href={`#${t.id}`}
                aria-current={tab === t.id ? "page" : undefined}
                className="relative rounded-full px-3 py-1.5 transition-opacity hover:opacity-100 aria-[current=page]:opacity-100 opacity-60"
              >
                {tab === t.id && (
                  <motion.span
                    layoutId="tab-pill"
                    className="absolute inset-0 rounded-full bg-current/10"
                    transition={
                      reduce
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 300, damping: 30 }
                    }
                  />
                )}
                <span className="relative">{t.label}</span>
              </a>
            ))}

            <Link
              href="/licenses"
              className="rounded-full px-3 py-1.5 opacity-60 transition-opacity hover:opacity-100"
            >
              Licences
            </Link>
          </nav>

          {userName ? (
            <div className="ml-auto flex shrink-0 items-center gap-3">
              <span className="hidden text-sm opacity-60 sm:inline">{userName}</span>
              <Link
                href="/home"
                className="rounded-full border border-current/20 px-3 py-1.5 text-sm transition-opacity hover:opacity-70"
              >
                Open app
              </Link>
            </div>
          ) : (
            <Link
              href="/signin"
              className="ml-auto shrink-0 rounded-full border border-current/20 px-3 py-1.5 text-sm transition-opacity hover:opacity-70"
            >
              Sign in
            </Link>
          )}
        </div>
        <div className="rainbow-bar h-px w-full opacity-60" />
      </header>

      <main className="relative flex-1 overflow-x-clip">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: reduce ? 0 : motionTokens.distance.sm }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: motionTokens.duration.fast,
            ease: motionTokens.easing.smooth,
          }}
        >
          <Panel googleOpen={googleOpen} />
        </motion.div>
      </main>
    </div>
  );
}
