"use client";

import { motion, useReducedMotion } from "motion/react";
import { motionTokens, springs } from "@/lib/motion/tokens";
import { AgentArchitectureDiagram, ProjectArchitectureDiagram } from "./diagrams";

function Section({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      initial={{ opacity: 0, y: reduce ? 0 : motionTokens.distance.lg }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={springs.gentle}
      className="flex flex-col gap-4"
    >
      {children}
    </motion.section>
  );
}

export function ArchitectureTab() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-16 px-6 py-16">
      <Section>
        <h1 className="text-3xl font-semibold tracking-tight">
          <span className="rainbow-text">Architecture</span>
        </h1>
        <p className="max-w-2xl leading-relaxed opacity-70">
          Two views of the same system: the agents that do the designing, and
          the Google Cloud services they stand on.
        </p>
      </Section>

      <Section>
        <h2 className="text-xl font-semibold tracking-tight">Agent architecture</h2>
        <div className="overflow-x-auto rounded-2xl border border-current/10 p-4">
          <AgentArchitectureDiagram />
        </div>
        <p className="max-w-2xl text-sm leading-relaxed opacity-60">
          One brief starts a run. The orchestrator — a{" "}
          <span className="font-mono">gemini-3.7-flash</span> tool loop — takes
          the board one page at a time, calling specialist agents as tools: the
          analyzer names what a reference has, the cropper cuts the piece that
          matters, the imaginer generates the images the gallery is missing
          with <span className="font-mono">gemini-3-pro-image</span>, and the
          placer writes real geometry onto the page. Each page ends designed,
          empty, or refused — so the run can never claim six successes over a
          board with five designs on it. The deck is then arithmetic: one slide
          per page, no model call.
        </p>
      </Section>

      <Section>
        <h2 className="text-xl font-semibold tracking-tight">Project architecture</h2>
        <div className="overflow-x-auto rounded-2xl border border-current/10 p-4">
          <ProjectArchitectureDiagram />
        </div>
        <p className="max-w-2xl text-sm leading-relaxed opacity-60">
          A Next.js app talks tRPC to its server, and everything below that
          line is Google Cloud: Vertex AI serves every Gemini call, Cloud SQL
          holds the board as the single source of truth, Cloud Storage keeps
          every upload, crop, and render behind signed URLs, and Cloud
          Scheduler wakes the vibes queue so runs march on without a browser
          tab.
        </p>
      </Section>

      <Section>
        <h2 className="text-xl font-semibold tracking-tight">How we built it</h2>
        <div className="flex max-w-2xl flex-col gap-4 text-sm leading-relaxed opacity-70">
          <p>
            We started from a rule: the board is the only truth. Progress is
            read off the scene itself — &quot;is anything on this page?&quot; —
            never off a log of what ran. That one decision, backed by Cloud
            SQL&apos;s transactions, is what makes runs resumable, Stop honest,
            and failures cheap: a crash at page four keeps pages one to three.
          </p>
          <p>
            The agents came next. We gave a single Gemini 3.7 Flash loop a
            small toolbox — read the gallery, look at the page, crop, generate,
            place — and let it design each page in bounded rounds instead of
            one giant request. Vertex AI&apos;s Gen AI SDK made that loop almost
            boring to write: the same client, the same auth, whether the call
            returns a judgement or a brand-new image from Gemini 3 Pro Image.
          </p>
          <p>
            The last piece was making it unattended. Runs live in a server-side
            queue with worker leases; Cloud Scheduler ticks it, Cloud Storage
            takes every byte the browser uploads directly, and the app itself
            stays a thin canvas over what the agents already decided. When
            everything below you is managed — the database, the buckets, the
            models, the clock — the hackathon time goes where it should: into
            taste.
          </p>
        </div>
      </Section>
    </div>
  );
}
