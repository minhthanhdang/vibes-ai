"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ProjectBrief } from "./project-brief";
import { setWorkspaceView, useWorkspaceViewStore } from "../stores/use-workspace-view-store";
import type { WorkspaceView } from "../types";

const VIEWS: { id: WorkspaceView; label: string }[] = [
  { id: "gallery", label: "Gallery" },
  { id: "design", label: "Design" },
];

/// The workspace's half of the site header: what project this is, and which of
/// its two surfaces is showing.
///
/// The title, the brief and the way back out used to be a block above the
/// canvas — 134px of chrome to say three things that are read once and then
/// looked past. They are the same three things here, folded behind the name,
/// and the canvas starts at the bar.
///
/// The view switch does *not* fold: it is the one control in the header pressed
/// more than once a session, and a switch behind a menu is a click charged
/// every time to save a row that costs nothing.
export function ProjectBar({
  projectId,
  title,
  brief,
}: {
  projectId: string;
  title: string;
  brief: string;
}) {
  const view = useWorkspaceViewStore((state) => state.view);
  const [isMenuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  /// A menu holding a textarea cannot close on blur — clicking into the field is
  /// a blur. It closes on a press that lands outside it, and on Escape.
  useEffect(() => {
    if (!isMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [isMenuOpen]);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-4">
      <div ref={menu} className="relative flex min-w-0 items-center gap-1">
        <span className="shrink-0 text-sm opacity-30">/</span>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={isMenuOpen}
          className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium transition-colors hover:bg-current/10"
        >
          <span className="truncate">{title}</span>
          {/* A brief nothing has been written into is the one thing in here the
              user has to be told about — it is read on every turn the assistant
              takes, and an empty one is silently worth nothing. */}
          {brief ? null : <span className="size-1.5 shrink-0 rounded-full bg-current/40" />}
          <span className="shrink-0 text-xs opacity-40">▾</span>
        </button>

        {isMenuOpen ? (
          <div className="absolute top-full left-0 z-40 mt-1.5 flex w-96 flex-col gap-3 rounded-xl border border-current/15 bg-[var(--background)] p-3 shadow-[0_8px_24px_rgba(0,0,0,0.28)]">
            <ProjectBrief projectId={projectId} brief={brief} />
            <Link
              href="/projects"
              className="border-t border-current/10 pt-3 text-sm opacity-60 hover:opacity-100"
            >
              ← All projects
            </Link>
          </div>
        ) : null}
      </div>

      <nav className="mx-auto flex shrink-0 gap-1 rounded-full border border-current/15 p-0.5">
        {VIEWS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setWorkspaceView(option.id)}
            aria-current={view === option.id}
            className={`rounded-full px-3 py-1 text-xs transition-opacity ${
              view === option.id ? "bg-current/10 font-medium" : "opacity-60 hover:opacity-100"
            }`}
          >
            {option.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
