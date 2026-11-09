import { useState } from "react";
import { CodeBlock } from "./CodeBlock";
import { Segmented, TextArea } from "./ui";

export function StructuredTextViewer({ text, language, sourceLabel = "Source text" }: { text: string; language: string; sourceLabel?: string }) {
  const [mode, setMode] = useState<"preview" | "source">("preview");
  return <div className="min-w-0 space-y-2">
    <Segmented label="Code view" value={mode} onChange={setMode} options={[{ value: "preview", label: "Preview" }, { value: "source", label: "Source" }]} />
    {mode === "preview" ? <CodeBlock code={text} language={language} /> : <TextArea aria-label={sourceLabel} readOnly value={text} rows={8} className="font-mono text-[11px]" />}
  </div>;
}
