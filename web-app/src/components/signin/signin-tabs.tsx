"use client";

import { useCallback, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/lib/motion/tokens";
import { JudgePanel } from "./judge-panel";
import { NormalPanel } from "./normal-panel";

const ALL_TABS = [
  { id: "judges", label: "Judges" },
  { id: "normal", label: "Everyone else" },
] as const;

export type SigninTabId = (typeof ALL_TABS)[number]["id"];

export function SigninTabs({
  next,
  judgesOpen,
  initialTab,
}: {
  next: string;
  judgesOpen: boolean;
  initialTab: string | null;
}) {
  const tabs = judgesOpen ? ALL_TABS : ALL_TABS.filter((t) => t.id !== "judges");
  const opening = tabs.find((t) => t.id === initialTab)?.id ?? tabs[0].id;

  const [tab, setTab] = useState<SigninTabId>(opening);
  const reduce = useReducedMotion();

  const show = useCallback((id: SigninTabId) => {
    setTab(id);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url);
  }, []);

  return (
    <div className="flex flex-col gap-5">
      {tabs.length > 1 && (
        <nav className="flex items-center gap-1 self-start text-sm" aria-label="Sign-in method">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => show(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className="relative rounded-full px-3 py-1.5 opacity-60 transition-opacity hover:opacity-100 aria-[current=page]:opacity-100"
            >
              {tab === t.id && (
                <motion.span
                  layoutId="signin-tab-pill"
                  className="absolute inset-0 rounded-full bg-current/10"
                  transition={
                    reduce ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30 }
                  }
                />
              )}
              <span className="relative">{t.label}</span>
            </button>
          ))}
        </nav>
      )}

      <motion.div
        key={tab}
        initial={{ opacity: 0, y: reduce ? 0 : motionTokens.distance.sm }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: motionTokens.duration.fast, ease: motionTokens.easing.smooth }}
      >
        {tab === "judges" ? (
          <JudgePanel next={next} onNotAJudge={() => show("normal")} />
        ) : (
          <NormalPanel next={next} />
        )}
      </motion.div>
    </div>
  );
}
