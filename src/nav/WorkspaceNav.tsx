import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronRight,
  FolderGit2,
  GitBranch,
  Plus,
  Trash2,
} from "lucide-react";
import { useStore } from "../state/store";
import type { Direction, SessionStatus, Thread } from "../lib/types";
import { StatusDot } from "../components/ui/StatusChip";
import { cn } from "../lib/cn";
import {
  AddRepoDialog,
  CreateDirectionDialog,
  CreateThreadDialog,
  CreateWorkspaceDialog,
} from "./dialogs";

const KIND_LABEL: Record<string, string> = {
  feature: "feat",
  bugfix: "fix",
  refactor: "rfc",
  spike: "spike",
};

export function WorkspaceNav() {
  const {
    workspaces,
    activeWorkspaceId,
    repos,
    threads,
    selectWorkspace,
  } = useStore();
  const [dlg, setDlg] = useState<null | "ws" | "repo" | "thread">(null);

  const active = workspaces.find((w) => w.id === activeWorkspaceId);

  return (
    <nav className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-surface">
      {/* brand + workspace switcher */}
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="select-none text-[15px] font-bold tracking-[0.02em] text-brand">
          weft
        </span>
        <span className="text-ink-faint">/</span>
        <WorkspacePicker
          workspaces={workspaces}
          activeId={activeWorkspaceId}
          onSelect={(id) => void selectWorkspace(id)}
          onNew={() => setDlg("ws")}
        />
      </div>

      {/* repos summary */}
      <button
        onClick={() => setDlg("repo")}
        disabled={!active}
        className="group mx-2 mb-1 flex items-center justify-between rounded-[var(--radius-md)] px-2 py-1.5 text-left transition-colors hover:bg-brand-ghost disabled:opacity-40"
      >
        <span className="flex items-center gap-2 text-[12px] text-ink-muted">
          <FolderGit2 size={13} className="text-ink-faint" />
          {repos.length} {repos.length === 1 ? "repo" : "repos"}
        </span>
        <Plus
          size={14}
          className="text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
        />
      </button>

      <div className="mx-2 my-1 border-t border-border" />

      {/* threads header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Threads
        </span>
        <button
          onClick={() => setDlg("thread")}
          disabled={!active}
          aria-label="New thread"
          className="grid h-5 w-5 place-items-center rounded text-ink-faint transition-colors hover:bg-brand-ghost hover:text-ink disabled:opacity-40"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* thread tree */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {threads.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-ink-faint">
            {active
              ? "No threads yet. Create one to start a work line."
              : "Create a workspace to begin."}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {threads.map((t) => (
              <ThreadRow key={t.id} thread={t} />
            ))}
          </ul>
        )}
      </div>

      <CreateWorkspaceDialog open={dlg === "ws"} onOpenChange={(o) => !o && setDlg(null)} />
      <AddRepoDialog open={dlg === "repo"} onOpenChange={(o) => !o && setDlg(null)} />
      <CreateThreadDialog open={dlg === "thread"} onOpenChange={(o) => !o && setDlg(null)} />
    </nav>
  );
}

function WorkspacePicker({
  workspaces,
  activeId,
  onSelect,
  onNew,
}: {
  workspaces: { id: number; name: string }[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
}) {
  const active = workspaces.find((w) => w.id === activeId);
  // lightweight: cycle is overkill; render a native-feeling menu via details
  return (
    <details className="group relative flex-1">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-1 rounded-[var(--radius-md)] px-2 py-1 text-[13px] font-medium text-ink hover:bg-brand-ghost">
        <span className="truncate">{active?.name ?? "No workspace"}</span>
        <ChevronRight size={13} className="text-ink-faint transition-transform group-open:rotate-90" />
      </summary>
      <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-[var(--radius-md)] border border-border bg-raised p-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6)]">
        {workspaces.map((w) => (
          <button
            key={w.id}
            onClick={(e) => {
              onSelect(w.id);
              (e.currentTarget.closest("details") as HTMLDetailsElement).open = false;
            }}
            className={cn(
              "flex w-full items-center rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[13px]",
              w.id === activeId ? "bg-brand-ghost text-ink" : "text-ink-muted hover:bg-brand-ghost hover:text-ink",
            )}
          >
            {w.name}
          </button>
        ))}
        <div className="my-1 border-t border-border" />
        <button
          onClick={(e) => {
            onNew();
            (e.currentTarget.closest("details") as HTMLDetailsElement).open = false;
          }}
          className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[13px] text-ink-muted hover:bg-brand-ghost hover:text-ink"
        >
          <Plus size={13} /> New workspace
        </button>
      </div>
    </details>
  );
}

function ThreadRow({ thread }: { thread: Thread }) {
  const { directionsByThread, loadThreadChildren, deleteThread } = useStore();
  const [open, setOpen] = useState(false);
  const [newDir, setNewDir] = useState(false);
  const dirs = directionsByThread[thread.id];

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !dirs) await loadThreadChildren(thread.id);
  }

  return (
    <li>
      <div className="group relative flex items-center">
        <button
          onClick={() => void toggle()}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[var(--radius-md)] px-1.5 py-1.5 text-left transition-colors hover:bg-brand-ghost"
        >
          <ChevronRight
            size={13}
            className={cn(
              "shrink-0 text-ink-faint transition-transform duration-150",
              open && "rotate-90",
            )}
          />
          <span className="truncate text-[13px] text-ink">{thread.title}</span>
          <span className="ml-auto shrink-0 rounded bg-bg px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink-faint">
            {KIND_LABEL[thread.kind] ?? thread.kind}
          </span>
        </button>
        <button
          onClick={() => setNewDir(true)}
          aria-label="New direction"
          className="absolute right-7 grid h-5 w-5 place-items-center rounded text-ink-faint opacity-0 transition-opacity hover:bg-raised hover:text-ink group-hover:opacity-100"
        >
          <Plus size={13} />
        </button>
        <button
          onClick={() => void deleteThread(thread.id)}
          aria-label="Delete thread"
          className="absolute right-1.5 grid h-5 w-5 place-items-center rounded text-ink-faint opacity-0 transition-opacity hover:bg-[oklch(0.64_0.2_25/0.15)] hover:text-danger group-hover:opacity-100"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden pl-4"
          >
            {dirs?.length === 0 && (
              <li className="px-2 py-1.5 text-[11px] text-ink-faint">
                No directions yet.
              </li>
            )}
            {dirs?.map((d) => (
              <DirectionRow key={d.id} direction={d} />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      <CreateDirectionDialog
        open={newDir}
        onOpenChange={setNewDir}
        threadId={thread.id}
      />
    </li>
  );
}

function DirectionRow({ direction }: { direction: Direction }) {
  const { worktreesByDirection, repos, sessions, activeSessionId, openSession } =
    useStore();
  const wts = worktreesByDirection[direction.id] ?? [];

  return (
    <li className="border-l border-border pl-2">
      <div className="flex items-center gap-1.5 px-1.5 py-1">
        <GitBranch size={11} className="shrink-0 text-ink-faint" />
        <span className="shrink-0 text-[12px] font-medium text-ink-muted">
          {direction.name}
        </span>
        <span
          className="min-w-0 truncate font-mono text-[10px] text-ink-faint"
          title={direction.branch}
        >
          {direction.branch}
        </span>
      </div>
      <ul className="flex flex-col">
        {wts.map((w) => {
          const repo = repos.find((r) => r.id === w.repo_id);
          const sess = Object.values(sessions).find(
            (s) => s.directionId === direction.id && s.repoId === w.repo_id,
          );
          const isActive = sess && sess.info.session_id === activeSessionId;
          return (
            <li key={w.id}>
              <button
                onClick={() => void openSession(direction.id, w.repo_id)}
                className={cn(
                  "relative flex w-full items-center gap-2 rounded-[var(--radius-sm)] py-1 pl-5 pr-2 text-left transition-colors",
                  isActive
                    ? "bg-brand-ghost text-ink"
                    : "text-ink-muted hover:bg-brand-ghost hover:text-ink",
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-brand"
                  />
                )}
                <FolderGit2 size={11} className="shrink-0 text-ink-faint" />
                <span className="truncate text-[12px]">{repo?.name ?? `repo ${w.repo_id}`}</span>
                {sess && (
                  <span className="ml-auto">
                    <StatusDot status={sess.status as SessionStatus} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </li>
  );
}
