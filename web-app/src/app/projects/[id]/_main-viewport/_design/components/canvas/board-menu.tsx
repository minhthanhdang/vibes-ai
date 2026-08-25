import { MainMenu } from "@excalidraw/excalidraw";
import { TidyItems } from "./tidy-items";
import type { ThemePreference, TidyTargets } from "../../types";

/// Excalidraw's menu, minus what this product does not have and plus a theme
/// control that works. Listed rather than defaulted because the default menu
/// ends in an "Excalidraw links" group — GitHub, X, Discord — which is somebody
/// else's product inside ours, and because two of its items (open a file, save
/// to a file) are switched off above and would render as dead entries.
///
/// Everything kept is a feature a moodboard wants and excalidraw already has:
/// exporting the board as an image, finding text on a large canvas, the command
/// palette, the shortcut sheet, the canvas background, and resetting the board.
///
/// `SaveAsImage` is kept even though `UIOptions` switches the action off —
/// `DefaultItems` rendered here bypass those gates, and all the item does is ask
/// for the export dialog, which `DesignCanvas` answers with the board's own.
/// So the menu entry, its ⌘⇧E shortcut and the command palette's export all
/// arrive at one place.
///
/// Tidy arrives at the top of it (`canvas.md` §VI). This app's own action goes
/// above excalidraw's, and above the separator, because it is the only entry
/// here that acts on what the user put on the board rather than on the document
/// — and because a board with fewer than two units offers neither entry, so the
/// menu below has to read the same with them absent.
export function BoardMenu({
  preference,
  onThemeChange,
  tidy,
  byColour,
  onTidy,
}: {
  preference: ThemePreference;
  onThemeChange: (preference: ThemePreference) => void;
  tidy: TidyTargets;
  byColour: boolean;
  onTidy: (order?: "colour") => void;
}) {
  return (
    <MainMenu>
      <TidyItems
        scope={tidy.scope}
        units={tidy.units}
        photos={tidy.photos}
        frames={tidy.frames}
        pages={tidy.pages}
        byColour={byColour}
        onTidy={onTidy}
      />
      {tidy.units >= 2 ? <MainMenu.Separator /> : null}
      <MainMenu.DefaultItems.SaveAsImage />
      <MainMenu.DefaultItems.SearchMenu />
      <MainMenu.DefaultItems.CommandPalette />
      <MainMenu.DefaultItems.Help />
      <MainMenu.DefaultItems.ClearCanvas />
      <MainMenu.Separator />
      {/* Three-way rather than a flip: without "system" the only way back to
          following the OS is remembering which way the OS is set. */}
      <MainMenu.DefaultItems.ToggleTheme
        allowSystemTheme
        theme={preference}
        onSelect={onThemeChange}
      />
      <MainMenu.DefaultItems.ChangeCanvasBackground />
    </MainMenu>
  );
}