import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { cn } from "../lib/cn";

/**
 * The one message-composer affordance, shared by the Lead conversation and the
 * thread bus so they look and behave identically: Enter sends, the send button
 * is a primary icon button. `multiline` swaps the single-line input for an
 * auto-growing textarea (Shift+Enter for a newline) — for prompts to the lead.
 * Inline answer fields (Needs-you, observe-ask) stay their own row form factor.
 */
export function Composer({
  placeholder,
  onSend,
  multiline = false,
  autoFocus = false,
  className,
}: {
  placeholder: string;
  onSend: (text: string) => void;
  multiline?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea to its content (capped) so a long prompt stays visible.
  useEffect(() => {
    if (!multiline) return;
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text, multiline]);

  const send = () => {
    const v = text.trim();
    if (!v) return;
    onSend(v);
    setText("");
  };

  return (
    <div className={cn("flex items-end gap-2", className)}>
      {multiline ? (
        <textarea
          ref={ref}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder={placeholder}
          className="max-h-40 min-h-[20px] flex-1 resize-none rounded-[var(--radius-md)] border border-border bg-bg px-2.5 py-1.5 text-[13px] leading-snug text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-brand/50"
        />
      ) : (
        <Input
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          placeholder={placeholder}
        />
      )}
      <Button variant="primary" size="icon" disabled={!text.trim()} onClick={send} aria-label="Send">
        <Send size={14} />
      </Button>
    </div>
  );
}
