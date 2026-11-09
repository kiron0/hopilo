import { expect, it } from "vitest";
import { mockHandoffText } from "./handoffPreview";

it("updates development prompt preview for built-in and custom intents", () => {
  const transcript = "user: Keep this exact conversation";
  const outputs = (["continue", "review", "summary", "debug"] as const).map((intent) => mockHandoffText(transcript, "txt", { intent }));
  expect(new Set(outputs).size).toBe(4);
  expect(outputs.every((text) => text.includes(transcript))).toBe(true);
  expect(outputs[1]).toContain("Critique");
  const custom = mockHandoffText(transcript, "txt", { intent: "custom", instructions: "Test {sessions} sessions in {title}", note: "Focus on auth" }, 2);
  expect(custom).toContain("Test 2 sessions in Development handoff");
  expect(custom).toContain("Focus on auth");
  expect(mockHandoffText(transcript, "md", { intent: "review" })).toBe(mockHandoffText(transcript, "md", { intent: "debug" }));
});
