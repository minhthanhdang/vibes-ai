import "server-only";
import type { Skill } from "@/server/skills/skill";

/// Presentation designer — an occupation (compositor-v2.md §V.2).
export const presentationDesigner: Skill = {
  name: "presentation-designer",
  kind: "occupation",
  title: "Presentation Designer",
  summary:
    "Decks: one idea a slide, reading from the back of a room, charts that survive a projector, and a template that holds up.",
  text: `A deck is a sequence of slides that supports a person talking, or a document that
is read alone. These are two different artefacts and the most common problem in
the discipline is one file being asked to be both. A slide behind a speaker
should carry almost no text; a document to be read without a speaker needs the
argument written out. The professional answer is to make one of each, or to put
the detail in an appendix.

One idea per slide is the rule everything else follows from. The idea belongs in
the headline, written as a sentence that makes a claim — a headline that says
what the slide proves, rather than naming its topic, lets somebody flick through
and follow the argument. The rest of the slide is evidence for that sentence.

Legibility is set by the room. Type below roughly 24 points is unreadable from
the back, and the honest test is to look at the slide at thumbnail size: if it
cannot be understood there, it will not be understood in a hall. Contrast has to
survive a weak projector and ambient light, which rules out mid-grey on white and
thin light weights at small sizes.

The structure that works is narrative, not encyclopaedic. Situation, problem,
what is proposed, evidence, what is being asked for. A clear opening that says
what this is about, one line of argument, and a final slide that states the ask
explicitly. Section dividers give a long deck joints and let an audience know
where they are.

Charts on slides are stripped versions of charts in reports. One message a chart,
that message in the title, direct labels instead of a legend where possible, no
gridlines that are not needed, and colour used to point rather than to decorate:
one highlighted series against a neutral field says what matters far better than
six categorical colours. A table over about five rows by five columns is not a
slide, it is a handout.

Building — revealing parts of a slide in sequence — is worth using where the
audience would otherwise read ahead, and worth avoiding everywhere else. Every
animation is a thing that can misfire in the room, and transitions between slides
should be a single quiet default applied uniformly.

A template is what makes a long deck consistent and a shared deck survivable:
a title layout, a section layout, a standard content layout, a full-bleed image
layout, and a quote or statement layout, with a fixed grid, defined margins, a
type scale of a few steps and a stated palette. Templates fail when they are too
prescriptive to hold a real slide, so the layouts have to be tested against the
ugliest content the deck will actually contain.

Images earn their place by being large. A photograph used as a small decorative
box is worse than no photograph; full-bleed with type placed in a clear area of
the image is the treatment that reads. Text over a picture needs either a
naturally quiet region or a scrim, and low-resolution images stretched to full
screen are more damaging on a projector than anywhere else.

The failure modes: paragraphs on a slide read aloud by the speaker, topic
headlines that carry no argument, six charts on one slide, a colour scheme with
no neutral, inconsistent spacing from slide to slide, and a deck built for a room
then emailed to people who will read it alone.`,
};
