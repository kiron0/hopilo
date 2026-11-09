import type { CopyOptions } from "../lib/api";
import { INTENTS } from "../lib/handoff";

export function mockHandoffText(transcript: string, format: string, opts: CopyOptions = {}, sessions = 1) {
  const note = opts.note ? `\n\n${opts.note}` : "";
  if (format !== "txt") return `Development transcript preview · ${format}\n\n${transcript}${note}`;
  const intent = INTENTS.find((item) => item.id === opts.intent) ?? INTENTS[0];
  const ask = opts.intent === "custom" && opts.instructions?.trim()
    ? opts.instructions.replaceAll("{title}", "Development handoff").replaceAll("{sessions}", String(sessions))
    : `${intent.label}: ${intent.hint}`;
  const body = opts.style === "markdown" ? `===== BEGIN PREVIOUS SESSION =====\n${transcript}\n===== END PREVIOUS SESSION =====` : `<previous_session>\n${transcript}\n</previous_session>`;
  return opts.style === "contextFirst"
    ? `Development prompt preview\n\n${body}\n\n${ask}${note}`
    : `Development prompt preview\n\n${ask}${note}\n\n${body}`;
}
