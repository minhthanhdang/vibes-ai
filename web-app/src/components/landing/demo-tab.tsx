"use client";

import { motion, useReducedMotion } from "motion/react";
import { motionTokens, springs } from "@/lib/motion/tokens";

const judgeSteps = (googleOpen: boolean) => [
  googleOpen
    ? "Sign in with the judge Google account from our submission notes — it is pre-seeded with a ready project."
    : "Sign up with the email and password from our submission notes — that account is pre-seeded with a ready project.",
  "Open the seeded project from the home screen. Its reference gallery is already uploaded and analyzed.",
  "Press Let's Vibes, fill the brief (or keep the defaults), and start the run.",
  "Walk away — or watch pages design themselves one by one. Stop, close the tab, come back: the run resumes where the board left off.",
  "When the run settles, open the Preview tab to flip through the finished pages as a deck.",
];

const userSteps = (googleOpen: boolean) => [
  googleOpen ? "Sign in with any Google account." : "Sign up with an email and a password.",
  "Create a project and drop in your own reference photos — the more of your taste in the gallery, the better the board.",
  "Wait for the analyzer to finish reading your references.",
  "Press Let's Vibes: say what the board is for, how many pages, the palette and the vibe.",
  "Come back to a finished board, and export it as a one-slide-per-page deck.",
];

function Steps({ title, note, steps, delay }: { title: string; note: string; steps: string[]; delay: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : motionTokens.distance.lg }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ ...springs.gentle, delay }}
      className="flex flex-col gap-4 rounded-2xl border border-current/10 p-6"
    >
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm opacity-50">{note}</p>
      </div>
      <ol className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-sm leading-relaxed">
            <span className="rainbow-bar mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white">
              {i + 1}
            </span>
            <span className="opacity-70">{s}</span>
          </li>
        ))}
      </ol>
    </motion.div>
  );
}

export function DemoTab({ googleOpen }: { googleOpen: boolean }) {
  const reduce = useReducedMotion();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-12 px-6 py-16">
      <motion.section
        initial={{ opacity: 0, y: reduce ? 0 : motionTokens.distance.lg }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.gentle}
        className="flex flex-col gap-4"
      >
        <h1 className="text-3xl font-semibold tracking-tight">
          See it <span className="rainbow-text">vibe</span>
        </h1>
        <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed border-current/20">
          <div className="absolute inset-0 -z-10 overflow-hidden">
            <div className="aurora-blob left-[10%] top-[-30%] h-72 w-72 bg-[#ffa26d]" />
            <div className="aurora-blob bottom-[-30%] right-[10%] h-72 w-72 bg-[#5fb8ff] [animation-delay:-9s]" />
          </div>
          <div className="flex flex-col items-center gap-3">
            <motion.div
              whileHover={{ scale: motionTokens.scale.pop }}
              whileTap={{ scale: motionTokens.scale.press }}
              transition={springs.snappy}
              className="rainbow-bar flex size-16 items-center justify-center rounded-full text-white"
            >
              <svg viewBox="0 0 24 24" className="ml-1 size-7" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            </motion.div>
            <p className="text-sm opacity-60">Demo video coming soon</p>
            <p className="text-xs opacity-40">4 minutes · the unattended run, start to finished board</p>
          </div>
        </div>
      </motion.section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Steps
          title="For judges"
          note="Fastest path to the run — a seeded account, nothing to prepare."
          steps={judgeSteps(googleOpen)}
          delay={0}
        />
        <Steps
          title="For everyone else"
          note="Bring your own photos and your own vibe."
          steps={userSteps(googleOpen)}
          delay={0.08}
        />
      </div>
    </div>
  );
}
