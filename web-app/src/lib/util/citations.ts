/// The house style cites a spec section by number — `tech-spec §III.4`,
/// `infra.md §X`, `§V.5` — and those numbers are the one part of a doc that
/// cannot be kept honest by reading it: a section renumbered or lost takes
/// hundreds of call sites with it silently. It happened. `tech-spec.md` was
/// destroyed and rebuilt from transcripts, and the rebuild swallowed `§III.4`'s
/// heading; the fourteen comments citing it pointed at nothing for a day, and
/// nothing said so.
///
/// `npm run cites` resolves them. This module is the part of it that is a
/// function of text rather than of the checkout: what a doc *defines* and what
/// a comment *cites*. Reading `context/` cannot be a test case — it is
/// gitignored on purpose, so a suite that read it would fail on a fresh clone —
/// but the two parsers can be, and they are where the answers come from. A
/// widening here is the dangerous kind of bug: the script goes on reporting
/// that every citation resolves, having stopped asking.
///
/// It lives under `src/` rather than beside the script because the test glob is
/// `src/**/*.test.mts`, and it imports nothing — no `fs`, no `context/` — so
/// nothing in the app that never imports it pays for it.

export type Citation = {
  /// 1-based, so a report reads as `path:line` a terminal can open.
  line: number;
  id: string;
  /// The doc the citation names, resolved to a filename; absent when it names
  /// none.
  doc?: string;
};

/// What a doc defines, as ids a comment could write. `## VII.` is a section and
/// `### 4.` under it is `VII.4`. A numbered *list item* is one too — `canvas.md`
/// §XIII's invariants and `moodboard.md` §II's steps are cited by number and
/// neither is a heading — but only where the section is a list and nothing else:
/// `tech-spec.md` §III's cropper steps are numbered 1–4 inside §III.3, and
/// counting those as §III.1–§III.4 would answer for the headings of that name
/// whether or not they still exist, which is the one question this is here to
/// ask.
export function sectionIds(text: string): Set<string> {
  const ids = new Set<string>();
  let section = "";
  let headed = false;
  let listed: string[] = [];
  const close = () => {
    if (!headed) for (const id of listed) ids.add(id);
    headed = false;
    listed = [];
  };
  for (const line of text.split("\n")) {
    const top = /^##\s+([IVXLC]+)[.)]\s/.exec(line);
    if (top) {
      close();
      section = top[1]!;
      ids.add(section);
      continue;
    }
    if (!section) continue;
    /// A heading numbers itself with or without the dot — `### 4. Cropper` and
    /// `#### 5.1 The picture` are both in `tech-spec.md` — while a list item
    /// always carries one, which is what keeps an ordinary sentence starting
    /// with a number out of either list.
    const heading = /^#{3,4}\s+(\d+(?:\.\d+)*)[.)]?\s/.exec(line);
    if (heading) {
      headed = true;
      ids.add(`${section}.${heading[1]}`);
      continue;
    }
    const item = /^(\d+(?:\.\d+)*)[.)]\s/.exec(line);
    if (item) listed.push(`${section}.${item[1]}`);
  }
  close();
  return ids;
}

/// A citation naming a doc has to resolve in *that* doc; a bare `§X` may
/// resolve anywhere. Bare ones are genuinely ambiguous — `§II.8` in
/// `moodboard-caption.ts` is `moodboard.md`'s and reads perfectly in context —
/// so holding them to one doc would report agreement as a fault.
const DOC_OF: Record<string, string> = {
  "tech-spec": "tech-spec.md",
  "tech-spec.md": "tech-spec.md",
  infra: "infra.md",
  "infra.md": "infra.md",
  canvas: "canvas.md",
  "canvas.md": "canvas.md",
  moodboard: "moodboard.md",
  "moodboard.md": "moodboard.md",
};

const CITATION = /(?:([\w.-]+)\s+)?§\s?([IVXLC]+(?:\.\d+)*)/g;

/// Every `§` in a file, in reading order. A word before the mark is only a doc
/// name if it is one of the docs — `see §X` and `and infra §X` are both
/// citations, and only the second names where to look.
export function citationsIn(text: string): Citation[] {
  const found: Citation[] = [];
  text.split("\n").forEach((line, index) => {
    for (const [, prefix, id] of line.matchAll(CITATION)) {
      const doc = prefix ? DOC_OF[prefix] : undefined;
      found.push({ line: index + 1, id: id!, ...(doc && { doc }) });
    }
  });
  return found;
}

/// `docs` keyed by filename, as `sectionIds` read them.
export function resolves(citation: Citation, docs: ReadonlyMap<string, ReadonlySet<string>>): boolean {
  const where = citation.doc ? [citation.doc] : [...docs.keys()];
  return where.some((doc) => docs.get(doc)?.has(citation.id));
}
