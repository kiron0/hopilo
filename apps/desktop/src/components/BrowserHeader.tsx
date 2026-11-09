import { RefreshCw } from "./Icons";
import { Button, PageHeader } from "./ui";

export function BrowserHeader({ onRefresh }: { onRefresh?: () => void }) {
  return <PageHeader title="Browser"
    subtitle="The Hopilo extension saves Claude and Gemini chats (DeepSeek, Grok and Perplexity experimentally) as sessions, with their files, and puts a session into the message box as an unsent draft. It communicates 100% offline directly with this app."
    actions={<Button icon={<RefreshCw size={14} />} disabled={!onRefresh} onClick={onRefresh}>Refresh</Button>} />;
}
