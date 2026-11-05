/**
 * Only let transcript markdown link to real web/mail destinations. Captured
 * chats are untrusted input, so `javascript:`, `data:`, `file:` and relative
 * URLs must never become clickable inside the app window.
 */
export function safeHref(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") {
      return value;
    }
  } catch {
    // Not an absolute URL.
  }
  return undefined;
}
