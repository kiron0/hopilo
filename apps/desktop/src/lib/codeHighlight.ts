import { createHighlighterCore, type LanguageInput } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { MAX_HIGHLIGHT_CODE } from "./markdown";

const grammars: Record<string, () => Promise<{ default: LanguageInput }>> = {
  bash: () => import("@shikijs/langs/bash"), javascript: () => import("@shikijs/langs/javascript"), typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"), jsx: () => import("@shikijs/langs/jsx"), json: () => import("@shikijs/langs/json"), jsonc: () => import("@shikijs/langs/jsonc"),
  python: () => import("@shikijs/langs/python"), rust: () => import("@shikijs/langs/rust"), go: () => import("@shikijs/langs/go"), java: () => import("@shikijs/langs/java"),
  kotlin: () => import("@shikijs/langs/kotlin"), swift: () => import("@shikijs/langs/swift"), c: () => import("@shikijs/langs/c"), cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"), ruby: () => import("@shikijs/langs/ruby"), php: () => import("@shikijs/langs/php"), html: () => import("@shikijs/langs/html"),
  css: () => import("@shikijs/langs/css"), scss: () => import("@shikijs/langs/scss"), sql: () => import("@shikijs/langs/sql"), yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"), xml: () => import("@shikijs/langs/xml"), markdown: () => import("@shikijs/langs/markdown"), diff: () => import("@shikijs/langs/diff"),
  dockerfile: () => import("@shikijs/langs/dockerfile"), makefile: () => import("@shikijs/langs/makefile"), ini: () => import("@shikijs/langs/ini"), lua: () => import("@shikijs/langs/lua"),
  dart: () => import("@shikijs/langs/dart"), scala: () => import("@shikijs/langs/scala"), r: () => import("@shikijs/langs/r"), vue: () => import("@shikijs/langs/vue"),
  svelte: () => import("@shikijs/langs/svelte"), graphql: () => import("@shikijs/langs/graphql"), powershell: () => import("@shikijs/langs/powershell"),
};
const aliases: Record<string, string> = { sh: "bash", shell: "bash", shellscript: "bash", console: "bash", shellsession: "bash", zsh: "bash", js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", py: "python", rs: "rust", yml: "yaml", cs: "csharp", "c++": "cpp", "c#": "csharp", docker: "dockerfile", md: "markdown", ps1: "powershell", golang: "go", kt: "kotlin", rb: "ruby", patch: "diff", htm: "html", svg: "xml" };
const highlighter = createHighlighterCore({
  themes: [import("@shikijs/themes/github-light"), import("@shikijs/themes/github-dark")],
  langs: [],
  engine: createOnigurumaEngine(import("shiki/wasm")),
});
const languages = new Map<string, Promise<void>>();
const results = new Map<string, ReturnType<typeof renderCode>>();

async function renderCode(code: string, language: string) {
  const engine = await highlighter;
  if (!languages.has(language)) languages.set(language, grammars[language]().then((m) => engine.loadLanguage(m.default)).catch((e) => { languages.delete(language); throw e; }));
  await languages.get(language);
  return engine.codeToTokens(code, { lang: language, themes: { light: "github-light", dark: "github-dark" }, defaultColor: false }).tokens;
}
export function highlightCode(code: string, language: string) {
  const name = aliases[language.toLowerCase()] ?? language.toLowerCase();
  if (code.length > MAX_HIGHLIGHT_CODE || code.split("\n").length > 1000 || !Object.hasOwn(grammars, name)) return Promise.resolve(null);
  const key = `${name}\0${code}`;
  if (!results.has(key)) {
    if (results.size >= 24) results.delete(results.keys().next().value!);
    const pending = renderCode(code, name);
    results.set(key, pending);
    pending.catch(() => results.delete(key));
  }
  return results.get(key)!;
}
