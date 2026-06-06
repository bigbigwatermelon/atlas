import { useEffect, useRef } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import "@xterm/xterm/css/xterm.css";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Our --c-* tokens are authored in OKLCH, which xterm's color parser can't read
 * (and which WebKit's `fillStyle` round-trip leaves as-is). Rasterizing the color
 * onto a 1×1 canvas and reading the pixel back rasterizes it to the sRGB bytes
 * xterm understands — handles any CSS color form, alpha included.
 */
const scratchCanvas = Object.assign(document.createElement("canvas"), {
  width: 1,
  height: 1,
});
const scratch = scratchCanvas.getContext("2d", { willReadFrequently: true })!;
function cssVar(name: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (!raw) return fallback;
  scratch.clearRect(0, 0, 1, 1);
  scratch.fillStyle = "#000";
  scratch.fillStyle = raw; // unparseable values leave fillStyle as "#000"
  scratch.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = scratch.getImageData(0, 0, 1, 1).data;
  return a === 255
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

/**
 * Base background/foreground/cursor/selection from the resolved app theme so a
 * light-mode session doesn't show a dark slab. The 16-color ANSI palette is left
 * to xterm's defaults — those belong to the agent's own output.
 */
function terminalTheme(): ITheme {
  return {
    background: cssVar("--c-bg", "#16151c"),
    foreground: cssVar("--c-ink", "#e9e8f2"),
    cursor: cssVar("--c-brand", "#8b7bff"),
    cursorAccent: cssVar("--c-bg", "#16151c"),
    selectionBackground: cssVar("--c-brand-ghost", "#2c2747"),
  };
}

/**
 * Embeds the native Claude TUI for ONE session. Bidirectional: PTY output
 * (filtered by sessionId) renders here; keystrokes forward to that session's
 * stdin. Keys pass straight through — the full key-ownership table is M4.
 */
export function TerminalPanel({ sessionId }: { sessionId: number }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = new Terminal({
      fontFamily:
        'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.2,
      theme: terminalTheme(),
      cursorBlink: true,
      scrollback: 8000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current!);
    fit.fit();
    term.focus();

    const dataSub = term.onData((data) => {
      void api.writePty(sessionId, data);
    });

    const pushResize = () => {
      try {
        fit.fit();
        void api.resizePty(sessionId, term.rows, term.cols);
      } catch {
        /* not ready */
      }
    };
    const ro = new ResizeObserver(pushResize);
    ro.observe(hostRef.current!);

    // Re-derive base colors when the app theme flips (data-theme on <html>).
    const themeObs = new MutationObserver(() => {
      term.options.theme = terminalTheme();
    });
    themeObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const unOut = listen<{ session_id: number; data: string }>(
      "pty://output",
      (e) => {
        if (e.payload.session_id === sessionId)
          term.write(b64ToBytes(e.payload.data));
      },
    );

    return () => {
      dataSub.dispose();
      ro.disconnect();
      themeObs.disconnect();
      void unOut.then((f) => f());
      term.dispose();
    };
  }, [sessionId]);

  return <div ref={hostRef} className="term-host" />;
}
