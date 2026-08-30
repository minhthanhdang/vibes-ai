const FINISH_REPLIES: Record<string, string> = {
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

const NOTHING_CAME_BACK = "I did not get an answer together for that one — ask me again?";

export function emptyReply(finishReason?: string) {
  return (finishReason && FINISH_REPLIES[finishReason]) || NOTHING_CAME_BACK;
}

export function retryableEmpty(finishReason?: string) {
  return finishReason === "MALFORMED_FUNCTION_CALL";
}

export function finishReasonOf(response: {
  candidates?: { finishReason?: string }[];
}): string | undefined {
  const reason = response.candidates?.[0]?.finishReason;
  return reason && reason !== "STOP" ? reason : undefined;
}
