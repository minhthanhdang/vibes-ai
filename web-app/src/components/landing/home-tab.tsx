"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { motionTokens, springs } from "@/lib/motion/tokens";
import { ProductMock } from "./product-mock";

const FEATURES = [
  {
    title: "One brief, zero babysitting",
    body: "Fill the Let's Vibes form once — purpose, page count, palette, vibe — and the run designs every page without further input.",
  },
  {
    title: "Agents with taste",
    body: "Six Gemini-powered agents read your photos, crop the part that matters, invent the images your gallery is missing, and place every piece.",
  },
  {
    title: "Honest progress",
    body: "Each page is a bounded unit of work. A failure at page four keeps pages one to three, Stop means stop, and a closed tab is resumable.",
  },
  {
    title: "Files you own",
    body: "The output is a real board with real geometry — pages, renders, and a one-slide-per-page deck. Not a chat describing a moodboard.",
  },
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

      <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-16 sm:py-24 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <motion.img
            {...rise(0)}
            src="/logos/bg-128.png"
            alt="Vibes AI"
            width={128}
            height={128}
            className="h-16 w-16"
          />
          <motion.p {...rise(0.03)} className="text-sm font-medium uppercase tracking-widest opacity-50">
            All Things Agentic Hackathon · Taskmaster
          </motion.p>
          <motion.h1 {...rise(0.05)} className="text-5xl font-semibold leading-tight tracking-tight sm:text-6xl">
            Say it once.
            <br />
            <span className="rainbow-text">Let&apos;s Vibes.</span>
          </motion.h1>
          <motion.p {...rise(0.1)} className="max-w-md text-base opacity-70">
            Say what the board is for. Walk away. Come back to a finished
            board — every page designed by agents, from your own photos,
            while you were not looking.
          </motion.p>
          <motion.div {...rise(0.15)} className="flex flex-wrap items-center gap-3">
            <motion.span whileHover={{ scale: motionTokens.scale.pop }} whileTap={{ scale: motionTokens.scale.press }} transition={springs.snappy}>
              <Link
                href="/signin"
                className="rainbow-bar inline-block rounded-full px-6 py-3 text-sm font-medium text-white"
              >
                Get started
              </Link>
            </motion.span>
            <motion.span whileHover={{ scale: motionTokens.scale.pop }} whileTap={{ scale: motionTokens.scale.press }} transition={springs.snappy}>
              <a
                href="#demo"
                className="inline-block rounded-full border border-current/20 px-6 py-3 text-sm font-medium transition-opacity hover:opacity-70"
              >
                Watch the demo
              </a>
            </motion.span>
          </motion.div>
          <motion.p {...rise(0.2)} className="font-mono text-xs opacity-40">
            gemini-3.7-flash · gemini-3-pro-image · Vertex AI · Cloud SQL · Cloud Storage · Cloud Scheduler
          </motion.p>
        </div>

        <motion.div {...rise(0.2)}>
          <ProductMock />
        </motion.div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 pb-24">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: reduce ? 0 : motionTokens.distance.lg }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ ...springs.gentle, delay: i * 0.08 }}
              className="rounded-2xl border border-current/10 p-5"
            >
              <div className="rainbow-bar mb-4 h-1 w-8 rounded-full" />
              <h3 className="mb-2 text-sm font-semibold">{f.title}</h3>
              <p className="text-sm leading-relaxed opacity-60">{f.body}</p>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}
