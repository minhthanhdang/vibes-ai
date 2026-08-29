"use client";

import { motion, useReducedMotion } from "motion/react";
import { motionTokens, springs } from "@/lib/motion/tokens";

const GOOGLE_STACK = [
  {
    name: "Gemini 3.7 Flash",
    role: "The orchestrator's brain",
    body: "Every design decision — what to crop, where to place it, when a page is done — runs through Gemini 3.7 Flash tool loops. Its long context holds an entire board's state at once, and its speed makes a six-page unattended run affordable instead of aspirational.",
  },
  {
    name: "Gemini 3 Pro Image",
    role: "The pictures you don't have",
    body: "When your gallery is missing the texture or backdrop a page needs, Gemini 3 Pro Image invents it on-brief and on-palette. No other image model we tried followed a board's established vibe this faithfully.",
  },
  {
    name: "Cloud SQL",
    role: "The board's single source of truth",
    body: "Postgres on Cloud SQL holds every scene, page, and job lease. Fully managed, transactional, and boring in the best way — our resume-from-a-closed-tab story only works because the database never lies about what's on a page.",
  },
  {
    name: "Cloud Storage",
    role: "Every pixel, durably",
    body: "Uploads, crops, generated images, and page renders all land in Cloud Storage buckets with lifecycle rules. Signed URLs mean the browser talks to Google directly and our servers never shuttle bytes.",
  },
  {
    name: "Cloud Scheduler",
    role: "The heartbeat",
    body: "Cloud Scheduler ticks our server-side vibes queue, so long multi-page runs keep marching through worker leases — reliably, on Google's clock, not a laptop's.",
  },
];

function Section({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      initial={{ opacity: 0, y: reduce ? 0 : motionTokens.distance.lg }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ ...springs.gentle, delay }}
      className="flex flex-col gap-4"
    >
      {children}
    </motion.section>
  );
}

export function AboutTab() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-16 px-6 py-16">
      <Section>
        <h1 className="text-3xl font-semibold tracking-tight">
          What <span className="rainbow-text">Vibes</span> does
        </h1>
        <p className="leading-relaxed opacity-70">
          Making a set of design pages is not one job — it is forty small ones.
          Find a photograph, name what you like about it, cut the part that
          matters, place it at a size that doesn&apos;t fight its neighbours,
          find a background that isn&apos;t in any of your photos. Then do it
          again for five more pages. Nothing in that list is hard; all of it is
          fiddly, sequential, and it eats an evening.
        </p>
        <p className="leading-relaxed opacity-70">
          Vibes takes the brief once — purpose, page count, palette, vibe — and
          then puts pixels in the right place in files you own, for as many
          pages as you asked for, while you are not looking. You upload your
          references, press <strong>Let&apos;s Vibes</strong>, and a team of
          agents analyzes your photos, crops the pieces worth keeping, generates
          the images your gallery is missing, and designs every page of the
          board. The finished board exports as a deck, one slide per page.
        </p>
      </Section>

      <Section>
        <h2 className="text-xl font-semibold tracking-tight">The hackathon fit</h2>
        <p className="leading-relaxed opacity-70">
          Built for the <strong>All Things Agentic Hackathon</strong>, category{" "}
          <strong>Taskmaster</strong> — agents that complete real work
          unattended, not chatbots that describe it. Vibes is exactly that: a
          brief goes in, agents run page by page with no human in the loop, and
          the artifact that comes out is a designed board, not a paragraph. A
          failure keeps finished pages, Stop stops at a page boundary, and a
          closed tab resumes — the unglamorous properties real task delegation
          needs.
        </p>
      </Section>

      <Section>
        <h2 className="text-xl font-semibold tracking-tight">
          Why we built it on Google
        </h2>
        <p className="leading-relaxed opacity-70">
          The whole product is a bet on the Google stack: Gemini models for
          every act of judgement, Google Cloud for everything that has to stay
          up while nobody is watching. One Vertex AI SDK, one auth story, one
          console — which meant our time went into agent design instead of glue.
        </p>
        <div className="mt-2 grid gap-4">
          {GOOGLE_STACK.map((s, i) => (
            <motion.div
              key={s.name}
              initial={{ opacity: 0, x: -motionTokens.distance.md }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ ...springs.gentle, delay: i * 0.06 }}
              className="rounded-2xl border border-current/10 p-5"
            >
              <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-sm font-semibold">{s.name}</h3>
                <span className="text-xs uppercase tracking-wider opacity-40">{s.role}</span>
              </div>
              <p className="text-sm leading-relaxed opacity-60">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </Section>
    </div>
  );
}
