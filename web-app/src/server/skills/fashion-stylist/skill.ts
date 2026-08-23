import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Fashion stylist — an occupation (compositor-v2.md §V.2).
export const fashionStylist: Skill = {
  name: "fashion-stylist",
  kind: "occupation",
  title: "Fashion Stylist",
  summary:
    "Lookbooks and shoots: silhouette, fabric and colourway, casting and fit, and how a set of looks reads as a collection.",
  text: `Styling is the craft of deciding what is in front of the camera when the subject
is clothing. It runs on three things — silhouette, fabric, colour — and on a
practical discipline of fit and preparation that decides whether a garment
photographs well or badly.

Silhouette is what a look reads as from across a room, and it is the first
decision. The vocabulary is proportional: volume above and narrow below or the
reverse, where the waist sits, where the hems break, how much space there is
between the body and the cloth. A look built on one clear proportional idea
survives being seen small and in motion. Mixing three volumes with no dominant
one produces a look nobody can describe afterwards.

Fabric decides how a garment moves and how it takes light. Structured cloth —
wool, denim, leather — holds a shape and reads as architectural. Fluid cloth —
silk, jersey, chiffon — falls and shows movement. Sheen changes exposure: satin
and sequins blow out under a hard source and need a softer one, matt cloth eats
light and needs more of it. Texture is what keeps a monochrome look from being
flat, and mixing weights within one colour is the standard way to build a look
that is quiet and still interesting.

Colour in a collection is a colourway rather than a palette: a small number of
tones, a stated relationship between them, and a rule for how they repeat across
looks. A collection reads as a collection when the palette is disciplined and the
silhouettes vary; when both vary, it reads as a rail.

Fit is most of the difference between amateur and professional work. Garments are
sampled in one size, so on a shoot they are pinned, clipped and taped at the back
to fit the person wearing them; hems are steamed, lint is removed, soles are
covered on unworn shoes. The camera sees every crease and every gap at the
shoulder. Preparation — steaming, pressing, the kit of pins, tape and clips — is
the unglamorous core of the job.

Casting is part of the styling, not separate from it: proportion, posture and how
somebody moves change the same garment completely. Hair, makeup and nails are
part of the look and have to be agreed with the same reference, or three
departments will each make a reasonable and incompatible choice.

Accessories finish a look and are where a stylist's authorship shows: shoes set
the register, a bag or a belt makes a proportion legible, jewellery is either a
single strong piece or a considered stack. The old discipline of removing one
thing before leaving still holds more often than not.

A lookbook is a sequence and is built like one. It usually opens with the look
that states the collection's argument, alternates volumes so consecutive pages do
not blur, groups colourways so the palette is legible, and ends on something
memorable rather than trailing off. Editorial styling has a different brief from
commercial: editorial serves a story and may distort a garment for it, commercial
must show what is being sold — the cut, the colour and the detail — with the
garment fully legible.

The failure modes: unpressed or unclipped garments, a look with no dominant
proportion, a palette so wide the collection has no identity, accessories that
compete with the clothes, and a shoot where hair, makeup and styling were
referenced separately and never reconciled.`,
};
