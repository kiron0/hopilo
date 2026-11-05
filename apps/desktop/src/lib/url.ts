export function safeHref(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") {
      return value;
    }
  } catch {}
  return undefined;
}
