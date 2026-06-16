import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "../state/store";
import { ChatTimeline } from "./ChatTimeline";
import { ChatComposer } from "./ChatComposer";
import { PermissionBar } from "./PermissionBar";
import { api } from "../lib/api";
import { resumeCommand } from "../lib/resume";

/**
 * The task console: one product-native conversation per task. Messages live in
 * Atlas's store, replies stream over the lead-chat event, and the composer stays
 * available across restarts through the provider's native resume id.
 */
export function LeadTab() {
  const {
    activeThreadId,
    leadMessages,
    leadTurn,
    leadSlash,
    leadActivity,
    loadLeadChat,
    sendLeadChat,
    interruptLead,
    asks,
  } = useStore();
  const { t } = useTranslation();

  useEffect(() => {
    if (activeThreadId != null) void loadLeadChat(activeThreadId);
  }, [activeThreadId, loadLeadChat]);

  if (activeThreadId == null) return null;
  const msgs = (leadMessages[activeThreadId] ?? []).filter((m) => m.session_id == null);
  const turn = leadTurn[activeThreadId] ?? { state: "stopped" as const, queued: 0 };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <PermissionBar
        asks={asks.filter((a) => a.thread === activeThreadId && (a.dir === "lead" || a.dir === ""))}
      />
      <ChatTimeline
        messages={msgs}
        busy={turn.state === "busy"}
        activity={leadActivity[activeThreadId]}
      />
      <ChatComposer
        slashCommands={leadSlash[activeThreadId] ?? []}
        localSlash={[]}
        onLocalSlash={() => {}}
        busy={turn.state === "busy"}
        stopped={turn.state === "stopped"}
        queued={turn.queued}
        stoppedHint={t("lead.slashHint")}
        onSend={(text, images, files) =>
          void sendLeadChat(activeThreadId, text, images, files)
        }
        onStop={() => void interruptLead(activeThreadId)}
        onNeedSlashCommands={() => void loadLeadChat(activeThreadId)}
        onTakeOver={async () => {
          const st = await api.leadState(activeThreadId);
          if (!st.native_id) return false;
          await api.leadStop(activeThreadId);
          await navigator.clipboard.writeText(resumeCommand("claude", st.cwd, st.native_id));
          return true;
        }}
      />
    </div>
  );
}
