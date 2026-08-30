import "server-only";
import type { Skill } from "@/server/skills/skill";

export const uxDesigner: Skill = {
  name: "ux-designer",
  kind: "occupation",
  title: "UX Designer",
  summary:
    "Flows before screens: tasks and information architecture, wireframes, states and errors, and testing with real people.",
  text: `User experience design is the design of what happens, in what order, and what it
is called. It sits before visual layout: the same screen can be beautiful and
still be part of a flow that nobody can complete, and no amount of styling
repairs a task that was modelled wrongly.

The unit of work is the task, not the page. A flow is drawn as a sequence of
steps with decisions and dead ends marked — where somebody enters, what they have
to supply, what the system does, where they can fail, and what happens then. Most
serious problems are visible on that diagram: unnecessary steps, information
demanded before it is available, and paths with no way back.

Information architecture is naming and grouping, and it is the least glamorous
and most load-bearing part of the discipline. Categories should match how people
actually think about the domain rather than how the organisation is structured;
card sorting and tree testing exist to find that out cheaply. Labels are written
in the audience's vocabulary, and the same thing is called the same thing
everywhere — inconsistent naming is experienced as complexity even when the
structure is simple.

Wireframes are arguments about content and priority, deliberately unstyled so
that discussion stays on what is there and in what order. They are quick, they
are thrown away, and their fidelity should stay low until the flow is settled.

States are the real work. Every screen has an empty state, a loading state, a
partial state, an error state and a state with far more data than the design
assumed, and each has to be specified. The empty state usually gets the least
attention and is seen by every newcomer; the overloaded state is where layouts
collapse. Errors deserve particular care: say what went wrong, in plain language,
and say what to do next, at the place where the problem is rather than in a
banner at the top.

Forms are where most flows are lost. Ask for the minimum, group related fields,
label above the field rather than inside it so the label survives typing,
validate at a sensible moment rather than on every keystroke, keep entered data
after a failure, and never make somebody re-enter something already supplied.
Sensible defaults do more for completion rates than any amount of visual polish.

Feedback and control are the two obligations. Every action gets a visible
response, slow operations show progress rather than freezing, and destructive
actions are either confirmed or undoable — undo is almost always the better
choice, because confirmation dialogs are dismissed reflexively.

Cognitive load is reduced by recognition over recall, by consistency with
platform conventions people already know, and by progressive disclosure: show
the common path and keep the rare options one level away rather than presenting
everything at once.

Accessibility is a design requirement, not a compliance pass at the end: full
keyboard operation, visible focus, sufficient contrast, meaningful labels for
assistive technology, and not using colour as the only carrier of meaning.

Research is what keeps the whole thing honest. Five people attempting a real task
while thinking aloud will surface most of the serious problems, and watching
somebody fail at a step that seemed obvious is the fastest correction available.
Opinions in a review meeting are not a substitute.

The failure modes: designing screens before flows, structure that mirrors an
organisation chart, undesigned empty and error states, forms that ask for more
than is needed, destructive actions with no way back, and a design validated only
by the people who made it.`,
};
