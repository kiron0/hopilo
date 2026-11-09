import { describe, expect, it } from "vitest";
import { findTranscriptMatches, MAX_SEARCH_MATCHES } from "./transcriptSearch";
import type { Message } from "./api";

describe("bounded transcript search", () => {
  it("finds literal special characters and stable tool match IDs", () => {
    const messages: Message[] = [{ id: "m-1", sourceId: "s", role: "tool", createdAt: null,
      blocks: [{ type: "toolResult", name: "Bash", output: "a+b a+b", isError: false }] }];
    expect(findTranscriptMatches(messages, "a+b")).toEqual({ truncated: false, matches: [
      { matchId: "m-1-0-body-0", messageId: "m-1", messageIndex: 0 },
      { matchId: "m-1-0-body-1", messageId: "m-1", messageIndex: 0 },
    ] });
  });
  it("caps match metadata instead of allocating one entry per occurrence", () => {
    const messages: Message[] = [{ id: "m", sourceId: "s", role: "user", createdAt: null,
      blocks: [{ type: "text", text: "x".repeat(100_000) }] }];
    const result = findTranscriptMatches(messages, "x");
    expect(result.truncated).toBe(true);
    expect(result.matches).toHaveLength(MAX_SEARCH_MATCHES);
  });
});
