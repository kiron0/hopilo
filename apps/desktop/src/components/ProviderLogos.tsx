import type { ReactNode } from "react";

interface LogoProps {
  size?: number;
  className?: string;
}

function ChatGptLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 9.186a4.48 4.48 0 0 1 2.366-1.973V12.8a.766.766 0 0 0 .388.677l5.815 3.355-2.02 1.169a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 9.186zm16.597 3.855-5.833-3.387L15.119 8.5a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 10.52V8.188a.08.08 0 0 1 .033-.061l4.839-2.79a4.5 4.5 0 0 1 6.68 4.66v.062zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V7.248a4.5 4.5 0 0 1 7.37-3.453l-.142.08L8.7 6.633a.787.787 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.607 1.5-2.602-1.5z" />
    </svg>
  );
}

function ClaudeLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M13.8 2.2h-3.6l-.6 5-3.8-3.4-2.6 2.6 3.4 3.8-5 .6v3.6l5 .6-3.4 3.8 2.6 2.6 3.8-3.4.6 5h3.6l.6-5 3.8 3.4 2.6-2.6-3.4-3.8 5-.6v-3.6l-5-.6 3.4-3.8-2.6-2.6-3.8 3.4-.6-5z" />
    </svg>
  );
}

function ClaudeCodeLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 2.5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 12 2.5zm-3.5 6.5 3 3-3 3m4.5 0h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GeminiLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 1.5C12 7.298 7.298 12 1.5 12c5.798 0 10.5 4.702 10.5 10.5 0-5.798 4.702-10.5 10.5-10.5-5.798 0-10.5-4.702-10.5-10.5z" />
    </svg>
  );
}

function CodexLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 17l6-5-6-5m8 10h8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OpenCodeLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M7 8l-4 4 4 4m10-8l4 4-4 4M14 4l-4 16" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CursorLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2.2 3.6 7.1v9.8L12 21.8l8.4-4.9V7.1L12 2.2zm0 2.2 6.5 3.8-6.5 3.8-6.5-3.8L12 4.4zm-7 4.7 6 3.5v7.2l-6-3.5V9.1zm8 10.7v-7.2l6-3.5v7.2l-6 3.5z" />
    </svg>
  );
}

function WindsurfLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M3.5 7.5c2.8-2 6.5-2 9.5.8s5.8 2.8 8.5 1v2.8c-2.8 2-6.5 2-9.5-.8s-5.8-2.8-8.5-1V7.5zm0 5.8c2.8-2 6.5-2 9.5.8s5.8 2.8 8.5 1v2.8c-2.8 2-6.5 2-9.5-.8s-5.8-2.8-8.5-1v-2.8z" />
    </svg>
  );
}

function DeepSeekLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M3 14.5c2.8-4.5 7.5-7.5 13-7.5 2 0 4 .5 5.5 1.5-1.5-2.2-4.2-3.5-7.2-3.5C7.8 5 2.6 10.2 1.5 16.8c.5-.8 1-1.6 1.5-2.3zm17.5-3.5c-.8 0-1.5.7-1.5 1.5s.7 1.5 1.5 1.5 1.5-.7 1.5-1.5-.7-1.5-1.5-1.5zm-5 5.5c-3.6 0-6.8-2-8.3-5-1.2 2.6-1.7 5.4-1.2 8.2 2.6-1.3 5.7-1.9 8.8-1.5 1.5.2 3 .7 4.2 1.5-.9-1.9-2.1-3.2-3.5-3.2z" />
    </svg>
  );
}

function PerplexityLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}

function CopilotLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 3.5a8.5 8.5 0 0 0-8.5 8.5c0 3.8 2.5 7 6 8.2.4.1.6-.2.6-.4v-1.6c-2.4.5-2.9-1.1-2.9-1.1-.4-1-.9-1.3-.9-1.3-.8-.5.1-.5.1-.5.9.1 1.3.9 1.3.9.8 1.3 2 .9 2.5.7.1-.6.3-1 .6-1.2-1.9-.2-3.9-1-3.9-4.3 0-1 .3-1.7.9-2.4-.1-.2-.4-1.1.1-2.3 0 0 .7-.2 2.4.9a8.2 8.2 0 0 1 4.4 0c1.6-1.1 2.4-.9 2.4-.9.5 1.2.2 2.1.1 2.3.6.7.9 1.4.9 2.4 0 3.3-2 4.1-4 4.3.3.3.6.9.6 1.8v2.6c0 .2.2.5.6.4 3.5-1.2 6-4.4 6-8.2a8.5 8.5 0 0 0-8.5-8.5z" />
    </svg>
  );
}

function MistralLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="3" y="4" width="3.5" height="16" rx="0.8" />
      <rect x="7.5" y="8" width="3.5" height="12" rx="0.8" />
      <rect x="12" y="12" width="3.5" height="8" rx="0.8" />
      <rect x="16.5" y="16" width="3.5" height="4" rx="0.8" />
    </svg>
  );
}

function QwenLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2.5 4 8.5l2 9.5L12 22l6-4 2-9.5L12 2.5zm0 3 4.8 4.5-4.8 4-4.8-4L12 5.5zm-5.4 6.8 3.9 3.2-2.7 4.2-1.2-7.4zm10.8 0-1.2 7.4-2.7-4.2 3.9-3.2z" />
    </svg>
  );
}

function GrokLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M4.5 19.5 19.5 4.5m-11 0h11v11" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function MetaLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M7.5 7.5c-2.3 0-4 1.8-4 4.5s1.7 4.5 4 4.5c2.4 0 3.8-2.4 4.5-4.5-.7-2.1-2.1-4.5-4.5-4.5zm9 0c-2.4 0-3.8 2.4-4.5 4.5.7 2.1 2.1 4.5 4.5 4.5 2.3 0 4-1.8 4-4.5s-1.7-4.5-4-4.5z" />
    </svg>
  );
}

function KimiLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M6 4v16m0-8l8-8m-8 8l8 8m4-16v16" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GlmLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2.5 3.5 7.5v9L12 21.5l8.5-5v-9L12 2.5zm0 3.5 5 3-5 3-5-3 5-3zm-6 5.5 5 3v5.5l-5-3V11.5zm12 0v5.5l-5 3v-5.5l5-3z" />
    </svg>
  );
}

function NotebookLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="5" y="4" width="14" height="16" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M9 8h6m-6 4h6m-6 4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PoeLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M6 4h8a5 5 0 0 1 5 5c0 2.8-2.2 5-5 5H9v6H6V4zm3 3v4h5a2 2 0 1 0 0-4H9z" />
    </svg>
  );
}

function HuggingFaceLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2.5a9.5 9.5 0 1 0 9.5 9.5A9.5 9.5 0 0 0 12 2.5zM8.5 9.5a1.5 1.5 0 1 1-1.5 1.5 1.5 1.5 0 0 1 1.5-1.5zm7 0a1.5 1.5 0 1 1-1.5 1.5 1.5 1.5 0 0 1 1.5-1.5zm-7 5.5c1 1.5 2.5 2 3.5 2s2.5-.5 3.5-2a.5.5 0 0 1 .8.6c-1.2 1.8-3 2.4-4.3 2.4s-3.1-.6-4.3-2.4a.5.5 0 0 1 .8-.6z" />
    </svg>
  );
}

function AntigravityLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 3v18m0-18l-4 5m4-5l4 5M5 19a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AiderLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ContinueLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M5 5l7 7-7 7V5zm7 0l7 7-7 7V5z" />
    </svg>
  );
}

function ZedLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M5 5h14l-9 10h9v4H5l9-10H5V5z" />
    </svg>
  );
}

function ClipboardLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="5" y="6" width="14" height="15" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M9 4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2H9V4z" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function NoteLogo({ size = 16, className }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" stroke="currentColor" strokeWidth="2" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

const LOGO_MAP: Record<string, (props: LogoProps) => ReactNode> = {
  chatgpt: ChatGptLogo,
  claude: ClaudeLogo,
  "claude-code": ClaudeCodeLogo,
  gemini: GeminiLogo,
  "gemini-cli": GeminiLogo,
  "ai-studio": GeminiLogo,
  codex: CodexLogo,
  opencode: OpenCodeLogo,
  cursor: CursorLogo,
  windsurf: WindsurfLogo,
  deepseek: DeepSeekLogo,
  perplexity: PerplexityLogo,
  copilot: CopilotLogo,
  "github-copilot": CopilotLogo,
  mistral: MistralLogo,
  qwen: QwenLogo,
  "qwen-code": QwenLogo,
  grok: GrokLogo,
  "meta-ai": MetaLogo,
  kimi: KimiLogo,
  glm: GlmLogo,
  notebooklm: NotebookLogo,
  poe: PoeLogo,
  huggingchat: HuggingFaceLogo,
  antigravity: AntigravityLogo,
  aider: AiderLogo,
  continue: ContinueLogo,
  cline: OpenCodeLogo,
  trae: CursorLogo,
  kiro: ClaudeLogo,
  zed: ZedLogo,
  clipboard: ClipboardLogo,
  manual: NoteLogo,
  file: NoteLogo,
};

export function ProviderLogo({
  id,
  size = 16,
  className,
  fallback,
}: {
  id: string;
  size?: number;
  className?: string;
  fallback?: ReactNode;
}) {
  const normalizedId = id.toLowerCase().trim();
  const Component = LOGO_MAP[normalizedId];

  if (Component) {
    return <Component size={size} className={className} />;
  }

  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2l2.4 6.9 6.9 2.4-6.9 2.4L12 20.6l-2.4-6.9L2.7 11.3l6.9-2.4L12 2z" />
    </svg>
  );
}
