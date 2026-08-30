import { MainMenu } from "@excalidraw/excalidraw";
import { TidyItems } from "./tidy-items";
import type { ThemePreference, TidyTargets } from "../../types";

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
      <MainMenu.DefaultItems.ToggleTheme
        allowSystemTheme
        theme={preference}
        onSelect={onThemeChange}
      />
      <MainMenu.DefaultItems.ChangeCanvasBackground />
    </MainMenu>
  );
}