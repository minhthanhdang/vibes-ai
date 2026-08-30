<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Comments
No prose comments in code — no explanations of why a rule exists, no citations
of spec sections (§), no business context. Names and structure carry the what;
the why lives in `context/` docs. Only tool directives are allowed
(`eslint-disable`, `@ts-expect-error`, `prettier-ignore`). The old `///`
house-voice commentary was deliberately removed on 2026-08-30 — do not
reintroduce it.

## PR titles
Conventional commit format: `type(scope): subject`. Example: `fix(import): skip client-redirect stubs`. Do not put linear ticket in the title.

