import { useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";

/**
 * Tiny app-wide toast for transient confirmations (e.g. "copied"). External
 * store so any action can `toast(msg)` without prop-drilling or a context.
 * Distinct from DangerToast (the once-a-day permission nudge).
 */
type Toast = { id: number; msg: string };

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
let seq = 0;

function notify() {
  for (const l of listeners) l();
}

export function toast(msg: string) {
  const id = ++seq;
  toasts = [...toasts, { id, msg }];
  notify();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, 3000);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function Toasts() {
  const items = useSyncExternalStore(subscribe, () => toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-raised px-3 py-2 text-[12.5px] text-ink shadow-[0_12px_40px_-10px_rgba(0,0,0,0.6)]"
          >
            <Check size={13} className="text-running" />
            {t.msg}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
