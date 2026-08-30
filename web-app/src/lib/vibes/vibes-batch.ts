import {
  VIBES_BATCH_PAGE_LIMIT,
  VIBES_DESIGN_LIMIT,
  VIBES_FORM_LIMIT,
  vibesBrief,
  type VibesBrief,
} from "@/lib/vibes/vibes-brief";
import { vibesJob } from "@/lib/vibes/vibes-queue";

export type VibesBatchForm = { brief: VibesBrief; designs: number };

export function vibesBatchTotals(
  forms: readonly { pages: number; designs: number }[],
): { boards: number; pages: number } {
  return {
    boards: forms.reduce((sum, form) => sum + form.designs, 0),
    pages: forms.reduce((sum, form) => sum + form.designs * form.pages, 0),
  };
}

export function vibesBatch(asked: unknown): VibesBatchForm[] | null {
  if (!Array.isArray(asked)) return null;
  if (asked.length < 1 || asked.length > VIBES_FORM_LIMIT) return null;

  const forms: VibesBatchForm[] = [];
  for (const card of asked) {
    if (!card || typeof card !== "object" || Array.isArray(card)) return null;
    const { designs, take } = card as Record<string, unknown>;
    if (typeof designs !== "number" || !Number.isInteger(designs)) return null;
    if (designs < 1 || designs > VIBES_DESIGN_LIMIT) return null;
    if (take !== undefined) return null;
    const brief = vibesBrief(card as Record<string, unknown>);
    if (!brief) return null;
    forms.push({ brief, designs });
  }

  const { pages } = vibesBatchTotals(
    forms.map(({ brief, designs }) => ({ pages: brief.pages, designs })),
  );
  if (pages > VIBES_BATCH_PAGE_LIMIT) return null;

  return forms;
}

export const VIBES_SETTLED_WINDOW_MS = 2 * 60 * 1000;

export function vibesSettledCutoff(now: Date): Date {
  return new Date(now.getTime() - VIBES_SETTLED_WINDOW_MS);
}

export type VibesPageState = "designed" | "designing" | "waiting" | "refused" | "empty";

export type VibesQueueRow = {
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: Date;
};

export type VibesBatchBoard = {
  boardId: string;
  title: string;
  total: number;
};

export type VibesBoardProgress = {
  boardId: string;
  title: string;
  total: number;
  designed: number;
  empty: number;
  settled: number;
  live: boolean;
  finished: boolean;
  refusal: string | null;
  pages: { index: number; state: VibesPageState }[];
  label: string;
};

type PageReading = {
  index: number;
  state: VibesPageState;
  reason: string | null;
  live: boolean;
  startedAt: Date;
};

function pageReading(row: VibesQueueRow, index: number): PageReading {
  const at = { index, startedAt: row.startedAt };
  if (row.status === "QUEUED" || row.status === "RUNNING")
    return { ...at, state: "designing", reason: null, live: true };
  if (row.status === "FAILED")
    return { ...at, state: "refused", reason: row.error ?? "the page failed", live: false };

  const output =
    typeof row.output === "object" && row.output !== null && !Array.isArray(row.output)
      ? (row.output as Record<string, unknown>)
      : {};
  if (output.outcome === "empty") return { ...at, state: "empty", reason: null, live: false };
  if (output.outcome === "refused")
    return {
      ...at,
      state: "refused",
      reason: typeof output.reason === "string" ? output.reason : "the page was refused",
      live: false,
    };
  return { ...at, state: "designed", reason: null, live: false };
}

function truer(claim: PageReading, held: PageReading): boolean {
  if (claim.live !== held.live) return claim.live;
  return claim.startedAt.getTime() >= held.startedAt.getTime();
}

function pagesSaid(count: number) {
  return count === 1 ? "1 page" : `${count} pages`;
}

export function vibesBatchProgress(
  rows: readonly VibesQueueRow[],
  boards: readonly VibesBatchBoard[],
): VibesBoardProgress[] {
  const readings = new Map<string, Map<number, PageReading>>();
  for (const row of rows) {
    const job = vibesJob(row.input);
    if (!job) continue;
    const board = readings.get(job.boardId) ?? new Map<number, PageReading>();
    readings.set(job.boardId, board);
    const claim = pageReading(row, job.index);
    const held = board.get(job.index);
    if (!held || truer(claim, held)) board.set(job.index, claim);
  }

  return boards.flatMap((board) => {
    const perPage = readings.get(board.boardId);
    if (!perPage) return [];
    const known = [...perPage.keys()].filter((index) => index < board.total);
    if (known.length === 0) return [];

    const head = Math.min(...known);
    const pages = Array.from({ length: board.total }, (_, index) => {
      const reading = perPage.get(index);
      if (reading) return { index, state: reading.state };
      return { index, state: (index < head ? "designed" : "waiting") as VibesPageState };
    });

    const walking = [...perPage.values()].find((reading) => reading.live) ?? null;
    const refused = [...perPage.values()].find((reading) => reading.state === "refused") ?? null;
    const designed = pages.filter((page) => page.state === "designed").length;
    const empty = pages.filter((page) => page.state === "empty").length;
    const waiting = pages.some((page) => page.state === "waiting");

    return [
      {
        boardId: board.boardId,
        title: board.title,
        total: board.total,
        designed,
        empty,
        settled: [...perPage.values()].filter((reading) => !reading.live).length,
        live: walking !== null,
        finished: !walking && !refused && !waiting,
        refusal: refused?.reason ?? null,
        pages,
        label: walking
          ? `Designing page ${walking.index + 1} of ${board.total}…`
          : refused
            ? `Page ${refused.index + 1} was not designed — ${refused.reason}`
            : waiting
              ?
                `Stopped — ${pagesSaid(designed)} of ${board.total} designed`
              : designed === board.total
                ? `${pagesSaid(designed)} designed`
                : empty > 0
                  ? `${pagesSaid(designed)} of ${board.total} designed — ${pagesSaid(empty)} came back empty`
                  : `${pagesSaid(designed)} of ${board.total} designed`,
      },
    ];
  });
}
