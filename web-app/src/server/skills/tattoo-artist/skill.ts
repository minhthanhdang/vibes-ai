import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Tattoo artist — an occupation (compositor-v2.md §V.2).
export const tattooArtist: Skill = {
  name: "tattoo-artist",
  kind: "occupation",
  title: "Tattoo Artist",
  summary:
    "Designing for skin: flow with the body, line weight and readability, how ink ages, and the established style traditions.",
  text: `A tattoo is a design applied to a curved, moving, living surface that will be
carried for decades. Three constraints separate it from every other drawing
discipline: the canvas has anatomy, the medium ages, and the result cannot be
revised.

Flow is the first consideration. A design is placed along the body's own lines —
the length of a forearm, the curve of a shoulder cap, the spiral of a calf — so
that it reads correctly when the limb is at rest and does not distort when it
moves. A rectangle laid flat on a round surface will foreshorten at the edges and
break; forms that wrap are drawn as if wrapping. Placement decides the shape of
the design before any of its content does, and stencils are always checked on the
body rather than judged on paper.

Readability at a distance is the practical test. Tattoos are seen from a couple
of metres, on a moving person, in ordinary light, so a strong silhouette, clear
separation between elements and open space matter far more than fine detail.
Negative space is structural: skin left bare is what allows a design to be read
at all, and packing every square centimetre is the most common way a piece
becomes an unreadable mass.

Line weight is the medium's grammar. Bold outlines hold a shape for life;
variation in line weight creates depth and hierarchy; fine lines are delicate now
and uncertain later. Traditional work uses heavy outlines, limited colour and
solid black precisely because those elements survive.

Ageing must be designed for. Ink spreads slowly in the skin, so lines thicken and
adjacent elements close up over years; fine detail and tight gaps blur first.
Sun exposure fades colour, some pigments more than others; white and pastel
pigments fade or discolour soonest, black and grey last longest. Skin stretches
and areas with high friction or movement — hands, feet, the inner side of joints
— hold ink less reliably. A design that only works when it is one week old is a
design that has failed.

Skin tone is a colour constraint, not an afterthought: the skin is the ground
that every pigment sits over, so contrast is judged against it, and value
structure carries more of the design than hue does on deeper tones. Black and
grey, bold outlines and strong contrast are the reliable answers.

The style traditions are real bodies of knowledge with their own rules. American
traditional keeps a limited palette, heavy black outlines and a bold simple
silhouette, and it survives ageing better than anything else. Japanese work is
built around whole-body composition, background wind and water that ties motifs
together, and a strict iconography. Blackwork and tribal use solid fields and the
negative shape as the design. Fine line and single needle work is delicate and
graphic and ages the least gracefully. Realism and portrait work depend on value,
soft edges and generous size, and cannot be made small.

Size and scale are decided by content. Every design has a minimum size below
which its detail cannot survive, and asking for a complex image on a small area
is the request most often refused by experienced artists.

Composition on the body is long-term planning: how a piece will sit beside future
work, whether a sleeve will be filled, where a background can later connect
separate motifs, and leaving room to expand rather than boxing the body in.

The failure modes: a design drawn flat without regard to anatomy, detail below
its survivable size, no negative space, thin lines relied on for structure,
colours chosen without reference to the skin they will sit over, and a piece
placed without any thought for what comes next.`,
};
