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
