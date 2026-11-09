import { api, type SyntaxToken } from "./api";
import { MAX_HIGHLIGHT_CODE } from "./markdown";

const results = new Map<string, Promise<SyntaxToken[][] | null>>();

export function highlightCode(code: string, language: string): Promise<SyntaxToken[][] | null> {
  if (code.length > MAX_HIGHLIGHT_CODE || code.split("\n").length > 1000 || !language || /^(text|txt|plain|plaintext)$/i.test(language)) return Promise.resolve(null);
  const key = `${language.toLowerCase()}\0${code}`;
  if (!results.has(key)) {
    if (results.size >= 24) results.delete(results.keys().next().value!);
    const pending = api.highlightCode(code, language);
    results.set(key, pending);
    pending.catch(() => results.delete(key));
  }
  return results.get(key)!;
}
