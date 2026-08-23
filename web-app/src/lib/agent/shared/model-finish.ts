/// Why a model stopped, for the turns where it stopped with nothing.

/// What the user is told when a round came back empty, by the reason Vertex
/// gave for it.
const FINISH_REPLIES: Record<string, string> = {
  /// The one worth retrying, so this sentence is what the user gets when the
  /// retry failed too — `retryableEmpty` below names the same reason.
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

/// A candidate with nothing in it and no reason given.
const NOTHING_CAME_BACK = "I did not get an answer together for that one — ask me again?";

export function emptyReply(finishReason?: string) {
  return (finishReason && FINISH_REPLIES[finishReason]) || NOTHING_CAME_BACK;
}

/// The one empty answer worth paying for a second time.
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
