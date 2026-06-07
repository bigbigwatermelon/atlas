import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  AppWindow,
  Boxes,
  CircleDashed,
  FileText,
  Package,
  RefreshCw,
  Server,
  type LucideProps,
} from "lucide-react";
import type { ComponentType } from "react";
import { useStore } from "../state/store";
import { cn } from "../lib/cn";

const ROLE_ICON: Record<string, ComponentType<LucideProps>> = {
  service: Server,
  app: AppWindow,
  library: Package,
  infra: Boxes,
  docs: FileText,
  unknown: CircleDashed,
};

const NODE_W = 250;
const NODE_H = 116;
const COL_GAP = 112;
const ROW_GAP = 28;
const PAD = 24;

/**
 * The repo map as a dependency graph — the whole Repos surface. Nodes are laid
 * out in columns by dependency depth (foundational libs left, top-level apps
 * right) and carry everything: role, stack, one-line summary, core flag,
 * re-profile. Edges are drawn dependent → dependency. No detail cards; the map
 * IS the view.
 */
export function RepoGraph() {
  const { repoProfiles, repoEdges, reprofileRepo } = useStore();
  const { t } = useTranslation();

  const layout = useMemo(() => {
    const ids = repoProfiles.map((p) => p.repo_id);
    const depsOf = (id: number) =>
      repoEdges.filter((e) => e.from === id).map((e) => e.to).filter((to) => ids.includes(to));
    const memo = new Map<number, number>();
    const depth = (id: number, seen = new Set<number>()): number => {
      const m = memo.get(id);
      if (m != null) return m;
      if (seen.has(id)) return 0; // cycle guard
      seen.add(id);
      const ds = depsOf(id);
      const d = ds.length === 0 ? 0 : 1 + Math.max(...ds.map((to) => depth(to, seen)));
      memo.set(id, d);
      return d;
    };

    const cols = new Map<number, number[]>();
    for (const p of repoProfiles) {
      const d = depth(p.repo_id);
      const arr = cols.get(d) ?? [];
      arr.push(p.repo_id);
      cols.set(d, arr);
    }
    const maxDepth = Math.max(0, ...[...cols.keys()]);
    const maxRows = Math.max(1, ...[...cols.values()].map((a) => a.length));

    const pos = new Map<number, { x: number; y: number }>();
    for (let d = 0; d <= maxDepth; d++) {
      const col = cols.get(d) ?? [];
      const offset = ((maxRows - col.length) * (NODE_H + ROW_GAP)) / 2;
      col.forEach((id, i) => {
        pos.set(id, { x: PAD + d * (NODE_W + COL_GAP), y: PAD + offset + i * (NODE_H + ROW_GAP) });
      });
    }
    const width = PAD * 2 + (maxDepth + 1) * NODE_W + maxDepth * COL_GAP;
    const height = PAD * 2 + maxRows * (NODE_H + ROW_GAP) - ROW_GAP;
    return { pos, width, height };
  }, [repoProfiles, repoEdges]);

  const usedByCount = (id: number) => repoEdges.filter((e) => e.to === id).length;

  return (
    <div className="h-full w-full overflow-auto">
      <div className="flex min-h-full min-w-fit items-center justify-center p-10">
        <div className="relative" style={{ width: layout.width, height: layout.height }}>
          <svg className="absolute inset-0" width={layout.width} height={layout.height} fill="none">
            <defs>
              <marker
                id="weft-arrow"
                viewBox="0 0 8 8"
                refX="6"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L8 4 L0 8 z" className="fill-border-strong" />
              </marker>
            </defs>
            {repoEdges.map((e, i) => {
              const a = layout.pos.get(e.from);
              const b = layout.pos.get(e.to);
              if (!a || !b) return null;
              const x1 = a.x; // dependent, left edge
              const y1 = a.y + NODE_H / 2;
              const x2 = b.x + NODE_W; // dependency, right edge
              const y2 = b.y + NODE_H / 2;
              const mx = (x1 + x2) / 2;
              return (
                <path
                  key={i}
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  className="stroke-border-strong"
                  strokeWidth={1.5}
                  markerEnd="url(#weft-arrow)"
                />
              );
            })}
          </svg>

          {repoProfiles.map((p) => {
            const pt = layout.pos.get(p.repo_id);
            if (!pt) return null;
            const Icon = ROLE_ICON[p.role] ?? CircleDashed;
            const dependents = usedByCount(p.repo_id);
            const core = dependents >= 2;
            return (
              <div
                key={p.repo_id}
                className={cn(
                  "group absolute flex flex-col gap-1.5 overflow-hidden rounded-[var(--radius-lg)] border bg-surface px-3 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
                  core ? "border-accent/50" : "border-border",
                )}
                style={{ left: pt.x, top: pt.y, width: NODE_W, height: NODE_H }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-raised">
                    <Icon size={12} className="text-ink-muted" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                    {p.repo_name}
                  </span>
                  {p.stale && (
                    <span
                      title={t("repomap.staleTitle")}
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-waiting"
                    />
                  )}
                  <button
                    onClick={() => void reprofileRepo(p.repo_id)}
                    aria-label={t("repomap.reprofile")}
                    title={t("repomap.reprofile")}
                    className="grid h-5 w-5 shrink-0 place-items-center rounded text-ink-faint opacity-0 transition-opacity hover:bg-brand-ghost hover:text-ink group-hover:opacity-100"
                  >
                    <RefreshCw size={11} />
                  </button>
                </div>

                <div className="flex flex-nowrap items-center gap-1 overflow-hidden">
                  <span className="shrink-0 rounded-full bg-bg px-1.5 py-px text-[10px] text-ink-faint">
                    {t(`repomap.role_${p.role}`, p.role)}
                  </span>
                  {p.stack.slice(0, 3).map((s) => (
                    <span
                      key={s}
                      className="shrink-0 rounded bg-bg px-1.5 py-px font-mono text-[10px] text-ink-faint"
                    >
                      {s}
                    </span>
                  ))}
                  {core && (
                    <span
                      title={t("repomap.rippleTitle", { count: dependents })}
                      className="ml-auto shrink-0 rounded-full bg-accent-ghost px-1.5 py-px text-[10px] font-medium text-accent"
                    >
                      {t("repomap.coreDependents", { count: dependents })}
                    </span>
                  )}
                </div>

                <p
                  className={cn(
                    "text-[11.5px] leading-snug",
                    p.summary ? "text-ink-muted" : "text-ink-faint italic",
                  )}
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {p.summary || t("repomap.addSummary")}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
