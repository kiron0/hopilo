import type { Message } from "./api";

export const MAX_SEARCH_MATCHES = 2_000;
export interface TranscriptMatch { matchId: string; messageId: string; messageIndex: number }

export function findTranscriptMatches(messages: Message[], query: string) {
  const matches: TranscriptMatch[] = [];
  if (!query.trim()) return { matches, truncated: false };
  const pattern = new RegExp(query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  for (const [messageIndex, message] of messages.entries()) {
    for (const [blockIndex, block] of message.blocks.entries()) {
      const body = block.type === "toolCall" ? block.input : block.type === "toolResult" ? block.output
        : block.type === "text" ? block.text : block.type === "missing" ? block.description : block.name;
      const prefix = `${message.id}-${blockIndex}${block.type === "toolCall" || block.type === "toolResult" ? "-body" : ""}`;
      pattern.lastIndex = 0;
      let occurrence = 0;
      while (pattern.exec(body)) {
        if (matches.length === MAX_SEARCH_MATCHES) return { matches, truncated: true };
        matches.push({ matchId: `${prefix}-${occurrence++}`, messageId: message.id, messageIndex });
      }
    }
  }
  return { matches, truncated: false };
}
