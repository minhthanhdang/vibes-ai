import Link from "next/link";

const PIPELINE = [
  { agent: "1", name: "Reference browser", detail: "Searches and triages 50–200 candidates down to ~10." },
  { agent: "2", name: "Property analyzer", detail: "Tags palette, lighting, texture, composition, subject, contrast." },
  { agent: "3", name: "Cropper", detail: "Detects the box, crops deterministically." },
  { agent: "4", name: "Compositor", detail: "Packs crops onto a board, fills the seams." },
  { agent: "5", name: "Presentation builder", detail: "Turns the board into a Slides deck that explains itself." },
  { agent: "6", name: "Orchestrator", detail: "Routes between the five above." },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Director Assistant</h1>
        <p className="text-base opacity-70">
          Browse references, analyze them, build a moodboard, ship the deck.
        </p>
        <Link
          href="/projects"
          className="w-fit rounded-full border border-current/20 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-70"
        >
          Open projects →
        </Link>
      </header>

      <ol className="flex flex-col gap-px overflow-hidden rounded-xl border border-current/10 bg-current/10">
        {PIPELINE.map((step) => (
          <li key={step.agent} className="flex gap-4 bg-[var(--background)] px-5 py-4">
            <span className="font-mono text-sm opacity-40">{step.agent}</span>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{step.name}</span>
              <span className="text-sm opacity-60">{step.detail}</span>
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
