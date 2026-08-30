import "server-only";
import type { Skill } from "@/server/skills/skill";

export const focalPoint: Skill = {
  name: "focal-point",
  kind: "foundation",
  title: "Focal point",
  summary:
    "Where the eye lands inside a picture — the pulls that decide it, gaze and sharpness, one point per frame, and designing around it.",
  text: `Every picture has a point the eye lands on first, whether or not anyone chose
it. It is not the centre and not necessarily the subject: it is whatever wins
the competition of pulls, and the pulls have a fairly stable ranking. A face
outranks everything — and within a face, the eyes — which is why a figure in a
crowd scene is found instantly and why an unintended face in a background
hijacks a frame. After faces come words, which are read compulsively; then the
point of highest contrast against its surroundings; then the sharpest detail;
then the most saturated colour; then motion, real or implied. A picture whose
intended subject loses this contest to something incidental — a bright logo, a
blown-out window, a stranger's face — has a focal point, just not the one it
was made for.

Gaze is the strongest directional pull there is. A viewer looks where a
pictured person looks: a portrait facing the lens holds attention on itself,
while a figure looking at something hands the attention over, which makes an
eye-line the most reliable leading line available. It also leaks — a face
gazing out of the frame carries the viewer out with it, and a face gazing at
an empty area promotes that emptiness to a subject. Pointed things behave like
weak gazes: an outstretched arm, the nose of a car, the direction of implied
movement all push attention somewhere, and where they push should be somewhere
worth arriving.

Sharpness is attention rendered optically. In a photograph with any depth of
field at all, the plane in focus is a claim about what matters, and the eye
settles on the sharpest edge in the frame almost regardless of what it belongs
to. Selective focus — one subject crisp against soft surroundings — is the
most absolute focal device a photograph has, and its failure mode is just as
absolute: a frame where the wrong thing is sharp cannot be argued with by any
amount of arrangement, because the lens has already ruled.

A frame supports one focal point. Two pulls of equal strength make the eye
bounce between them without settling, which reads as busy and is remembered as
nothing; the repair is not removing the second but demoting it — smaller,
softer, less saturated, further from the light — until it is clearly a second
stop rather than a rival. A genuine pair, two faces or a figure and a named
thing, is handled by binding them: an eye-line from one to the other turns two
competitors into a path.

The focal point and its position in the frame are separate decisions. The
pulls decide where the eye lands; where that landing sits — centred and
formal, off-centre and dynamic, close to an edge and tense — is the frame's
business, and the placement only works if the point it is placing is actually
the one the eye goes to. The practical test survives any theory: shrink the
image, or squint at it until detail dissolves, and whatever still draws the
eye is the real focal point. If that is not the intended one, no placement
will save it.

Working with an existing picture starts with finding its focal point, because
every later decision is made relative to it. A crop must keep the focal point
clear of the cut edge with room to breathe, and a crop that promotes a new
focal point — tightening until a background detail becomes the biggest thing
left — has made a different picture, sometimes usefully and sometimes not.
Scale is judged the same way: a picture reduced until its focal point is a few
millimetres across has no focal point at that size, whatever it had at full
resolution, and a picture that reads at thumbnail size reads everywhere.

Anything placed alongside a picture negotiates with its focal point. Type
belongs in the frame's quiet areas — sky, shadow, blur, open ground — and a
headline laid across the focal point destroys both: the words fight the image
for the same landing spot and the image loses its subject under the words. The
negotiation runs at the scale of the whole piece too. A headline and a
pictured face are both first-rank pulls, and a layout that gives them equal
force has two firsts, which is none; either the image leads and the words
caption it, or the words lead and the image accompanies them, and the choice
is made on purpose or the viewer makes it at random.`,
};
