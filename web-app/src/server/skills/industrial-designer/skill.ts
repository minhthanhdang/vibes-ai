import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Industrial designer — an occupation (compositor-v2.md §V.2).
export const industrialDesigner: Skill = {
  name: "industrial-designer",
  kind: "occupation",
  title: "Industrial Designer",
  summary:
    "Objects to be made and held: form and stance, ergonomics, colour-material-finish, and designing for a process.",
  text: `Industrial design is the design of objects that will be manufactured in quantity
and used by hands. Three constraints run through everything: it has to be
producible by a specific process, it has to be usable without instructions, and
it has to survive being made ten thousand times without drifting.

Form begins with proportion and stance. An object has a front, a posture and a
visual weight, and those read before any detail does — a shape that sits low and
wide feels stable, one that lifts off its base feels light. The vocabulary of the
craft is in the transitions: a hard edge, a chamfer, a constant-radius fillet or
a variable one all say different things about cost and quality, and consistency
of radius language across an object is one of the clearest markers of considered
design. Surfaces are judged by their highlights, because a continuous reflection
running across a form is what tells the eye the surfaces are properly tangent.

Ergonomics is measurement, not intuition. Anthropometric data gives the range of
hands, reaches and grips a product has to serve, and designing to a percentile
range rather than to an average is what keeps a handle usable by most people.
Grip diameters, button travel, the force needed to open a lid, the angle a
display is read at: these are specified and tested with physical models, because
nothing about how something feels in the hand is visible on a screen.

Affordance is the usability half of the form. A shape should suggest its own
use — a surface that says push, a recess that says pull, an asymmetry that says
which way up. Where the form cannot say it, a graphic or a detent has to.
Feedback matters as much: a click, a stop, a change of resistance tells somebody
their action registered.

Manufacturing process dictates form more than style does. Injection moulding
needs draft angles so parts release, uniform wall thickness to avoid sink marks,
ribs rather than thick sections for stiffness, and a parting line that has to go
somewhere visible. Sheet metal needs bend radii and relief cuts. Extrusion gives
a constant profile in one axis. Casting, machining and thermoforming each leave
their own signature. Designing without knowing the process produces drawings that
cannot be made or can only be made expensively.

Tolerance and assembly are where quality is actually perceived. Consistent gaps
between parts, flush surfaces, fasteners hidden or made deliberate, and an
assembly order that a factory can follow. A generous designed gap looks better
than a tight one that varies.

Colour, material and finish is treated as its own discipline. The same form in
matt soft-touch polymer, in anodised aluminium and in gloss white reads as three
different products at three prices. Material choice also carries the object's
repairability, recyclability and how it ages: some finishes wear into something
better, others just wear.

Prototyping is the method. Rough foam and printed models early to test
proportion and grip in the hand, appearance models for the look, engineering
prototypes for fit and function. Decisions made only on screen are the ones that
fail at the first physical model.

The failure modes: styling applied to a form that ignores its process, no draft
where a part must release, radii that vary without reason, ergonomics assumed
rather than measured, controls whose function has to be memorised, and a finish
specified from a swatch that was never seen on the real material.`,
};
