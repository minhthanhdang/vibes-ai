"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { motionTokens, springs } from "@/lib/motion/tokens";
import { ProductMock } from "./product-mock";

const STEPS = [
  { n: "01", label: "Brief it once" },
  { n: "02", label: "Walk away" },
  { n: "03", label: "Board + deck" },
];

export function HomeTab() {
  const reduce = useReducedMotion();

  const rise = (delay: number) => ({
    initial: { opacity: 0, y: reduce ? 0 : motionTokens.distance.lg },
    animate: { opacity: 1, y: 0 },
    transition: { ...springs.gentle, delay },
  });

  return (
    <div className="relative">
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="aurora-blob left-[-10%] top-[-15%] h-96 w-96 bg-[#ff5f6d]" />
        <div className="aurora-blob right-[-5%] top-[5%] h-80 w-80 bg-[#5fb8ff] [animation-delay:-6s]" />
        <div className="aurora-blob bottom-[-20%] left-[30%] h-96 w-96 bg-[#9b8cff] [animation-delay:-12s]" />
      </div>

      <section className="mx-auto grid w-full max-w-6xl items-center gap-14 px-6 py-16 sm:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col items-start gap-7">
          <motion.span
            {...rise(0)}
            className="rounded-full border border-current/15 px-3 py-1 text-xs font-medium uppercase tracking-widest opacity-60"
          >
            Taskmaster · All Things Agentic
          </motion.span>

          <motion.h1
            {...rise(0.05)}
            className="text-6xl font-semibold leading-[0.95] tracking-tight sm:text-7xl"
          >
            Say it once.
            <br />
            <span className="rainbow-text">Let&apos;s Vibes.</span>
          </motion.h1>

          <motion.p {...rise(0.1)} className="max-w-sm text-lg leading-snug opacity-60">
            Agents design your whole board while you are not looking.
          </motion.p>

          <motion.div {...rise(0.15)} className="flex flex-wrap items-center gap-3">
            <motion.span
              whileHover={{ scale: motionTokens.scale.pop }}
              whileTap={{ scale: motionTokens.scale.press }}
              transition={springs.snappy}
            >
              <Link
                href="/signin"
                className="rainbow-bar inline-block rounded-full px-7 py-3.5 text-sm font-medium text-white"
              >
                Get started
              </Link>
            </motion.span>
            <motion.span
              whileHover={{ scale: motionTokens.scale.pop }}
              whileTap={{ scale: motionTokens.scale.press }}
              transition={springs.snappy}
            >
              <a
                href="#demo"
                className="inline-block rounded-full border border-current/20 px-7 py-3.5 text-sm font-medium transition-opacity hover:opacity-70"
              >
                Watch the demo
              </a>
            </motion.span>
          </motion.div>

          <motion.div {...rise(0.2)} className="flex w-full max-w-sm items-stretch gap-3 pt-2">
            {STEPS.map((s) => (
              <div key={s.n} className="flex flex-1 flex-col gap-2 border-t border-current/15 pt-3">
                <span className="rainbow-text font-mono text-xs font-semibold">{s.n}</span>
                <span className="text-sm leading-tight opacity-70">{s.label}</span>
              </div>
            ))}
          </motion.div>
        </div>

        <motion.div {...rise(0.2)}>
          <ProductMock />
        </motion.div>
      </section>

      <motion.section
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: motionTokens.duration.normal }}
        className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-2 px-6 pb-16 text-center"
      >
        <span className="font-mono text-xs opacity-40">
          Gemini · Vertex AI · Cloud SQL · Cloud Storage · Cloud Scheduler
        </span>
        <a href="#about" className="text-xs underline underline-offset-4 opacity-60 hover:opacity-100">
          How it works
        </a>
      </motion.section>
    </div>
  );
}
