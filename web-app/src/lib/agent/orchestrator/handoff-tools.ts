import { EVERYTHING, idsFrom } from "@/lib/agent/orchestrator/state";
import type { ProjectState, ToolDeclaration } from "@/lib/agent/shared/tool-declaration";

export function designPageFor({ photographs, crops }: ProjectState): ToolDeclaration {
  const pictures = photographs + crops;
  return {
    name: "design_page",
    description: [
      "Hand one page of a board to the designer and get a page back that was arranged by judgement rather than fitted to a template. It reads the board, chooses from the project's pictures, draws and crops what it needs, and puts everything where it decides — any size, any position, no slots.",
      "It is the most expensive tool you have by an order of magnitude — its own model, looking at the page it is making, over several rounds — so call it for the page they actually asked for and not to illustrate a point.",
      "This is the only way a page is laid out, whatever the user called the thing: a moodboard, a grid, a sign, a banner, an album spread, a poster, a cover. It is the answer when the ask is about arrangement in words nothing else here can act on (“make the headline sit over the top third”, “give it room to breathe”, “the two portraits should face each other”), and it is also the only way anything already standing on a page is changed: one picture put in the place of another, two pictures trading places, a picture carried onto a different page, a typo in a headline, a line added or taken off. You have no call for any of those, and this one takes them as readily as it takes a whole page — say in the intention which one thing they asked to change, and it changes that and leaves the rest of the page standing.",
      "It answers with its own closing line, which is yours to say to the user in fewer words rather than to quote, and with a read of the page it left: the pictures on it, the ones you named that are not, what it drew or cut to make it, and anything sitting beside the page rather than on it. Write your reply off that read — it chooses for itself, so what you asked for is not what happened.",
      "A board is where a page comes from, and add_board is where a board comes from: on a project with no board, call that first and pass the pageId it gives back to this.",
    ].join(" "),
    parameters: {
      type: "OBJECT",
      properties: {
        boardId: {
          type: "STRING",
          description: "The board to design on, by an id from your instructions or list_boards.",
        },
        intention: {
          type: "STRING",
          description:
            "What the page is for, in the user's own words — the thing they asked for and the look they asked for it in. It is the only part of this call the designer cannot read off the board, so pass what they said rather than a summary of it. A shape is part of what a page is *for*, and this string is the only place one can travel: the call carries no format of its own and the designer draws the page's rectangle from what this says. So when they name a format, or accept one you recommended, it goes here in their words — a suggestion they said yes to is part of what they asked for and not part of your reply.",
        },
        pageId: {
          type: "STRING",
          description:
            "Which page of that board to design, by an id from an inspect_board pages list. Leave it out on a board of one page. On a board of several, read it with inspect_board first and name the page the user is talking about — the designer reads the board either way, but a page nobody named is a page it has to choose. With newPage it means something else: the page the new one goes beside.",
        },
        newPage: {
          type: "BOOLEAN",
          description:
            "Design onto a fresh page added to that board instead of onto one it already has — for “try another version”, “a poster for the exteriors as well”, anything that asks for more board rather than a different page. Nothing already on the board is moved or written over, so a page that works costs nothing to keep. The shape of that page is the designer's to draw and never the board's to impose: a board of landscape pages takes a portrait page beside them. This flag carries no format, so one that matters belongs in the intention.",
        },
        ...(pictures > 0
          ? {
              imageIds: {
                type: "ARRAY",
                description: `Pictures the user named, by ids from ${idsFrom(crops)}. Pass only the ones they actually pointed at: the designer can see the whole gallery and chooses for itself, and a list you assembled for it is a decision taken away from the one tool here that is paid to make it. Ids this project has not got are reported back rather than refused.`,
                items: { type: "STRING" },
              },
            }
          : {}),
      },
      required: ["boardId", "intention"],
    },
  };
}

export const DESIGN_PAGE = designPageFor(EVERYTHING);
