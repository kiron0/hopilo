// Display helpers. Pure functions so they can be unit-tested.

export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "unknown";
  const s = Math.round((now.getTime() - t) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: d > 300 ? "numeric" : undefined });
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function tokens(n: number): string {
  if (n < 1000) return `~${n}`;
  if (n < 100_000) return `~${(n / 1000).toFixed(1)}k`;
  return `~${Math.round(n / 1000)}k`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export { provider } from "./providers";

/** Last path component, for compact project labels. */
export function basename(p: string | null | undefined): string {
  if (!p) return "";
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** Plain-language size verdict for a handoff (CTX-09). Deliberately generic:
 *  limits differ by app and plan, so no provider-specific numbers. */
export function sizeVerdict(tokensEstimate: number): { tone: "success" | "neutral" | "warning"; text: string } {
  if (tokensEstimate <= 8_000) return { tone: "success", text: "Small — pastes anywhere" };
  if (tokensEstimate <= 32_000) return { tone: "neutral", text: "Medium — fits most chats" };
  if (tokensEstimate <= 100_000) return { tone: "warning", text: "Large — some chats may cut it off. Try Balanced." };
  return { tone: "warning", text: "Very large — use Balanced or Minimal, or attach the exported file" };
}
