import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TerminalPanel } from "./panels/TerminalPanel";
import "./App.css";

type Status = "idle" | "running" | "exited";

interface SessionInfo {
  repo: string;
  worktree: string;
  branch: string;
  resumed: boolean;
  resume_id: string | null;
}

function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [repoPath, setRepoPath] = useState("");
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const un = listen<string>("session://id", (e) => setSessionId(e.payload));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  async function open() {
    setError(null);
    setSessionId(null);
    try {
      const i = await invoke<SessionInfo>("open_session", {
        repoPath: repoPath.trim() || null,
      });
      setInfo(i);
      setStatus("running");
    } catch (e) {
      setError(String(e));
    }
  }

  async function resume() {
    setError(null);
    try {
      const i = await invoke<SessionInfo>("resume_session");
      setInfo(i);
      setStatus("running");
    } catch (e) {
      setError(String(e));
    }
  }

  async function kill() {
    await invoke("kill_session");
    setStatus("exited");
  }

  const statusColor =
    status === "running" ? "#4ade80" : status === "exited" ? "#f87171" : "#94a3b8";

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">weft</div>
        <input
          className="repo-input"
          placeholder="git repo path (blank = throwaway demo repo)"
          value={repoPath}
          onChange={(e) => setRepoPath(e.currentTarget.value)}
          disabled={status === "running"}
        />
        <button className="btn primary" onClick={open}>
          {status === "running" ? "Restart" : "Open Session"}
        </button>
        <button className="btn" onClick={resume} disabled={!sessionId}>
          Resume
        </button>
        <button className="btn" onClick={kill} disabled={status !== "running"}>
          Kill
        </button>
        <span className="status">
          <span className="dot" style={{ background: statusColor }} />
          {status}
        </span>
      </header>

      <div className="meta">
        {info ? (
          <>
            <span title="branch">⎇ {info.branch}</span>
            <span title="worktree (stable cwd for resume)">📁 {info.worktree}</span>
            <span title="native session id">
              🆔 {sessionId ?? "capturing…"}
            </span>
            {info.resumed && <span className="tag">resumed</span>}
          </>
        ) : (
          <span className="hint">
            Open a session to spawn the native Claude TUI in a git worktree.
            Permission &amp; trust popups appear in the terminal — answer them
            there (weft never overrides your Claude config).
          </span>
        )}
        {error && <span className="err">{error}</span>}
      </div>

      <main className="panel">
        {status === "idle" ? (
          <div className="empty">No session yet.</div>
        ) : (
          <TerminalPanel onExit={() => setStatus("exited")} />
        )}
      </main>
    </div>
  );
}

export default App;
