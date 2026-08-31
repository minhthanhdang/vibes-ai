# PRODUCT SPECIFICATION

Item 1 stopped being an agent on 2026-08-16 — the user brings their own
references now. Item 5 stopped being an agent on 2026-08-23 — a deck is one
slide per page, which is arithmetic, not judgement. Both keep their slots rather
than renumbering: items 2–5 are referred to by these numbers in the tech spec,
the code and the commit history, and only 2, 3, 4 and 6 are agents.

1. Reference intake. The user uploads their own references — file picker and
   drag-and-drop. Not an agent. No browsing, no scraping, no fetching images
   from third-party sites on the user's behalf.

2. An AI agent that can analyze and point out properties of a reference:
 - Color Palette: Warm tones bring cozy feelings. Cool tones create calm moods. High saturation adds energy. Muted tones look vintage.
 - Lighting Style: High-key light adds airiness. Low-key light adds drama. Golden hour creates romance. Harsh light looks gritty.
 - Texture & Grain: Film grain adds nostalgia. Sharp focus looks modern. Motion blur adds energy. Soft focus looks dreamy.
 - Composition & Space: Negative space creates isolation. Tight framing adds intimacy. Leading lines guide focus. Symmetry brings order.
 - Subject & Context: Candid shots feel authentic. Posed shots feel deliberate. Urban settings look edgy. Nature scenes feel peaceful.
 - Contrast & Depth: High contrast adds punch. Low contrast softens mood. Deep depth focuses details. Shallow depth isolates subjects.

3. An AI agent that can crop a piece of the image based on the what the user wants from the reference.

4. An AI agent that can place the reference piece on the moodboard.

5. A presentation generated from the moodboard. Not an agent. One slide per
   page, in the board's reading order, each slide carrying that page's render.
   The board already decided what the deck says — every judgement was made when
   the pages were designed — so turning it into slides is a mapping, not a
   model call. Nothing on this path talks to Gemini.

6. An AI agent that orchestrates agents 2–4, and calls item 5 as an ordinary
   function.

7. A centralized integrated experience for users.

## Account tiers

Three tiers, assigned once at signup and stored on `User.tier`. The numbers live
in one table, `src/lib/limits/account-tier.ts`; changing an allowance is one edit
inside it.

| | Tier 1 (judges code) | Tier 2 (Google) | Tier 3 (email + password) |
|---|---|---|---|
| Projects | 5 | 1 | 1 |
| Gallery images (per account) | 100 | 20 | 15 |
| Conversations per project | 8 | 2 | 1 |
| Vibes boards (lifetime) | unlimited | 4 | 2 |

Judges enter with a code held in `JUDGE_SIGNUP_CODES` — an environment secret,
never a committed constant, since the repo is public. Unset means no tier-1
signup is possible, the same "unset is closed, not open" rule the worker secrets
follow. The code is checked before the account is created on the password path,
and rides the Google round trip as a sha256 inside the httpOnly pending-flow
cookie, re-validated in the callback: a boolean there would be a free upgrade for
anyone who forged the cookie.

Tier is fixed at signup with one exception — presenting a valid code later raises
an existing account to tier 1, never lowers it, so a judge who signed in with
Google before being handed the code is not stuck.

A gallery image is an *original*: `sourceReferenceId IS NULL`, which is exactly
what the gallery grid renders, so the number the user is told matches the tiles
they can count. Crops and hand-drawn versions are derived and exempt. A vibes
"board" is Σ(forms × samples) and is counted as a lifetime total on
`User.vibesBoardsUsed`, charged up front by a guarded `updateMany` — so deleting a
board does not refund model calls that were already paid for, and the claim has
no race.

The other three quotas count rows and can overshoot by one under concurrency.
That is accepted: the overshoot is bounded, it self-heals on the next request,
and no unique index can express "at most N rows".

Refusals are `FORBIDDEN`, never `TOO_MANY_REQUESTS` — a tier cap is a standing
no, not a "retry later" some clients would retry on its own.

## Seeded projects

A judge lands on work already in progress rather than on an empty list. The
account is given every project in `src/server/seed/`, written by
`seedJudgeProjects` on both signup doors the moment the code is accepted — the
password path after the row is created, the Google path after the callback
resolves the identity, which covers the account raised to tier 1 later as well.
An account that already holds a project is left alone, so signing in twice does
not stack a second copy, and a seed that fails to write is logged and swallowed:
nobody is refused a login because the demo content did not land.

The first seed is `italian-restaurant-menu` — 47 Gemini-drawn dishes, drinks and
bottles, each with the analysis agent 2 already wrote for it, so "Let's Vibes"
works on the first click without paying for a batch of reads.

The bytes are shared. A seed's pictures live under `seeds/<slug>/` in the same
bucket, outside the `projects/<id>/references/` prefix every upload of the app
goes to, and each judge's `Reference` rows point at that one copy. Nothing
deletes them: `deleteProjectUpload` recognises only the project prefix, so a
judge discarding a picture drops their row and leaves the object standing for
everyone else. They stay private — access is the row, not the object, and the
image route signs a URL per request exactly as it does for an upload.

`npm run seed:export -- --project <id> --slug <slug> --apply` is what makes one:
it copies the originals of a project into the seed prefix and writes the
manifest beside them. Without `--apply` it prints what it would copy.
