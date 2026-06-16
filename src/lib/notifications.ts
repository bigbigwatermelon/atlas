import { useEffect, useRef } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { useStore } from "../state/store";
import type { NeedItem, PermissionAsk } from "./types";

/** Three-state OS permission. macOS prompts exactly once — after a refusal,
 *  requestPermission returns "denied" without a dialog and the only remedy is
 *  the OS settings pane, so callers must tell "denied" apart from "prompt". */
export type NotifyPermission = "granted" | "denied" | "prompt";

export async function notifyPermission(): Promise<NotifyPermission> {
  try {
    if (await isPermissionGranted()) return "granted";
    const perm = (window as { Notification?: { permission?: string } }).Notification
      ?.permission;
    return perm === "denied" ? "denied" : "prompt";
  } catch {
    return "denied"; // pure-vite dev: plugin unavailable
  }
}

/** Resolve to a settled state, asking the OS only from "prompt" (a dismissed
 *  dialog stays "prompt" so the user can be asked again later). */
export async function ensureNotifyPermission(): Promise<NotifyPermission> {
  const p = await notifyPermission();
  if (p !== "prompt") return p;
  try {
    const r = await requestPermission();
    return r === "granted" ? "granted" : r === "denied" ? "denied" : "prompt";
  } catch {
    return "denied";
  }
}

/** Jump to the OS notification settings. macOS / Windows have stable URLs;
 *  Linux has no portable one — returns false and the caller's copy stands. */
export async function openSystemNotificationSettings(): Promise<boolean> {
  const ua = navigator.userAgent;
  const url = ua.includes("Mac")
    ? "x-apple.systempreferences:com.apple.preference.notifications"
    : ua.includes("Windows")
      ? "ms-settings:notifications"
      : null;
  if (!url) return false;
  try {
    await openUrl(url);
    return true;
  } catch {
    return false;
  }
}

/** OS notifications for new Needs-you and permission items. */

/** Notify-relevant state reduced to stable identity keys → context line. */
export interface NotifySnapshot {
  needs: Map<string, string>;
}

export function snapshotOf(
  needs: NeedItem[],
  asks: PermissionAsk[],
): NotifySnapshot {
  const n = new Map<string, string>();
  for (const it of needs) {
    n.set(`need:${it.ask_id}`, `${it.thread_title} · ${it.direction_name}`);
  }
  for (const a of asks) {
    n.set(`ask:${a.id}`, `${a.thread_title} · ${a.dir_name}`);
  }
  return { needs: n };
}

export interface NotifyEvent {
  kind: "needs";
  count: number;
  /** Context of the first new item, used as the body when count === 1. */
  sample: string;
}

/** New keys in `next` that weren't in `prev` — the things worth a ping. */
export function notificationEvents(
  prev: NotifySnapshot,
  next: NotifySnapshot,
): NotifyEvent[] {
  const out: NotifyEvent[] = [];
  const fresh = [...next.needs].filter(([k]) => !prev.needs.has(k));
  if (fresh.length > 0) {
    out.push({ kind: "needs", count: fresh.length, sample: fresh[0][1] });
  }
  return out;
}

/**
 * Mounted once in App. Reuses the store's Needs-you aggregation. First load and
 * task-list switches rebuild the baseline silently.
 */
export function useSystemNotifications() {
  const { needs, asks, notifyEnabled, activeWorkspaceId } = useStore();
  const { t } = useTranslation();
  const prev = useRef<NotifySnapshot | null>(null);
  const baselineWs = useRef<number | null>(null);
  const granted = useRef<boolean | null>(null);

  // OS permission, settled once per enable. Only a never-asked "prompt" state
  // raises the system dialog; a past refusal stays silent (Settings shows the
  // denied hint with the System-Settings jump).
  useEffect(() => {
    if (!notifyEnabled) return;
    void ensureNotifyPermission().then((p) => {
      granted.current = p === "granted";
    });
  }, [notifyEnabled]);

  useEffect(() => {
    const next = snapshotOf(needs, asks);
    const base = baselineWs.current === activeWorkspaceId ? prev.current : null;
    prev.current = next;
    baselineWs.current = activeWorkspaceId;
    if (!base) return; // first load / workspace switch: baseline only
    if (!notifyEnabled || granted.current !== true) return;
    if (document.hasFocus()) return; // already looking at the app
    for (const ev of notificationEvents(base, next)) {
      try {
        sendNotification({
          title: t("notify.needsTitle"),
          body:
            ev.count === 1
              ? ev.sample
              : t("notify.needsBody", { count: ev.count }),
        });
      } catch {
        /* never let a failed ping disturb the app */
      }
    }
  }, [needs, asks, notifyEnabled, activeWorkspaceId, t]);
}
