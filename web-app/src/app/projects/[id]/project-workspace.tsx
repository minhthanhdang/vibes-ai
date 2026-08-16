"use client";

import { useState } from "react";
import Link from "next/link";
import { ReferenceGallery } from "./reference-gallery";
import { ReferenceSidebar } from "./reference-sidebar";

export function ProjectWorkspace({
  projectId,
  title,
  brief,
}: {
  projectId: string;
  title: string;
  brief: string;
}) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  return (
    /// The sidebar is a flex sibling, not an overlay — expanding it narrows the
    /// gallery instead of covering it.
    <div className="flex flex-1 items-stretch">
      <main className="flex min-w-0 flex-1 flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-2">
          <Link href="/projects" className="text-sm opacity-50 hover:opacity-80">
            ← Projects
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {brief ? <p className="text-sm opacity-60">{brief}</p> : null}
        </header>

        <ReferenceGallery projectId={projectId} />
      </main>

      <aside
        className={`shrink-0 overflow-hidden border-l border-current/10 transition-[width] duration-200 ${
          isSidebarOpen ? "w-[360px]" : "w-12"
        }`}
      >
        <div className="sticky top-0 flex h-dvh flex-col">
          <div
            className={`flex items-center gap-2 border-b border-current/10 px-3 py-3 ${
              isSidebarOpen ? "justify-between" : "justify-center"
            }`}
          >
            {isSidebarOpen ? <span className="text-sm font-medium">Assistant</span> : null}
            <button
              type="button"
              onClick={() => setIsSidebarOpen((open) => !open)}
              aria-expanded={isSidebarOpen}
              aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              className="rounded-md border border-current/20 px-2 py-1 text-xs transition-opacity hover:opacity-70"
            >
              {isSidebarOpen ? "→" : "←"}
            </button>
          </div>

          {isSidebarOpen ? (
            <ReferenceSidebar projectId={projectId} />
          ) : (
            <span className="mt-6 self-center text-xs tracking-widest opacity-40 [writing-mode:vertical-rl]">
              ASSISTANT
            </span>
          )}
        </div>
      </aside>
    </div>
  );
}
