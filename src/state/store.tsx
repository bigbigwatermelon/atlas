import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import type {
  BusMsg,
  Direction,
  DirectionRepo,
  RepoRef,
  SessionInfo,
  SessionStatus,
  Thread,
  Workspace,
  Worktree,
} from "../lib/types";

export interface OpenSession {
  info: SessionInfo;
  status: SessionStatus;
  /** identity of the (direction, repo) slot this session occupies */
  directionId: number;
  repoId: number;
  nativeId: string | null;
}

interface Store {
  workspaces: Workspace[];
  activeWorkspaceId: number | null;
  repos: RepoRef[];
  threads: Thread[];
  directionsByThread: Record<number, Direction[]>;
  worktreesByDirection: Record<number, Worktree[]>;
  directionReposByDirection: Record<number, DirectionRepo[]>;

  activeThreadId: number | null;
  sessions: Record<number, OpenSession>;
  activeSessionId: number | null;
  messages: BusMsg[];
  postHuman: (to: string | null, text: string) => Promise<void>;
  nudgeDirection: (directionId: number) => Promise<void>;

  selectWorkspace: (id: number) => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  selectThread: (threadId: number) => Promise<void>;
  loadThreadChildren: (threadId: number) => Promise<void>;
  backToBoard: () => void;

  createWorkspace: (name: string) => Promise<void>;
  addRepo: (name: string, path: string) => Promise<void>;
  createThread: (title: string, kind: string) => Promise<Thread>;
  createDirection: (
    threadId: number,
    name: string,
    tool: string,
    scope: { repo_id: number; role: "write" | "read" }[],
  ) => Promise<void>;
  deleteThread: (threadId: number) => Promise<void>;

  openSession: (directionId: number, repoId: number) => Promise<void>;
  focusSession: (sessionId: number) => void;
  resumeSession: (sessionId: number) => Promise<void>;
  killSession: (sessionId: number) => Promise<void>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
};

export function StoreProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(null);
  const [repos, setRepos] = useState<RepoRef[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [directionsByThread, setDirections] = useState<Record<number, Direction[]>>({});
  const [worktreesByDirection, setWorktrees] = useState<Record<number, Worktree[]>>({});
  const [directionReposByDirection, setDirectionRepos] = useState<
    Record<number, DirectionRepo[]>
  >({});
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<Record<number, OpenSession>>({});
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<BusMsg[]>([]);

  const refreshWorkspaces = useCallback(async () => {
    const ws = await api.listWorkspaces();
    setWorkspaces(ws);
    setActiveWorkspaceId((cur) => cur ?? ws[0]?.id ?? null);
  }, []);

  const selectWorkspace = useCallback(async (id: number) => {
    setActiveWorkspaceId(id);
    const [r, t] = await Promise.all([api.listRepos(id), api.listThreads(id)]);
    setRepos(r);
    setThreads(t);
    setDirections({});
    setWorktrees({});
    setActiveThreadId(null);
    setActiveSessionId(null);
  }, []);

  const loadThreadChildren = useCallback(async (threadId: number) => {
    const dirs = await api.listDirections(threadId);
    setDirections((m) => ({ ...m, [threadId]: dirs }));
    const entries = await Promise.all(
      dirs.map(
        async (d) =>
          [
            d.id,
            await api.listWorktrees(d.id),
            await api.listDirectionRepos(d.id),
          ] as const,
      ),
    );
    setWorktrees((m) => {
      const next = { ...m };
      for (const [id, wts] of entries) next[id] = wts;
      return next;
    });
    setDirectionRepos((m) => {
      const next = { ...m };
      for (const [id, , drs] of entries) next[id] = drs;
      return next;
    });
  }, []);

  const selectThread = useCallback(
    async (threadId: number) => {
      setActiveThreadId(threadId);
      setActiveSessionId(null);
      await loadThreadChildren(threadId);
    },
    [loadThreadChildren],
  );

  const backToBoard = useCallback(() => setActiveSessionId(null), []);

  const createWorkspace = useCallback(
    async (name: string) => {
      const ws = await api.createWorkspace(name);
      await refreshWorkspaces();
      await selectWorkspace(ws.id);
    },
    [refreshWorkspaces, selectWorkspace],
  );

  const addRepo = useCallback(
    async (name: string, path: string) => {
      if (activeWorkspaceId == null) return;
      await api.addRepoRef(activeWorkspaceId, name, path);
      setRepos(await api.listRepos(activeWorkspaceId));
    },
    [activeWorkspaceId],
  );

  const createThread = useCallback(
    async (title: string, kind: string) => {
      if (activeWorkspaceId == null) throw new Error("no workspace");
      const t = await api.createThread(activeWorkspaceId, title, kind);
      setThreads(await api.listThreads(activeWorkspaceId));
      return t;
    },
    [activeWorkspaceId],
  );

  const createDirection = useCallback(
    async (
      threadId: number,
      name: string,
      tool: string,
      scope: { repo_id: number; role: "write" | "read" }[],
    ) => {
      await api.createDirection(threadId, name, tool, scope);
      await loadThreadChildren(threadId);
    },
    [loadThreadChildren],
  );

  const deleteThread = useCallback(
    async (threadId: number) => {
      await api.deleteThread(threadId);
      if (activeWorkspaceId != null)
        setThreads(await api.listThreads(activeWorkspaceId));
      setDirections((m) => {
        const n = { ...m };
        delete n[threadId];
        return n;
      });
      setActiveThreadId((cur) => (cur === threadId ? null : cur));
    },
    [activeWorkspaceId],
  );

  const setStatus = useCallback((sessionId: number, status: SessionStatus) => {
    setSessions((m) =>
      m[sessionId] ? { ...m, [sessionId]: { ...m[sessionId], status } } : m,
    );
  }, []);

  const openSession = useCallback(
    async (directionId: number, repoId: number) => {
      // focus an existing live session for this slot if present
      const existing = Object.values(sessions).find(
        (s) => s.directionId === directionId && s.repoId === repoId,
      );
      if (existing) {
        setActiveSessionId(existing.info.session_id);
        return;
      }
      const info = await api.openSession(directionId, repoId);
      setSessions((m) => ({
        ...m,
        [info.session_id]: { info, status: "starting", directionId, repoId, nativeId: null },
      }));
      setActiveSessionId(info.session_id);
    },
    [sessions],
  );

  const focusSession = useCallback((id: number) => setActiveSessionId(id), []);

  const resumeSession = useCallback(async (sessionId: number) => {
    const info = await api.resumeSession(sessionId);
    setSessions((m) => ({ ...m, [sessionId]: { ...m[sessionId], info, status: "starting" } }));
  }, []);

  const killSession = useCallback(async (sessionId: number) => {
    await api.killSession(sessionId);
    setSessions((m) => {
      const n = { ...m };
      delete n[sessionId];
      return n;
    });
    setActiveSessionId((cur) => (cur === sessionId ? null : cur));
  }, []);

  const postHuman = useCallback(
    async (to: string | null, text: string) => {
      if (activeThreadId == null || !text.trim()) return;
      await api.busPostHuman(activeThreadId, to, text.trim());
    },
    [activeThreadId],
  );

  const nudgeDirection = useCallback(
    async (directionId: number) => {
      const sess = Object.values(sessions).find(
        (s) => s.directionId === directionId && s.status === "running",
      );
      if (!sess) return;
      await api.writePty(
        sess.info.session_id,
        "You have new messages on the thread bus. Call the bus_inbox tool to read them.\r",
      );
    },
    [sessions],
  );

  // bridge events: session id capture + exit drive UI status
  useEffect(() => {
    const unId = listen<{ sessionId: number; nativeId: string }>(
      "session://id",
      (e) => {
        const { sessionId, nativeId } = e.payload;
        setSessions((m) =>
          m[sessionId]
            ? { ...m, [sessionId]: { ...m[sessionId], nativeId, status: "running" } }
            : m,
        );
      },
    );
    const unExit = listen<{ sessionId: number }>("pty://exit", (e) => {
      setStatus(e.payload.sessionId, "exited");
    });
    return () => {
      void unId.then((f) => f());
      void unExit.then((f) => f());
    };
  }, [setStatus]);

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);
  useEffect(() => {
    if (activeWorkspaceId != null) void selectWorkspace(activeWorkspaceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (activeThreadId == null) {
      setMessages([]);
      return;
    }
    let alive = true;
    const tick = async () => {
      try {
        const m = await api.threadMessages(activeThreadId);
        if (alive) setMessages(m);
      } catch {
        /* bus may not be ready */
      }
    };
    void tick();
    const h = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, [activeThreadId]);

  const value: Store = {
    workspaces,
    activeWorkspaceId,
    repos,
    threads,
    directionsByThread,
    worktreesByDirection,
    directionReposByDirection,
    activeThreadId,
    sessions,
    activeSessionId,
    messages,
    postHuman,
    nudgeDirection,
    selectWorkspace,
    refreshWorkspaces,
    selectThread,
    loadThreadChildren,
    backToBoard,
    createWorkspace,
    addRepo,
    createThread,
    createDirection,
    deleteThread,
    openSession,
    focusSession,
    resumeSession,
    killSession,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
