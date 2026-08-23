/// The two shapes every declaration in this layer is written against: what a
/// tool looks like on the wire, and what the project holds that decides whether
/// it is declared at all.
///
/// Kept pure and out of `server/` because both sides need it: the executor
/// builds these values, the chat renders them.

/// The function-calling shape Vertex takes, declared once and here rather than
/// taken from the SDK: every declaration in this layer writes `type: "OBJECT"`
/// as a string literal and the SDK's `Schema` wants its `Type` enum, so the
/// cast is made once, at the seam.
export type ToolDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/// What the project has, in the three counts that decide which tools are worth
/// declaring. Read off the same query that primes the turn, so it costs
/// nothing.
export type ProjectState = {
  photographs: number;
  crops: number;
  boards: number;
  /// How many of those pictures this assistant drew rather than the user
  /// bringing them. It gates nothing — a drawn picture is shown, cut and
  /// composed like any other — and is read only by the sentences that tell the
  /// model to prefer what the project already holds, which say something false
  /// on a project holding nothing but its own drawings. Optional on the same
  /// terms as `origin` is on a reference: a caller that has not counted them is
  /// not claiming there are none.
  generated?: number;
};
