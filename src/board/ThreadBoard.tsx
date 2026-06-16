import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import * as DM from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Layers, Pencil, TerminalSquare } from "lucide-react";
import { useStore } from "../state/store";
import type { Direction, SessionStatus } from "../lib/types";
import { Button } from "../components/ui/Button";
import { StatusDot } from "../components/ui/StatusChip";
import { ToolIcon, toolFullName } from "../components/ToolIcon";
import { RenameDialog } from "../nav/dialogs";
import { LeadTab } from "../session/LeadTab";
import { cn } from "../lib/cn";

type RunState = "working" | "done";

const COLUMNS: { key: RunState; label: string; dot: string }[] = [
  { key: "working", label: "thread.colRunning", dot: "bg-running" },
  { key: "done", label: "thread.colDone", dot: "bg-accent" },
];

const SETTABLE: { key: string; label: string; dot: string }[] = [
  { key: "planning", label: "thread.statusPlanning", dot: "bg-idle" },
  { key: "working", label: "thread.statusBuilding", dot: "bg-running" },
  { key: "done", label: "thread.colDone", dot: "bg-accent" },
];

export function ThreadBoard() {
  const {
    threads,
    activeThreadId,
    directionsByThread,
    threadTab,
    setThreadTab,
    needs,
    asks,
    renameDirection,
  } = useStore();
  const { t } = useTranslation();
  const thread = threads.find((th) => th.id === activeThreadId);
  const [renamingDirectionId, setRenamingDirectionId] = useState<number | null>(null);

  useEffect(() => {
    setThreadTab("lead");
  }, [activeThreadId, setThreadTab]);

  if (!thread) return null;
  const runs = directionsByThread[thread.id] ?? [];
  const renamingDirection =
    renamingDirectionId != null ? runs.find((d) => d.id === renamingDirectionId) ?? null : null;

  const statusOf = (d: Direction): RunState => (d.status === "done" ? "done" : "working");
  const urgent = (d: Direction): boolean =>
    needs.some((n) => n.direction_id === d.id) || asks.some((a) => a.dir === String(d.id));

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg">
      <div className="flex min-h-0 flex-1 flex-col">
        {threadTab === "lead" ? (
          <LeadTab />
        ) : runs.length === 0 ? (
          <EmptyDiscuss />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="flex h-full min-w-fit gap-3 px-5 py-4">
              {COLUMNS.map((col) => {
                const cards = runs
                  .filter((d) => statusOf(d) === col.key)
                  .sort((a, b) => Number(urgent(b)) - Number(urgent(a)));
                return (
                  <div key={col.key} className="flex w-[300px] shrink-0 flex-col gap-2">
                    <div className="flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                      <span className={cn("h-1.5 w-1.5 rounded-full", col.dot)} />
                      {t(col.label)}
                      <span className="tabular-nums text-ink-faint/70">{cards.length}</span>
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-[var(--radius-lg)] bg-surface/40 p-2">
                      {cards.map((d) => (
                        <DirectionCard key={d.id} direction={d} onRename={setRenamingDirectionId} />
                      ))}
                      {cards.length === 0 && (
                        <div className="flex flex-1 items-center justify-center py-6 text-[11px] text-ink-faint/60">
                          {t("thread.colEmpty")}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {renamingDirection && (
        <RenameDialog
          open={renamingDirectionId != null}
          onOpenChange={(o) => !o && setRenamingDirectionId(null)}
          title={t("thread.renameTask")}
          label={t("dialog.taskName")}
          initial={renamingDirection.name}
          onSubmit={(v) => renameDirection(renamingDirection.id, v)}
        />
      )}
    </section>
  );
}

function EmptyDiscuss() {
  const { activeThreadId, createRun, defaultTool } = useStore();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const startRun = async () => {
    if (activeThreadId == null || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await createRun(activeThreadId, t("thread.defaultRunName"), defaultTool);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-[var(--radius-lg)] border border-border bg-surface">
        <Layers size={20} className="text-ink-faint" />
      </div>
      <h2 className="mt-3 text-[14px] font-semibold text-ink">{t("thread.emptyTitle")}</h2>
      <p className="mt-1.5 max-w-sm text-[12px] leading-relaxed text-ink-faint">
        {t("thread.emptyBody")}
      </p>
      {err && <p className="mt-2 max-w-sm text-[12px] text-danger">{err}</p>}
      <Button
        variant="primary"
        className="mt-4"
        disabled={busy}
        onClick={() => void startRun()}
      >
        <TerminalSquare size={14} />
        {busy ? t("lead.starting") : t("thread.startRun")}
      </Button>
    </div>
  );
}

function DirectionCard({
  direction,
  onRename,
}: {
  direction: Direction;
  onRename: (id: number) => void;
}) {
  const { sessions, driveRun, needs, asks, openNeeds } = useStore();
  const { t } = useTranslation();
  const hasNeed =
    needs.some((n) => n.direction_id === direction.id) ||
    asks.some((a) => a.dir === String(direction.id));
  const liveSession = Object.values(sessions).find(
    (s) => s.directionId === direction.id && s.slotId === 0 && s.status !== "exited",
  );
  const action = hasNeed
    ? { label: t("thread.handle"), variant: "primary" as const }
    : { label: t("thread.openSession"), variant: "default" as const };

  const onPrimary = () => {
    if (hasNeed) {
      openNeeds();
      return;
    }
    void driveRun(direction.id, true);
  };

  return (
    <motion.div
      layout
      className={cn(
        "group flex flex-col rounded-[var(--radius-lg)] border bg-surface text-left transition-colors hover:border-border-strong",
        hasNeed ? "border-waiting/45" : "border-border",
      )}
    >
      <div className="flex items-start gap-2.5 px-3 pb-2.5 pt-3">
        <span
          title={toolFullName(direction.tool)}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-border bg-bg text-ink-muted"
        >
          <ToolIcon tool={direction.tool} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 break-words text-[13px] font-semibold leading-snug text-ink">
              {direction.name}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {hasNeed && (
                <button
                  type="button"
                  title={t("needs.title")}
                  onClick={() => openNeeds()}
                  className="rounded-full bg-waiting/15 px-1.5 py-0.5 text-[10.5px] font-medium text-waiting transition-colors hover:bg-waiting/25"
                >
                  {t("thread.colNeeds")}
                </button>
              )}
              <button
                type="button"
                title={t("thread.renameTask")}
                aria-label={t("thread.renameTask")}
                onClick={() => onRename(direction.id)}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-sm)] text-ink-faint opacity-0 transition-opacity hover:bg-brand-ghost hover:text-ink group-hover:opacity-100"
              >
                <Pencil size={12} />
              </button>
              <StatusMenu direction={direction} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border bg-bg/55 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <span className="truncate text-[11px] text-ink-faint">{t("thread.run")}</span>
          {liveSession && <StatusDot status={liveSession.status as SessionStatus} />}
        </div>
        <Button size="sm" variant={action.variant} onClick={onPrimary}>
          <TerminalSquare size={13} />
          {action.label}
        </Button>
      </div>
    </motion.div>
  );
}

function StatusMenu({ direction }: { direction: Direction }) {
  const { setTaskStatus } = useStore();
  const { t } = useTranslation();
  const current = SETTABLE.find((c) => c.key === direction.status) ?? SETTABLE[0];
  return (
    <DM.Root>
      <DM.Trigger
        title={t("thread.setStatus")}
        aria-label={t("thread.setStatus")}
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-ink-faint outline-none transition-colors hover:bg-brand-ghost hover:text-ink data-[state=open]:bg-brand-ghost data-[state=open]:text-ink"
      >
        <span className={cn("h-2 w-2 rounded-full", current.dot)} />
        <ChevronDown size={11} />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          align="end"
          sideOffset={4}
          onClick={(e) => e.stopPropagation()}
          className="atlas-pop z-[60] w-40 rounded-[var(--radius-md)] border border-border bg-raised p-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]"
        >
          {SETTABLE.map((c) => (
            <DM.Item
              key={c.key}
              onSelect={() => void setTaskStatus(direction.id, c.key)}
              className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-[12px] text-ink-muted outline-none data-[highlighted]:bg-brand-ghost data-[highlighted]:text-ink"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
              {t(c.label)}
              {c.key === current.key && <Check size={12} className="ml-auto text-brand" />}
            </DM.Item>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
