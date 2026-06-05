# Thread Bus v1b (coordination panel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the thread bus visible and human-operable: a coordination panel on the thread board shows the live message timeline, lets the human post/broadcast as "you", and lets the human nudge a direction's live session to check its inbox.

**Architecture:** Two thin Tauri commands over the existing `BusRegistry` (`thread_messages` reads the non-destructive timeline; `bus_post_human` posts/broadcasts as identity "you"). The frontend adds a `CoordinationPanel` (polls the timeline, renders it, composer to post) on the thread board, plus a "nudge" affordance that injects a one-line "check your inbox" prompt into a direction's running session via the existing `write_pty`.

**Tech Stack:** Rust/Tauri (2 commands), React/TS (panel + composer), the v1a bus.

---

## Reference
- Spec: `docs/superpowers/specs/2026-06-05-thread-bus-coordination-design.md`.
- v1a (committed): `BusRegistry` with `log(thread) -> Vec<Msg>`, `post(thread, from, to, text, kind)`, `broadcast(thread, from, text, kind)`; `Msg { from, to, text, ts, kind }` (serde Serialize). The bus runs at startup; `BusRegistry` is in Tauri state.
- The frontend store (`src/state/store.tsx`) tracks `sessions: Record<sessionId, OpenSession{ info, status, directionId, repoId }>` and `activeThreadId`. `api.writePty(sessionId, data)` exists.

## Scope
**In (v1b):** `thread_messages` + `bus_post_human` commands; coordination panel (timeline + composer); per-direction human nudge (via write_pty).
**Out (v1c):** automatic coordinator wake (needs idle detection to inject safely), passive `.thread/` + PLAN.md layer, `ask` request/response.

## File structure
```
src-tauri/src/commands.rs        # MODIFY: thread_messages + bus_post_human
src-tauri/src/lib.rs             # MODIFY: register the two commands
src/lib/types.ts                 # MODIFY: BusMsg type
src/lib/api.ts                   # MODIFY: threadMessages, busPostHuman
src/state/store.tsx              # MODIFY: messages state + poll + post + nudge
src/board/CoordinationPanel.tsx  # CREATE: timeline + composer
src/board/ThreadBoard.tsx        # MODIFY: mount the panel; nudge on cards
```

## Shared types
- `BusMsg { from: string; to: string; text: string; ts: number; kind: string }` (matches Rust `Msg`).
- Human identity in the bus = the literal string `"you"`; broadcast `to` = `"*"`.

---

## Task 1: Backend commands — read timeline + human post

**Files:** Modify `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`.

- [ ] **Step 1: Add the two commands to `src-tauri/src/commands.rs`**

At the end of the file add (the file already has `use ...; type R<T> = Result<T, String>; fn e<E: ToString>(x: E) -> String`):
```rust
#[tauri::command]
pub fn thread_messages(
    bus: tauri::State<'_, crate::bus::BusRegistry>,
    thread_id: i32,
) -> R<Vec<crate::bus::Msg>> {
    Ok(bus.log(thread_id))
}

#[tauri::command]
pub fn bus_post_human(
    bus: tauri::State<'_, crate::bus::BusRegistry>,
    thread_id: i32,
    to: Option<String>,
    text: String,
) -> R<()> {
    match to {
        Some(target) if !target.is_empty() && target != "*" => {
            bus.post(thread_id, "you", &target, &text, "message");
        }
        _ => {
            bus.broadcast(thread_id, "you", &text, "message");
        }
    }
    Ok(())
}
```
Note: `crate::bus::Msg` is `Serialize` (v1a), so it crosses IPC. `BusRegistry::log/post/broadcast` are existing v1a methods.

- [ ] **Step 2: Register them in `src-tauri/src/lib.rs`**

In the `tauri::generate_handler![ ... ]` list, after `commands::delete_thread,` add:
```rust
            commands::thread_messages,
            commands::bus_post_human,
```

- [ ] **Step 3: Verify it compiles + no regressions**

Run: `cd /Users/solojiang/workspace/weft/src-tauri && cargo build 2>&1 | tail -6 && cargo test --lib 2>&1 | tail -4`
Expected: `Finished`; lib tests still pass (no new tests here — these are thin wrappers over already-tested `BusRegistry`; behavior is covered by the v1b live e2e in Task 5). Also `cargo clippy --lib 2>&1 | tail -3` must stay clean (no unwrap in the new code).

- [ ] **Step 4: Commit**
```bash
cd /Users/solojiang/workspace/weft
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(bus): thread_messages + bus_post_human commands"
```
End every commit in this plan with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## Task 2: Frontend types + api

**Files:** Modify `src/lib/types.ts`, `src/lib/api.ts`.

- [ ] **Step 1: Add `BusMsg` to `src/lib/types.ts`**

Append:
```ts
export interface BusMsg {
  from: string;
  to: string;
  text: string;
  ts: number;
  kind: string;
}
```

- [ ] **Step 2: Add api methods to `src/lib/api.ts`**

In the `api` object (and import `BusMsg`), add:
```ts
  threadMessages: (threadId: number) =>
    invoke<BusMsg[]>("thread_messages", { threadId }),
  busPostHuman: (threadId: number, to: string | null, text: string) =>
    invoke<void>("bus_post_human", { threadId, to, text }),
```
Add `BusMsg` to the type import from `./types`.

- [ ] **Step 3: Verify typecheck**

Run: `cd /Users/solojiang/workspace/weft && PATH=/Users/solojiang/.nvm/versions/node/v24.15.0/bin:$PATH npx tsc --noEmit 2>&1 | tail -5`
Expected: no errors (unused exports are fine until Task 3/4 consume them).

- [ ] **Step 4: Commit**
```bash
cd /Users/solojiang/workspace/weft
git add src/lib/types.ts src/lib/api.ts
git commit -m "feat(ui): BusMsg type + thread_messages/bus_post_human api"
```

---

## Task 3: Store — messages polling + post + nudge

**Files:** Modify `src/state/store.tsx`.

- [ ] **Step 1: Add messages state, a poller, and actions**

In `src/state/store.tsx`:

1. Import `BusMsg`: add to the `import type { ... } from "../lib/types"` list.
2. Add to the `Store` interface (after `activeSessionId`):
```ts
  messages: BusMsg[];
  postHuman: (to: string | null, text: string) => Promise<void>;
  nudgeDirection: (directionId: number) => Promise<void>;
```
3. Add state in the provider (near the other `useState`s):
```ts
  const [messages, setMessages] = useState<BusMsg[]>([]);
```
4. Add a poller effect that refreshes the active thread's timeline every 1.5s (after the other effects):
```ts
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
```
5. Add the actions (near the other `useCallback`s):
```ts
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
```
6. Add `messages`, `postHuman`, `nudgeDirection` to the returned `value` object.

- [ ] **Step 2: Verify typecheck**

Run: `cd /Users/solojiang/workspace/weft && PATH=/Users/solojiang/.nvm/versions/node/v24.15.0/bin:$PATH npx tsc --noEmit 2>&1 | tail -5`
Expected: no errors.

- [ ] **Step 3: Commit**
```bash
cd /Users/solojiang/workspace/weft
git add src/state/store.tsx
git commit -m "feat(ui): poll thread bus timeline; human post + nudge actions"
```

---

## Task 4: Coordination panel + board wiring

**Files:** Create `src/board/CoordinationPanel.tsx`; modify `src/board/ThreadBoard.tsx`.

- [ ] **Step 1: Create `src/board/CoordinationPanel.tsx`**

```tsx
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Megaphone, Radio, Send } from "lucide-react";
import { useStore } from "../state/store";
import type { Direction } from "../lib/types";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { cn } from "../lib/cn";

/** A right-rail panel: the thread's bus timeline + a human composer. */
export function CoordinationPanel({ directions }: { directions: Direction[] }) {
  const { messages, postHuman } = useStore();
  const [to, setTo] = useState<string>("*");
  const [text, setText] = useState("");

  const nameOf = useMemo(() => {
    const m: Record<string, string> = { you: "you", "*": "all" };
    for (const d of directions) m[String(d.id)] = d.name;
    return (key: string) => m[key] ?? key;
  }, [directions]);

  const options = useMemo(
    () => [
      { value: "*", label: "Broadcast · all directions" },
      ...directions.map((d) => ({ value: String(d.id), label: d.name })),
    ],
    [directions],
  );

  async function send() {
    if (!text.trim()) return;
    await postHuman(to === "*" ? null : to, text);
    setText("");
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-surface">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Radio size={13} className="text-brand" />
        <span className="text-[12px] font-semibold text-ink">Thread bus</span>
        <span className="ml-auto text-[11px] text-ink-faint">
          {messages.length} {messages.length === 1 ? "message" : "messages"}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-3 py-2">
        {/* col-reverse keeps the newest pinned to the bottom */}
        <div className="flex flex-col gap-1.5">
          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <motion.div
                key={`${m.ts}-${i}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.16 }}
                className={cn(
                  "rounded-[var(--radius-md)] border border-border bg-bg px-2.5 py-1.5",
                  m.kind === "interface" && "border-approval/40",
                )}
              >
                <div className="flex items-center gap-1.5 text-[10px] text-ink-faint">
                  {m.kind === "interface" && (
                    <Megaphone size={10} className="text-approval" />
                  )}
                  <span className="font-medium text-ink-muted">{nameOf(m.from)}</span>
                  <span>→</span>
                  <span>{nameOf(m.to)}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px] text-ink">
                  {m.text}
                </p>
              </motion.div>
            ))}
          </AnimatePresence>
          {messages.length === 0 && (
            <p className="px-1 py-6 text-center text-[11px] leading-relaxed text-ink-faint">
              No messages yet. Directions post here via the bus; you can too.
            </p>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex flex-col gap-2 border-t border-border p-3"
      >
        <Select value={to} onValueChange={setTo} ariaLabel="Recipient" options={options} />
        <div className="flex gap-2">
          <Input
            placeholder="Message the thread…"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
          />
          <Button type="submit" variant="primary" size="icon" disabled={!text.trim()}>
            <Send size={14} />
          </Button>
        </div>
      </form>
    </aside>
  );
}
```

- [ ] **Step 2: Mount it on the board + add a nudge button to running direction cards**

In `src/board/ThreadBoard.tsx`:

1. Import the panel and the bell icon:
```tsx
import { Bell } from "lucide-react";
import { CoordinationPanel } from "./CoordinationPanel";
```
2. Wrap the board body + panel in a flex row. Change the `ThreadBoard` return so the existing scrollable directions area and the panel sit side by side. Find the outer `<section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg">` and its children: keep the `<header>` as-is, but wrap the directions `<div className="min-h-0 flex-1 overflow-y-auto ...">` and the new panel in a horizontal flex:
```tsx
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* ...existing dirs grid / EmptyBoard exactly as before... */}
        </div>
        <CoordinationPanel directions={dirs} />
      </div>
```
(Move the existing directions-area `<div>` inside this new flex row; the `CreateDirectionDialog` stays after it.)

3. In `DirectionCard`, add a nudge button shown only when the direction has a running session. Inside `DirectionCard`, compute:
```tsx
  const { nudgeDirection } = useStore();
  const hasLive = Object.values(sessions).some(
    (s) => s.directionId === direction.id && s.status === "running",
  );
```
and in the card header (the `<div className="flex items-center gap-2 border-b ...">`), before the tool chip's `ml-auto`, add a nudge button:
```tsx
        {hasLive && (
          <button
            onClick={() => void nudgeDirection(direction.id)}
            aria-label="Nudge this direction to read its inbox"
            title="Nudge: tell this agent to check the thread bus"
            className="grid h-5 w-5 place-items-center rounded text-ink-faint transition-colors hover:bg-brand-ghost hover:text-brand"
          >
            <Bell size={12} />
          </button>
        )}
```
(Keep the tool chip with its `ml-auto` so it stays right-aligned; the nudge sits just left of it.)

- [ ] **Step 3: Build the frontend**

Run: `cd /Users/solojiang/workspace/weft && PATH=/Users/solojiang/.nvm/versions/node/v24.15.0/bin:$PATH npm run build 2>&1 | tail -6`
Expected: `built` with no TS errors.

- [ ] **Step 4: Commit**
```bash
cd /Users/solojiang/workspace/weft
git add src/board/CoordinationPanel.tsx src/board/ThreadBoard.tsx
git commit -m "feat(ui): thread-bus coordination panel (timeline + composer) + per-direction nudge"
```

---

## Task 5: Live verification via the dev bridge

**Files:** none (verification).

- [ ] **Step 1: Launch the app (isolated home), connect the bridge, seed a thread + two directions, open one session**

Same harness as prior milestones (WEFT_HOME isolation, `driver_session` on 9223). Seed a workspace + repo + thread + a claude direction; open its session and drive past the trust gate.

- [ ] **Step 2: Verify the panel shows messages**

From Bash, `curl` a `bus_post` from a fake direction to the thread (e.g. `POST <busBase>/bus/<thread>/99/mcp` `bus_broadcast {text:"hello from 99"}`). Screenshot the board (`mcp__tauri__webview_screenshot`) and confirm the coordination panel timeline shows the message (from "99" → all). Then via `webview_execute_js` click the composer Send (or call `busPostHuman`) and confirm a "you → all" message appears and is readable by an agent (`curl bus_inbox` for the claude direction returns it).

- [ ] **Step 3: Verify nudge**

With the claude session running, click the direction card's Bell (nudge) via `webview_execute_js`; confirm (read the xterm or check the session received input) that the wake prompt was written to the agent's PTY.

- [ ] **Step 4: Record the result in the spec + commit**
```bash
cd /Users/solojiang/workspace/weft
git add docs/superpowers/specs/2026-06-05-thread-bus-coordination-design.md
git commit -m "docs(thread-bus): record v1b coordination panel live verification"
```

---

## Self-review checklist
- **Spec coverage:** UI coordination panel showing the bus timeline (T4) ✓; human posts/broadcasts as "you" (T1 command, T3 action, T4 composer) ✓; per-direction nudge (T3 nudge via write_pty, T4 button) ✓. Automatic coordinator wake + passive `.thread/` layer are explicitly **v1c** (out of scope, documented).
- **Placeholder scan:** none — real code/commands throughout.
- **Type consistency:** `BusMsg{from,to,text,ts,kind}` (Rust `Msg` mirror), `thread_messages(threadId)->BusMsg[]`, `busPostHuman(threadId, to|null, text)`, store `messages`/`postHuman`/`nudgeDirection`, `nudgeDirection` reuses `writePty(sessionId,data)` — consistent across tasks.

## Notes for the executor
- node v24 for tsc/vite/tauri dev. clippy must stay clean (no unwrap in the new commands).
- The panel polls every 1.5s — acceptable for v1b; a push/event feed is a later optimization.
- Nudge is HUMAN-triggered on purpose: automatic wake is v1c (needs idle detection to avoid injecting mid-turn). Do not add auto-injection here.
- The bus timeline (`BusRegistry::log`) is non-destructive (unlike `inbox` which agents consume), so the panel can show history without stealing agents' unread.
