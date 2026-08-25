/// Excalidraw's own island variables rather than the app's: the board has its
/// own theme control, so a button painted in the page's colours would be the one
/// light thing on a dark canvas.
///
/// Beside the two controls that wear it rather than inside either: the page
/// buttons and "Let's Vibes" are two islands in one row and have to be the same
/// shape, and a rule one of them owned would make the other's import read as a
/// dependency it does not have.
export const ISLAND_BUTTON =
  "h-9 px-2.5 text-xs text-[var(--text-primary-color)] hover:bg-[var(--button-hover-bg)]";
export const ISLAND =
  "flex h-9 items-stretch overflow-hidden rounded-lg border border-[var(--default-border-color)] bg-[var(--island-bg-color)] shadow-sm";
