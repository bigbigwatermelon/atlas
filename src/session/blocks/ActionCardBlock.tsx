import { useTranslation } from "react-i18next";

import { Button } from "../../components/ui/Button";

export interface ActionCardAction {
  id: string;
  label: string;
  kind: "add" | "new" | "clone";
}

export interface ActionCardBlockProps {
  title: string;
  body?: string | null;
  actions: ActionCardAction[];
  /** When true, all buttons are disabled and a hint appears explaining why. */
  readOnly: boolean;
  /** Map of actionId → in-flight (disables the specific button + shows ellipsis). */
  busy: Record<string, boolean>;
  onAction: (action: ActionCardAction) => void;
}

export function ActionCardBlock({
  title,
  body,
  actions,
  readOnly,
  busy,
  onAction,
}: ActionCardBlockProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-surface px-3.5 py-3">
      {title ? <div className="text-sm font-medium text-ink">{title}</div> : null}
      {body ? <div className="mt-1 text-xs text-ink-muted">{body}</div> : null}
      {actions.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {actions.map((a) => {
            const isBusy = !!busy[a.id];
            return (
              <Button
                key={a.id}
                variant="default"
                size="sm"
                disabled={readOnly || isBusy}
                onClick={() => onAction(a)}
              >
                {isBusy ? "…" : a.label}
              </Button>
            );
          })}
        </div>
      ) : null}
      {readOnly ? (
        <div className="mt-2 text-xs text-ink-faint">{t("actionCard.readOnlyHint")}</div>
      ) : null}
    </div>
  );
}
