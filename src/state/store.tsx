import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import { currentLang } from "../i18n";
import type {
  BusMsg,
  Direction,
  ImageAttachment,
  LeadChatPush,
  LeadMessage,
  NeedItem,
  PermissionAsk,
  ThreadOverview,
  SessionInfo,
  SessionStatus,
  SlashCmd,
  Thread,
  ToolStatus,
  Workspace,
} from "../lib/types";

export type HomeTab = "board" | "settings";
export type ThreadTab = "lead" | "board";

export interface OpenSession {
  info: SessionInfo;
  status: SessionStatus;
  /** identity of the run slot this session occupies. Generic runs use slot 0. */
  directionId: number;
  slotId: number;
  /** the thread this session belongs to (the worker's parent). */
  threadId: number;
  nativeId: string | null;
}

interface Store {
  workspaces: Workspace[];
  activeWorkspaceId: number | null;
  threads: Thread[];
  directionsByThread: Record<number, Direction[]>;

  activeThreadId: number | null;
  sessions: Record<number, OpenSession>;
  activeSessionId: number | null;
  messages: BusMsg[];
  postHuman: (to: string | null, text: string) => Promise<void>;

  /** Lead chat: atlas-owned timeline per thread (engine pushes, no polling). */
  leadMessages: Record<number, LeadMessage[]>;
  /** Lead engine turn state per thread: busy/idle/stopped + queue depth. */
  leadTurn: Record<number, { state: "busy" | "idle" | "stopped"; queued: number }>;
  /** Slash commands the lead's CLI reports as available (init event). */
  leadSlash: Record<number, SlashCmd[]>;
  /** Hydrate a thread's timeline from DB + make sure the engine runs. */
  loadLeadChat: (threadId: number) => Promise<void>;
  /** Send a human message to the lead (optimistic; engine queues when busy). */
  sendLeadChat: (
    threadId: number,
    text: string,
    images?: ImageAttachment[],
    files?: string[],
  ) => Promise<void>;
  /** Interrupt the lead's current turn. */
  interruptLead: (threadId: number) => Promise<void>;
  /** Chat-mode worker engine state, keyed by session id. */
  workerTurn: Record<number, { state: "busy" | "idle" | "stopped"; queued: number }>;
  workerSlash: Record<number, SlashCmd[]>;
  discoverWorkerSlash: (sessionId: number) => void;
  /** The tool call running right now (transient): lead by thread, worker by session. */
  leadActivity: Record<number, { name: string; summary: string } | null>;
  workerActivity: Record<number, { name: string; summary: string } | null>;
  /** The thread-bus drawer (demoted from a permanent rail). */
  showBus: boolean;
  setShowBus: (open: boolean) => void;
  /** Left sidebar collapse (manual + auto on narrow windows). */
  navCollapsed: boolean;
  setNavCollapsed: (v: boolean) => void;
  /** App settings (persisted to localStorage). */
  projectsDir: string;
  setProjectsDir: (p: string) => void;
  defaultTool: string;
  setDefaultTool: (t: string) => void;
  /** The user's explicit Settings choice; null = auto-detected. */
  configuredTool: string | null;
  /** detect_tools result, loaded once at startup (for tool pickers). */
  installedTools: ToolStatus[];
  refreshInstalledTools: () => Promise<void>;
  /** Dangerous mode: agents skip all permission prompts (global). */
  dangerousMode: boolean;
  setDangerousMode: (on: boolean) => void;
  /** The per-day "turn on Dangerous mode?" nudge toast state. */
  dangerNudge: "ask" | "enabled" | null;
  setDangerNudge: (v: "ask" | "enabled" | null) => void;
  /** Runaway guardrails: idle + wall-clock caps in minutes (0 disables). */
  idleCapMins: number;
  wallCapMins: number;
  setGuardrails: (idleMins: number, wallMins: number) => void;
  /** Active task-level tab: console first, board second. */
  threadTab: ThreadTab;
  setThreadTab: (tab: ThreadTab) => void;
  /** Mark skills as changed; idle sessions/leads lazily refresh their engines. */
  markSkillsDirty: () => void;

  /** Open agent→human questions across the workspace; the Needs-you surface. */
  needs: NeedItem[];
  /** Pending tool permission requests (the Ask Bridge). */
  asks: PermissionAsk[];
  /** Whether the Needs-you view occupies the main region. */
  showNeeds: boolean;
  openNeeds: () => void;
  refreshNeeds: () => Promise<void>;
  answerAsk: (item: NeedItem, text: string) => Promise<void>;
  goToAsk: (item: NeedItem) => Promise<void>;
  answerPermission: (
    askId: number,
    answer: "allow" | "deny" | "always" | "full",
  ) => Promise<void>;

  /** Which home tab is active. */
  homeTab: HomeTab;
  setHomeTab: (t: HomeTab) => void;

  /** Workspace board: per-thread roll-ups for the portfolio view. */
  overview: ThreadOverview[];
  refreshOverview: () => Promise<void>;

  selectWorkspace: (id: number) => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  selectThread: (threadId: number) => Promise<void>;
  loadThreadChildren: (threadId: number) => Promise<void>;
  backToBoard: () => void;
  /** Leave the active thread for the workspace portfolio board. */
  backToWorkspace: () => void;

  renameThread: (threadId: number, title: string) => Promise<void>;
  renameDirection: (directionId: number, name: string) => Promise<void>;
  createThread: (title: string, kind: string) => Promise<Thread>;
  createRun: (
    threadId: number,
    name: string,
    tool: string,
  ) => Promise<void>;
  deleteThread: (threadId: number) => Promise<void>;

  viewing: { directionId: number } | null;
  viewDirection: (directionId: number) => void;
  driveRun: (directionId: number, focus: boolean) => Promise<void>;
  reviveDirection: (directionId: number) => Promise<void>;
  closeObserve: () => void;
  /** Set a task's lifecycle status (human override). */
  setTaskStatus: (directionId: number, status: string) => Promise<void>;
  /** OS notifications for new Needs-you items. */
  notifyEnabled: boolean;
  setNotifyEnabled: (on: boolean) => void;
  /** Prevent system idle sleep while any session is running. */
  keepAwake: boolean;
  setKeepAwake: (on: boolean) => void;
  /** App updater: available update metadata, or null if none. */
  updateAvailable: { version: string; body: string } | null;
  /** Download, install, and relaunch into the new version. */
  installUpdate: () => Promise<void>;
  /** Dismiss the update nudge for this session. */
  dismissUpdate: () => void;
  focusSession: (sessionId: number) => void;
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
  const [threads, setThreads] = useState<Thread[]>([]);
  const [directionsByThread, setDirections] = useState<Record<number, Direction[]>>({});
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<Record<number, OpenSession>>({});
  // Directions with an auto-(re)dispatch in flight, so the poll-driven effect
  // never opens a duplicate run before the first one lands in `sessions`.
  const dispatchingRef = useRef<Set<number>>(new Set());
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [viewing, setViewing] = useState<{
    directionId: number;
  } | null>(null);
  const [messages, setMessages] = useState<BusMsg[]>([]);
  const [needs, setNeeds] = useState<NeedItem[]>([]);
  const [asks, setAsks] = useState<PermissionAsk[]>([]);
  const [showNeeds, setShowNeeds] = useState(false);
  const [homeTab, setHomeTab] = useState<HomeTab>("board");
  const [overview, setOverview] = useState<ThreadOverview[]>([]);
  // Thread-bus drawer state.
  const [showBus, setShowBus] = useState(false);
  const [threadTab, setThreadTab] = useState<ThreadTab>("lead");
  const [navCollapsed, setNavCollapsed] = useState(() => window.innerWidth < 820);

  // App settings, persisted to localStorage.
  const [projectsDir, setProjectsDirState] = useState(
    () => localStorage.getItem("atlas-projects-dir") ?? "",
  );
  const setProjectsDir = useCallback((p: string) => {
    localStorage.setItem("atlas-projects-dir", p);
    setProjectsDirState(p);
  }, []);
  const [defaultTool, setDefaultToolState] = useState("codex");
  const [configuredTool, setConfiguredTool] = useState<string | null>(null);
  const [installedTools, setInstalledTools] = useState<ToolStatus[]>([]);
  // Re-probe the CLIs on demand (the diagnostics panel's Refresh button).
  const refreshInstalledTools = useCallback(async () => {
    try {
      setInstalledTools(await api.detectTools());
    } catch {
      // Pure-vite dev without the Tauri backend.
    }
  }, []);
  useEffect(() => {
    void (async () => {
      try {
        const [info, tools] = await Promise.all([api.getDefaultTool(), api.detectTools()]);
        setDefaultToolState(info.tool);
        setConfiguredTool(info.configured);
        setInstalledTools(tools);
      } catch {
        // Pure-vite dev without the Tauri backend: keep the static defaults.
      }
    })();
  }, []);
  const setDefaultTool = useCallback((tl: string) => {
    setDefaultToolState(tl);
    setConfiguredTool(tl);
    void api.setDefaultTool(tl);
  }, []);
  // System notifications: new Needs-you items raise an OS notification while
  // the window is unfocused. Default ON.
  const [notifyEnabled, setNotifyEnabledState] = useState(
    () => localStorage.getItem("atlas-notify") !== "0",
  );
  const setNotifyEnabled = useCallback((on: boolean) => {
    localStorage.setItem("atlas-notify", on ? "1" : "0");
    setNotifyEnabledState(on);
  }, []);
  // Keep-awake: hold a "prevent idle sleep" OS assertion while any session is
  // busy (the display may still turn off). Default ON; synced to the backend
  // on launch — its state is in-memory (same pattern as dangerous mode).
  const [keepAwake, setKeepAwakeState] = useState(
    () => localStorage.getItem("atlas-keep-awake") !== "0",
  );
  const setKeepAwake = useCallback((on: boolean) => {
    localStorage.setItem("atlas-keep-awake", on ? "1" : "0");
    setKeepAwakeState(on);
    void api.setKeepAwake(on);
  }, []);
  useEffect(() => {
    void api.setKeepAwake(localStorage.getItem("atlas-keep-awake") !== "0");
  }, []);
  // Auto-check for app updates on launch (silent; only surface when found).
  const [updateAvailable, setUpdateAvailable] = useState<{ version: string; body: string } | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const { checkUpdate } = await import("../lib/updater");
        const info = await checkUpdate();
        if (info) setUpdateAvailable(info);
      } catch {
        /* updater unavailable in dev or offline */
      }
    })();
  }, []);
  const installUpdate = useCallback(async () => {
    const { installUpdate: doInstall } = await import("../lib/updater");
    await doInstall();
  }, []);
  const dismissUpdate = useCallback(() => {
    setUpdateAvailable(null);
  }, []);
  const [dangerousMode, setDangerousModeState] = useState(
    () => localStorage.getItem("atlas-dangerous") === "1",
  );
  const setDangerousMode = useCallback((on: boolean) => {
    localStorage.setItem("atlas-dangerous", on ? "1" : "0");
    setDangerousModeState(on);
    void api.setDangerousMode(on);
    // Turning it on retro-approves the existing permission backlog (the backend
    // releases the blocked agents); clear them from the UI now. Human questions
    // (needs) are NOT auto-answered — they stay.
    if (on) setAsks([]);
  }, []);
  const [dangerNudge, setDangerNudge] = useState<"ask" | "enabled" | null>(null);
  // Sync the persisted Dangerous-mode flag to the backend on launch (the bus
  // registry starts fresh each run).
  useEffect(() => {
    void api.setDangerousMode(localStorage.getItem("atlas-dangerous") === "1");
  }, []);

  // Runaway guardrails (§7): idle + wall-clock caps in MINUTES, persisted. The
  // backend seeds its defaults from the ATLAS_* env, so we only push when the user
  // has an explicit saved value — an env override survives an untouched install.
  const [idleCapMins, setIdleCapMins] = useState(
    () => Number(localStorage.getItem("atlas-idle-cap-mins") ?? "30"),
  );
  const [wallCapMins, setWallCapMins] = useState(
    () => Number(localStorage.getItem("atlas-wall-cap-mins") ?? "120"),
  );
  const setGuardrails = useCallback((idleMins: number, wallMins: number) => {
    const idle = Math.max(0, Math.round(idleMins));
    const wall = Math.max(0, Math.round(wallMins));
    localStorage.setItem("atlas-idle-cap-mins", String(idle));
    localStorage.setItem("atlas-wall-cap-mins", String(wall));
    setIdleCapMins(idle);
    setWallCapMins(wall);
    void api.setGuardrails(idle * 60, wall * 60);
  }, []);
  useEffect(() => {
    const i = localStorage.getItem("atlas-idle-cap-mins");
    const w = localStorage.getItem("atlas-wall-cap-mins");
    if (i != null && w != null) void api.setGuardrails(Number(i) * 60, Number(w) * 60);
  }, []);

  // Auto-collapse the sidebar when the window gets narrow; auto-restore when it
  // widens again (only on threshold crossings, so manual toggles stick).
  useEffect(() => {
    const TH = 820;
    let prevNarrow = window.innerWidth < TH;
    const onResize = () => {
      const narrow = window.innerWidth < TH;
      if (narrow !== prevNarrow) {
        prevNarrow = narrow;
        setNavCollapsed(narrow);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const refreshWorkspaces = useCallback(async () => {
    const defaultWorkspaceId = await api.ensureDefaultWorkspace();
    const ws = await api.listWorkspaces();
    setWorkspaces(ws);
    setActiveWorkspaceId((cur) => cur ?? defaultWorkspaceId);
  }, []);

  const selectWorkspace = useCallback(async (id: number) => {
    setActiveWorkspaceId(id);
    const t = await api.listThreads(id);
    setThreads(t);
    setDirections({});
    setActiveThreadId(null);
    setActiveSessionId(null);
    setViewing(null);
    setShowNeeds(false);
    setHomeTab("board");
    setOverview([]);
  }, []);

  const loadThreadChildren = useCallback(async (threadId: number) => {
    const dirs = await api.listDirections(threadId);
    setDirections((m) => ({ ...m, [threadId]: dirs }));
  }, []);

  const selectThread = useCallback(
    async (threadId: number) => {
      setActiveThreadId(threadId);
      setActiveSessionId(null);
      setViewing(null);
      setShowNeeds(false);
      setHomeTab("board");
      setThreadTab("lead");
      setShowBus(false);
      await loadThreadChildren(threadId);
    },
    [loadThreadChildren],
  );

  const backToBoard = useCallback(() => setActiveSessionId(null), []);

  const refreshOverview = useCallback(async () => {
    if (activeWorkspaceId == null) {
      setOverview([]);
      return;
    }
    try {
      setOverview(await api.workspaceOverview(activeWorkspaceId));
    } catch {
      /* ignore */
    }
  }, [activeWorkspaceId]);

  const backToWorkspace = useCallback(() => {
    setActiveThreadId(null);
    setActiveSessionId(null);
    setViewing(null);
    setShowNeeds(false);
    setHomeTab("board");
    setThreadTab("lead");
  }, []);

  const renameThread = useCallback(
    async (threadId: number, title: string) => {
      const t = await api.renameThread(threadId, title);
      setThreads((cur) => cur.map((x) => (x.id === t.id ? t : x)));
      // needs/asks carry a snapshot of thread_title; patch in place
      setNeeds((cur) =>
        cur.map((n) => (n.thread_id === t.id ? { ...n, thread_title: t.title } : n)),
      );
      setAsks((cur) =>
        cur.map((a) => (a.thread === t.id ? { ...a, thread_title: t.title } : a)),
      );
      void refreshOverview();
    },
    [refreshOverview],
  );

  const renameDirection = useCallback(async (directionId: number, name: string) => {
    const d = await api.renameDirection(directionId, name);
    setDirections((m) => ({
      ...m,
      [d.thread_id]: (m[d.thread_id] ?? []).map((x) => (x.id === d.id ? d : x)),
    }));
    // needs.direction_name and asks.dir_name carry the direction's display name;
    // patch them in place so cards/notifications reflect the rename without
    // waiting for the next refreshNeeds poll.
    setNeeds((cur) =>
      cur.map((n) => (n.direction_id === d.id ? { ...n, direction_name: d.name } : n)),
    );
    setAsks((cur) =>
      cur.map((a) =>
        a.thread === d.thread_id && a.dir === d.slug ? { ...a, dir_name: d.name } : a,
      ),
    );
  }, []);

  const createThread = useCallback(
    async (title: string, kind: string) => {
      if (activeWorkspaceId == null) throw new Error("no workspace");
      const t = await api.createThread(activeWorkspaceId, title, kind);
      setThreads(await api.listThreads(activeWorkspaceId));
      void refreshOverview();
      return t;
    },
    [activeWorkspaceId],
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

  // Runs use the chat engine — one product-native conversation UI per vendor
  // dialect (claude stream-json, codex exec --json, opencode run --format json).
  // Escape hatches per tool: native app link, terminal takeover command, and
  // reveal in Finder.
  const viewDirection = useCallback((directionId: number) => {
    setViewing({ directionId });
    setActiveSessionId(null);
    setShowNeeds(false);
    setHomeTab("board");
  }, []);

  const closeObserve = useCallback(() => setViewing(null), []);

  // Explicit "continue/attach": attach to a live session if one exists, else ask
  // the backend to resume the same native conversation (or fresh-dispatch only
  // when no native id was ever captured). Never re-seeds a live/finished task.
  const driveRun = useCallback(
    async (directionId: number, focus: boolean) => {
      const existing = Object.values(sessionsRef.current).find(
        (s) =>
          s.directionId === directionId &&
          s.slotId === 0 &&
          s.status !== "exited",
      );
      if (existing) {
        if (focus) {
          setActiveSessionId(existing.info.session_id);
          setShowNeeds(false);
          setHomeTab("board");
        }
        return;
      }
      const info = await api.chatOpenRun(directionId, currentLang());
      setSessions((m) => {
        const pruned = Object.fromEntries(
          Object.entries(m).filter(
            ([, s]) => !(s.directionId === directionId && s.slotId === 0 && s.status === "exited"),
          ),
        );
        return {
          ...pruned,
          [info.session_id]: {
            info,
            status: "running",
            directionId,
            slotId: 0,
            threadId: activeThreadId ?? -1,
            nativeId: info.native_id,
          },
        };
      });
      if (focus) {
        setActiveSessionId(info.session_id);
        setShowNeeds(false);
        setHomeTab("board");
      }
    },
    [activeThreadId],
  );

  // Restart continuity: bring a working run back by RESUME (not a fresh re-run).
  const reviveDirection = useCallback(
    async (directionId: number) => {
      await driveRun(directionId, false);
    },
    [driveRun],
  );

  const createRun = useCallback(
    async (threadId: number, name: string, tool: string) => {
      const run = await api.createRun(threadId, name, tool);
      await loadThreadChildren(threadId);
      await driveRun(run.id, true);
    },
    [loadThreadChildren, driveRun],
  );

  // ── Lead chat (atlas-owned conversation; engine pushes via `lead-chat`) ──
  const [leadMessages, setLeadMessages] = useState<Record<number, LeadMessage[]>>({});
  const [leadTurn, setLeadTurn] = useState<
    Record<number, { state: "busy" | "idle" | "stopped"; queued: number }>
  >({});
  const [leadSlash, setLeadSlash] = useState<Record<number, SlashCmd[]>>({});
  const [workerTurn, setWorkerTurn] = useState<
    Record<number, { state: "busy" | "idle" | "stopped"; queued: number }>
  >({});
  const [workerSlash, setWorkerSlash] = useState<Record<number, SlashCmd[]>>({});
  const [leadActivity, setLeadActivity] = useState<
    Record<number, { name: string; summary: string } | null>
  >({});
  const [workerActivity, setWorkerActivity] = useState<
    Record<number, { name: string; summary: string } | null>
  >({});
  // Skills dirty latch: bump on any skills mutation; idle sessions/leads compare
  // against their last-refreshed stamp to flag one engine refresh per episode.
  const [skillsDirtyAt, setSkillsDirtyAt] = useState(0);
  const markSkillsDirty = useCallback(() => setSkillsDirtyAt(Date.now()), []);
  const skillsRefreshedRef = useRef<Record<number, number>>({});

  useEffect(() => {
    const un = listen<LeadChatPush>("lead-chat", (e) => {
      const p = e.payload;
      if (p.type === "message") {
        setLeadMessages((m) => {
          const list = m[p.thread_id] ?? [];
          if (list.some((x) => x.id === p.message.id)) return m;
          return { ...m, [p.thread_id]: [...list, p.message] };
        });
      } else if (p.type === "delta") {
        setLeadMessages((m) => ({
          ...m,
          [p.thread_id]: (m[p.thread_id] ?? []).map((x) => {
            if (x.id !== p.message_id) return x;
            let text = "";
            try {
              text = (JSON.parse(x.content).text as string) ?? "";
            } catch {
              /* fresh row */
            }
            return { ...x, content: JSON.stringify({ text: text + p.text }) };
          }),
        }));
      } else if (p.type === "finalize") {
        setLeadMessages((m) => ({
          ...m,
          [p.thread_id]: (m[p.thread_id] ?? []).map((x) =>
            x.id === p.message_id
              ? { ...x, status: p.status as LeadMessage["status"] }
              : x,
          ),
        }));
      } else if (p.type === "activity") {
        const act = { name: p.name, summary: p.summary };
        if (p.session_id != null) {
          const sid = p.session_id;
          setWorkerActivity((a) => ({ ...a, [sid]: act }));
        } else {
          setLeadActivity((a) => ({ ...a, [p.thread_id]: act }));
        }
      } else if (p.type === "turn") {
        if (p.session_id != null) {
          const sid = p.session_id;
          setWorkerActivity((a) => ({ ...a, [sid]: null }));
          setWorkerTurn((t) => ({ ...t, [sid]: { state: p.state, queued: p.queued } }));
          setSessions((m) =>
            m[sid]
              ? {
                  ...m,
                  [sid]: {
                    ...m[sid],
                    status:
                      p.state === "busy" ? "running" : p.state === "idle" ? "idle" : "exited",
                  },
                }
              : m,
          );
        } else {
          setLeadActivity((a) => ({ ...a, [p.thread_id]: null }));
          setLeadTurn((t) => ({
            ...t,
            [p.thread_id]: { state: p.state, queued: p.queued },
          }));
        }
      } else if (p.type === "init") {
        if (p.session_id != null) {
          const sid = p.session_id;
          setWorkerSlash((s) => ({ ...s, [sid]: p.slash_commands }));
          // The early initialize-derived push has no native id yet — keep the old one.
          if (p.native_id) {
            setSessions((m) =>
              m[sid] ? { ...m, [sid]: { ...m[sid], nativeId: p.native_id } } : m,
            );
          }
        } else {
          setLeadSlash((s) => ({ ...s, [p.thread_id]: p.slash_commands }));
        }
        // An init implies a live engine: a stale "stopped" flips to idle (a
        // turn event will overwrite the moment anything actually runs).
        if (p.session_id != null) {
          const sid = p.session_id;
          setWorkerTurn((t) =>
            (t[sid]?.state ?? "stopped") === "stopped"
              ? { ...t, [sid]: { state: "idle", queued: 0 } }
              : t,
          );
        } else {
          setLeadTurn((t) =>
            (t[p.thread_id]?.state ?? "stopped") === "stopped"
              ? { ...t, [p.thread_id]: { state: "idle", queued: 0 } }
              : t,
          );
        }
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  const loadLeadChat = useCallback(async (threadId: number) => {
    const msgs = await api.listLeadMessages(threadId);
    setLeadMessages((m) => ({
      ...m,
      [threadId]: msgs.filter((x) => x.kind !== "meta"),
    }));
    // Fire the engine up so init delivers slash commands + the console is live.
    void api.leadEnsure(threadId, currentLang()).catch(() => {});
    try {
      const st = await api.leadState(threadId);
      setLeadTurn((t) => ({
        ...t,
        [threadId]: { state: st.state, queued: st.queued },
      }));
      if (st.slash_commands.length > 0) {
        setLeadSlash((s) => ({ ...s, [threadId]: st.slash_commands }));
      }
    } catch {
      /* engine state is cosmetic at load time */
    }
  }, []);

  // Pull a worker's slash commands on demand: opencode runs live GET /command
  // discovery, claude returns its cached initialize list, codex returns none.
  // Best-effort — an empty result leaves the existing palette untouched.
  const discoverWorkerSlash = useCallback((sessionId: number) => {
    void api
      .discoverSlash(null, sessionId)
      .then((cmds) => {
        if (cmds.length > 0) setWorkerSlash((s) => ({ ...s, [sessionId]: cmds }));
      })
      .catch(() => {});
  }, []);

  const sendLeadChat = useCallback(
    async (threadId: number, text: string, images?: ImageAttachment[], files?: string[]) => {
      await api.leadSend(threadId, text, currentLang(), images, files);
    },
    [],
  );

  const interruptLead = useCallback(async (threadId: number) => {
    await api.leadInterrupt(threadId);
  }, []);

  const setTaskStatus = useCallback(async (directionId: number, status: string) => {
    // optimistic: flip the card now, then persist
    setDirections((m) => {
      const next: Record<number, Direction[]> = {};
      for (const [tid, list] of Object.entries(m)) {
        next[Number(tid)] = list.map((d) =>
          d.id === directionId ? { ...d, status } : d,
        );
      }
      return next;
    });
    try {
      await api.setTaskStatus(directionId, status);
    } catch {
      /* reverts on next poll */
    }
  }, []);

  const focusSession = useCallback((id: number) => setActiveSessionId(id), []);

  const postHuman = useCallback(
    async (to: string | null, text: string) => {
      if (activeThreadId == null || !text.trim()) return;
      await api.busPostHuman(activeThreadId, to, text.trim());
    },
    [activeThreadId],
  );

  const refreshNeeds = useCallback(async () => {
    // Permission Asks are global; always refresh them.
    try {
      setAsks(await api.pendingAsks());
    } catch {
      /* server may not be ready */
    }
    if (activeWorkspaceId == null) {
      setNeeds([]);
      return;
    }
    try {
      setNeeds(await api.needsYou(activeWorkspaceId));
    } catch {
      /* bus may not be ready */
    }
  }, [activeWorkspaceId]);

  const openNeeds = useCallback(() => {
    setActiveSessionId(null);
    setViewing(null);
    setHomeTab("board");
    setShowNeeds(true);
  }, []);

  const answerAsk = useCallback(
    async (item: NeedItem, text: string) => {
      if (!text.trim()) return;
      // optimistic: drop the answered ask immediately, then reconcile
      setNeeds((cur) => cur.filter((n) => n.ask_id !== item.ask_id));
      await api.answerAsk(item.thread_id, item.ask_id, text.trim());
      await refreshNeeds();
    },
    [refreshNeeds],
  );

  const answerPermission = useCallback(
    async (askId: number, answer: "allow" | "deny" | "always" | "full") => {
      // optimistic: drop the card immediately, then unblock the tool
      setAsks((cur) => cur.filter((a) => a.id !== askId));
      // Per-day nudge: granting broad access (always / full) without Dangerous
      // mode → once a day, suggest turning it on.
      if ((answer === "always" || answer === "full") && !dangerousMode) {
        const today = new Date().toISOString().slice(0, 10);
        if (localStorage.getItem("atlas-danger-nudge") !== today) {
          localStorage.setItem("atlas-danger-nudge", today);
          setDangerNudge("ask");
        }
      }
      try {
        await api.answerPermission(askId, answer);
      } catch {
        /* already resolved/expired */
      }
    },
    [dangerousMode],
  );

  const goToAsk = useCallback(
    async (item: NeedItem) => {
      setShowNeeds(false);
      setViewing(null);
      const live = Object.values(sessions).find(
        (s) => s.directionId === item.direction_id,
      );
      if (live) {
        setActiveThreadId(item.thread_id);
        setActiveSessionId(live.info.session_id);
        return;
      }
      await selectThread(item.thread_id);
    },
    [sessions, selectThread],
  );

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);
  useEffect(() => {
    if (activeWorkspaceId != null) void selectWorkspace(activeWorkspaceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  // Needs-you: poll workspace-wide, plus a push refresh when the coordinator
  // signals a new ask (needs-you://changed). Poll is the safety net; the event
  // makes new questions appear near-instantly.
  useEffect(() => {
    if (activeWorkspaceId == null) {
      setNeeds([]);
      return;
    }
    let alive = true;
    const tick = () => {
      if (alive) void refreshNeeds();
    };
    tick();
    const h = setInterval(tick, 4000);
    const unChanged = listen("needs-you://changed", tick);
    return () => {
      alive = false;
      clearInterval(h);
      void unChanged.then((f) => f());
    };
  }, [activeWorkspaceId, refreshNeeds]);

  // Idle skill-refresh: when skills changed (dirty timestamp) and a session goes
  // busy→idle, flag its engine once so the next send picks up new skills.
  const prevWorkerTurnRef = useRef<Record<number, string>>({});
  useEffect(() => {
    for (const [sidStr, turn] of Object.entries(workerTurn)) {
      const sid = Number(sidStr);
      const prev = prevWorkerTurnRef.current[sid];
      prevWorkerTurnRef.current[sid] = turn.state;
      if (prev === "busy" && turn.state === "idle" &&
          skillsDirtyAt > (skillsRefreshedRef.current[sid] ?? 0)) {
        skillsRefreshedRef.current[sid] = Date.now();
        void api.flagSessionSkillRefresh(sid).catch(() => {});
      }
    }
  }, [workerTurn, skillsDirtyAt]);

  const prevLeadTurnRef = useRef<Record<number, string>>({});
  useEffect(() => {
    for (const [tidStr, turn] of Object.entries(leadTurn)) {
      const tid = Number(tidStr);
      const prev = prevLeadTurnRef.current[tid];
      prevLeadTurnRef.current[tid] = turn.state;
      // lead engines refreshed in the same per-id ref space, negative-keyed to
      // avoid colliding with worker session ids.
      const key = -tid;
      if (prev === "busy" && turn.state === "idle" &&
          skillsDirtyAt > (skillsRefreshedRef.current[key] ?? 0)) {
        skillsRefreshedRef.current[key] = Date.now();
        void api.flagLeadSkillRefresh(tid).catch(() => {});
      }
    }
  }, [leadTurn, skillsDirtyAt]);

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
      // reflect agent-driven status changes (set via the bus MCP tool)
      try {
        const dirs = await api.listDirections(activeThreadId);
        if (alive) setDirections((m) => ({ ...m, [activeThreadId]: dirs }));
      } catch {
        /* ignore */
      }
    };
    void tick();
    const h = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, [activeThreadId]);

  // Automation-first across restarts: a task that's "working"
  // but has no live session — e.g. after an app restart, when in-memory engines
  // are gone — gets its run reopened so it continues without a manual click.
  useEffect(() => {
    if (activeThreadId == null) return;
    const dirs = directionsByThread[activeThreadId] ?? [];
    for (const d of dirs) {
      if (d.status !== "working") continue;
      const hasLive = Object.values(sessionsRef.current).some(
        (s) => s.directionId === d.id && s.status !== "exited",
      );
      if (hasLive || dispatchingRef.current.has(d.id)) continue;
      dispatchingRef.current.add(d.id);
      void reviveDirection(d.id).finally(() => dispatchingRef.current.delete(d.id));
    }
  }, [activeThreadId, directionsByThread, reviveDirection]);

  const value: Store = {
    workspaces,
    activeWorkspaceId,
    threads,
    directionsByThread,
    activeThreadId,
    sessions,
    activeSessionId,
    messages,
    postHuman,
    leadMessages,
    leadTurn,
    leadSlash,
    loadLeadChat,
    sendLeadChat,
    interruptLead,
    workerTurn,
    workerSlash,
    discoverWorkerSlash,
    leadActivity,
    workerActivity,
    showBus,
    setShowBus,
    navCollapsed,
    setNavCollapsed,
    threadTab,
    setThreadTab,
    markSkillsDirty,
    projectsDir,
    setProjectsDir,
    defaultTool,
    setDefaultTool,
    configuredTool,
    installedTools,
    refreshInstalledTools,
    dangerousMode,
    setDangerousMode,
    dangerNudge,
    setDangerNudge,
    idleCapMins,
    wallCapMins,
    setGuardrails,
    needs,
    asks,
    showNeeds,
    openNeeds,
    refreshNeeds,
    answerAsk,
    goToAsk,
    answerPermission,
    homeTab,
    setHomeTab,
    overview,
    refreshOverview,
    selectWorkspace,
    refreshWorkspaces,
    selectThread,
    loadThreadChildren,
    backToBoard,
    backToWorkspace,
    renameThread,
    renameDirection,
    createThread,
    createRun,
    deleteThread,
    viewing,
    viewDirection,
    driveRun,
    reviveDirection,
    closeObserve,
    setTaskStatus,
    notifyEnabled,
    setNotifyEnabled,
    keepAwake,
    setKeepAwake,
    focusSession,
    updateAvailable,
    installUpdate,
    dismissUpdate,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
