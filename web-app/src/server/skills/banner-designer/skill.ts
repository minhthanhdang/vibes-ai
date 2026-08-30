import "server-only";
import type { Skill } from "@/server/skills/skill";

export const bannerDesigner: Skill = {
  name: "banner-designer",
  kind: "occupation",
  title: "Banner designer",
  summary:
    "Web and print banners: the standard sizes, safe areas, and how one message survives being ninety pixels tall.",
  text: `A banner is a strip with one job. It is seen for a second or two, usually
beside something the reader actually came for, and often at a size where a
paragraph is physically impossible. Everything about the craft follows from
that: one message, one image, one action, and a ruthless willingness to throw
out the second-best idea rather than shrink both.

The web sizes are standardised and worth knowing by heart, because a layout
that works at one aspect ratio rarely survives being poured into another. The
leaderboard is 728 by 90 and its large cousin 970 by 90 or 970 by 250. The
medium rectangle is 300 by 250 and is the most forgiving shape in the set — it
is nearly square, so it can hold a stacked headline over an image. The wide
skyscraper is 160 by 600, the half-page 300 by 600, and both are tall columns
where the layout runs vertically and the image sits above or below the words.
The mobile banner is 320 by 50 and holds a short phrase and a button and
nothing else. Site headers and hero strips are wider still — 1200 to 2400 pixels
across at ratios between 3:1 and 5:1 — and they are the only banners where a
second line of text is affordable.

Print banners work at the other end of the scale and the constraint inverts.
Roll-up stands are typically 850 by 2000 millimetres, pull-up banners similar,
and outdoor mesh banners run to several metres. The design rule for these is
viewing distance: everything below eye level on a roll-up is read by nobody,
so the top forty per cent carries the message and the bottom third carries only
what a person standing close will read. Large-format print is made at a
fraction of final size at reduced resolution, so a design that depends on fine
detail or hairline rules will not survive production.

A banner has a small number of standard slots and most good ones use three of
them: a headline, a supporting line, and a call to action. A logo occupies a
fourth, usually a corner, and an image occupies the ground beneath all of them.
The headline is the message and should be readable with the other three covered
up. The supporting line exists to qualify the headline and can almost always be
deleted. The call to action is a short verb phrase in a shape that reads as
pressable — a filled rectangle with generous padding, high contrast against
whatever is behind it, and enough separation from the headline that the two are
not read as one block.

Safe area is the discipline that keeps a banner alive across contexts. Nothing
that must be read should sit within about five per cent of any edge; formats
that get cropped — a header that reflows, a social cover shown at a different
ratio on a phone — need the essential content held in a centred region well
inside the frame. The corners are the least reliable real estate in any format
and are where decoration belongs, not information.

Surviving ninety pixels of height is a specific skill. At that height there is
room for one line of type at roughly 24 to 32 pixels of cap height, a small
logo and a button, laid out horizontally with the reading order running left to
right: mark, message, action. Stacking two lines at that height leaves each of
them too small to read at a glance and produces the characteristic unreadable
strip. If the message will not fit on one line it is the wrong message, not the
wrong size — cutting a nine-word headline to four is the actual work.

Hierarchy at a glance is measured differently from hierarchy on a page. A page
is scanned in a sequence; a banner is taken in one fixation, so the question is
not what is read first but what is seen at all. That makes size and contrast the
only two levers that reliably work, and colour, weight and position secondary.
The practical test is to look at the design blurred or at a tenth of its size:
whatever is still distinguishable is what the banner communicates, and if that
is the logo rather than the message the design has failed.

Images in banners are backgrounds, not subjects, and they fight the type by
default. The fixes are the ordinary ones — a solid or gradient scrim over the
region where the type sits, a deliberately empty area of the photograph placed
under the headline, or a hard split where the image occupies one side and the
words the other. A hard split is the most reliable of the three at small sizes
because it removes the contrast problem entirely rather than managing it.

The failure modes are consistent across the trade. Two competing messages, so
neither is read. A headline set to fit the space rather than the eye. Type
reversed out of a busy photograph. A logo enlarged until it is the loudest
element. Decoration in the safe margin. And a set of sizes made by scaling one
layout, which stretches a leaderboard's horizontal logic into a skyscraper and
leaves it with a headline three characters wide — every size in a family is laid
out again from its own proportions, sharing the palette, the type and the image
rather than the arrangement.`,
};
