/// Which surface the main viewport is showing. The gallery is where references
/// arrive, the design view is where they are composed, and the preview is where
/// the composed pages are flipped through as slides; they want the same column
/// and all of it, so they take turns rather than splitting it.
export type WorkspaceView = "gallery" | "design" | "preview";
