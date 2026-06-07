import { PanelLeftOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore } from "../state/store";

/**
 * Re-opens the collapsed left sidebar. Lives at the start of each main header
 * (the "nav bar") and renders nothing while the sidebar is open, so it can be
 * dropped into every view unconditionally.
 */
export function RailToggle() {
  const { navCollapsed, setNavCollapsed } = useStore();
  const { t } = useTranslation();
  if (!navCollapsed) return null;
  return (
    <button
      onClick={() => setNavCollapsed(false)}
      aria-label={t("nav.expandSidebar")}
      title={t("nav.expandSidebar")}
      className="-ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-md)] text-ink-faint transition-colors hover:bg-brand-ghost hover:text-ink"
    >
      <PanelLeftOpen size={16} />
    </button>
  );
}
