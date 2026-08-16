/// Why a model stopped, for the turns where it stopped with nothing.
///
/// Measured (iteration 15): a real turn asking for two things at once came back
/// with a candidate holding no text, no function call and 851 output tokens of
/// thinking. The loop's fallback turned that into a chat bubble reading "…" —
/// the director is told nothing, asked nothing, and billed for it. Vertex does
/// say why on every one of these; it says it in `finishReason`, which was being
/// dropped one field away from where the answer was read.
///
/// Pure and outside `server/` for the usual reason: the sentences are read by the
/// chat, and the parsing is the half a test can reach.

/// What the director is told when a round came back empty, by the reason Vertex
/// gave for it. Each one says what happened and what to do about it — a sentence
/// with no next step in it is the "…" bubble with more characters.
const FINISH_REPLIES: Record<string, string> = {
  /// The one seen live. The model wrote a tool call the API could not parse,
  /// which it does most readily when a message asks for two different tools at
  /// once. It is also the one worth retrying, so this sentence is what the
  /// director gets when the retry failed too.
  MALFORMED_FUNCTION_CALL:
    "I got in a muddle reaching for my tools on that one — ask me again, and one thing at a time if it was two.",
  MAX_TOKENS:
    "I ran out of room before I finished that answer — ask me again for a shorter version, or one part of it.",
  SAFETY: "I could not answer that one. Try asking it another way.",
  PROHIBITED_CONTENT: "I could not answer that one. Try asking it another way.",
  BLOCKLIST: "I could not answer that one. Try asking it another way.",
  SPII: "I could not answer that one. Try asking it another way.",
  RECITATION: "I stopped that answer partway through. Ask me again and I will put it differently.",
  IMAGE_SAFETY: "I could not answer about that picture.",
};

/// The generic one: a candidate with nothing in it and no reason given. Said
/// rather than swallowed, because the alternative is an assistant that appears to
/// have ignored the message.
const NOTHING_CAME_BACK = "I did not get an answer together for that one — ask me again?";

export function emptyReply(finishReason?: string) {
  return (finishReason && FINISH_REPLIES[finishReason]) || NOTHING_CAME_BACK;
}

/// The one empty answer worth paying for a second time.
///
/// A malformed function call is the model's own emission failing to parse — it
/// is not a refusal, a limit or a block, and the same request asked again
/// usually lands. Everything else in the table above is a decision: asking again
/// unchanged would buy the same answer, which is a round spent to be told no
/// twice.
export function retryableEmpty(finishReason?: string) {
  return finishReason === "MALFORMED_FUNCTION_CALL";
}

/// The reason off the response, without the caller having to know how deep it
/// sits. `STOP` is normal and is treated as no reason at all — it is what a
/// candidate that answered says, and an answer needs no explaining.
export function finishReasonOf(response: {
  candidates?: { finishReason?: string }[];
}): string | undefined {
  const reason = response.candidates?.[0]?.finishReason;
  return reason && reason !== "STOP" ? reason : undefined;
}
