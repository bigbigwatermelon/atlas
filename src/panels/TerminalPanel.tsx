import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

/** Decode base64 (from the Rust side) into raw bytes for xterm. */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Embeds the native Claude TUI. Bidirectional: PTY output is rendered, and
 * keystrokes (incl. Ctrl-C, slashes, arrows) are forwarded to the child's
 * stdin. We intentionally pass keys straight through — the full key-ownership
 * table (intercepting only ⌘-prefixed keys) is M4.
 */
export function TerminalPanel({ onExit }: { onExit: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = new Terminal({
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace',
      fontSize: 13,
      theme: { background: "#0b0e14" },
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current!);
    fit.fit();

    // keystrokes -> child stdin
    const dataSub = term.onData((data) => {
      void invoke("write_pty", { data });
    });

    // keep PTY size synced to the viewport
    const pushResize = () => {
      try {
        fit.fit();
        void invoke("resize_pty", { rows: term.rows, cols: term.cols });
      } catch {
        /* no active session yet */
      }
    };
    const ro = new ResizeObserver(pushResize);
    ro.observe(hostRef.current!);

    // PTY output (frame-batched on the Rust side)
    const unlistenOut = listen<{ data: string }>("pty://output", (e) => {
      term.write(b64ToBytes(e.payload.data));
    });
    const unlistenExit = listen("pty://exit", () => {
      term.writeln("\r\n\x1b[2m[session exited]\x1b[0m");
      onExit();
    });

    return () => {
      dataSub.dispose();
      ro.disconnect();
      void unlistenOut.then((f) => f());
      void unlistenExit.then((f) => f());
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} className="term-host" />;
}
