import { useState, type ReactNode } from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import { useTranslation } from "react-i18next";
import { Check, Copy, ExternalLink } from "lucide-react";
import { api } from "../lib/api";
import { appLink, resumeCommand } from "../lib/resume";
import { ToolIcon } from "./ToolIcon";

/**
 * Resume a session OUTSIDE weft: copy the `cd … && <tool> resume <id>` command
 * for your own terminal, or (Codex) jump straight to the thread in the Codex
 * app. weft drives native CLIs, so the session is always reachable elsewhere.
 */
export function ResumeMenu({
  tool,
  cwd,
  nativeId,
  trigger,
}: {
  tool: string;
  cwd: string;
  nativeId: string;
  trigger: ReactNode;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const link = appLink(tool, nativeId);

  async function copy() {
    try {
      await navigator.clipboard?.writeText(resumeCommand(tool, cwd, nativeId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  }

  return (
    <DM.Root>
      <DM.Trigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger}
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          align="end"
          sideOffset={4}
          onClick={(e) => e.stopPropagation()}
          className="weft-pop z-[60] w-64 rounded-[var(--radius-md)] border border-border bg-raised p-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]"
        >
          <DM.Item
            onSelect={(e) => {
              e.preventDefault();
              void copy();
            }}
            className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-[12px] text-ink-muted outline-none data-[highlighted]:bg-brand-ghost data-[highlighted]:text-ink"
          >
            <span className="text-ink-faint">
              {copied ? <Check size={13} className="text-running" /> : <Copy size={13} />}
            </span>
            {copied ? t("resume.copied") : t("resume.copyCommand")}
          </DM.Item>
          {link && (
            <DM.Item
              onSelect={() => void api.openUrl(link)}
              className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-[12px] text-ink-muted outline-none data-[highlighted]:bg-brand-ghost data-[highlighted]:text-ink"
            >
              <ToolIcon tool="codex" size={13} />
              {t("resume.openInCodex")}
              <ExternalLink size={11} className="ml-auto text-ink-faint" />
            </DM.Item>
          )}
          <div className="truncate px-2 pb-1 pt-1.5 font-mono text-[10px] text-ink-faint">
            {nativeId.slice(0, 16)}
          </div>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
