import { useState } from "react";
import { SEGMENTS, segment } from "./spending-split";

// How the spending of each year (or each month of one year) splits into the groups:
// one bar per period, a coloured piece per group. 金额 keeps the bars to scale against
// each other; 占比 stretches every bar to full width so the shares can be compared.
// Under the bars, the groups of the bar pointed at (else the latest) are listed; a group
// in the legend narrows the page to it.

export interface MixRow {
  key: string; // 2024, or 2024-05
  label: string;
  parts: Map<string, number>; // group → usd
  total: number;
}

// The group colours are look.css's --spend-1 … --spend-7, in the page's group order.
const COLOURS = [1, 2, 3, 4, 5, 6, 7].map((n) => `var(--spend-${n})`);

// A group's colour: by its place in the page's group order, the same in every chart.
export const groupColour = (groups: string[], group: string) =>
  COLOURS[Math.max(0, groups.indexOf(group)) % COLOURS.length];

export function SpendingMix({
  rows,
  groups,
  money,
  onGroup,
}: {
  rows: MixRow[];
  groups: string[]; // in the page's order; the colours follow it
  money: (usd: number) => string;
  onGroup: (group: string) => void;
}) {
  const [share, setShare] = useState(false);
  const [at, setAt] = useState<string | null>(null);
  const colour = (group: string) => groupColour(groups, group);
  const top = Math.max(1, ...rows.map((row) => row.total));
  // The period whose groups are listed under the bars: the one pointed at, else the latest.
  const detail = rows.find((row) => row.key === at) ?? rows[rows.length - 1];
  const used = groups.filter((group) => rows.some((row) => (row.parts.get(group) ?? 0) > 0));

  if (rows.length === 0)
    return <p className="text-muted-foreground py-3 text-sm">这个范围里没有消费。</p>;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {used.map((group) => (
          <button
            key={group}
            type="button"
            aria-label={`只看${group}`}
            onClick={() => onGroup(group)}
            className="focus-visible:ring-ring inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2"
          >
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: colour(group) }}
            />
            {group}
          </button>
        ))}
        <span className={`ml-auto ${SEGMENTS}`} role="group" aria-label="金额或占比">
          {(
            [
              [false, "金额"],
              [true, "占比"],
            ] as const
          ).map(([on, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={share === on}
              onClick={() => setShare(on)}
              className={segment(share === on)}
            >
              {label}
            </button>
          ))}
        </span>
      </div>
      <ul className="space-y-1.5">
        {rows.map((row) => {
          const width = share ? 100 : (row.total / top) * 100;
          const pieces = used
            .map((group) => ({ group, usd: row.parts.get(group) ?? 0 }))
            .filter((piece) => piece.usd > 0);
          return (
            <li
              key={row.key}
              className="flex items-center gap-2 text-xs"
              onPointerEnter={() => setAt(row.key)}
              onPointerLeave={() => setAt(null)}
            >
              <span className="text-muted-foreground w-12 shrink-0 tabular-nums">{row.label}</span>
              <div
                className="flex h-4 min-w-0 flex-1"
                role="img"
                tabIndex={0}
                aria-label={`${row.label} ${money(row.total)}：${pieces
                  .map((piece) => `${piece.group} ${money(piece.usd)}`)
                  .join("，")}`}
                onFocus={() => setAt(row.key)}
                onBlur={() => setAt(null)}
              >
                <div className="flex h-4 overflow-hidden rounded-sm" style={{ width: `${width}%` }}>
                  {pieces.map((piece) => (
                    <div
                      key={piece.group}
                      style={{
                        width: `${(piece.usd / Math.max(row.total, 1)) * 100}%`,
                        background: colour(piece.group),
                      }}
                    />
                  ))}
                </div>
              </div>
              <span className="w-24 shrink-0 text-right tabular-nums">{money(row.total)}</span>
            </li>
          );
        })}
      </ul>
      {detail && (
        <div aria-label="大类构成明细" aria-live="polite" className="mt-3 text-xs tabular-nums">
          <p className="mb-1 font-medium">
            {detail.label}
            {"\u3000"}
            {money(detail.total)}
          </p>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
            {used
              // Every group used anywhere, even at 0, so the list keeps its height
              // as the pointer moves from bar to bar.
              .map((group) => ({ group, usd: detail.parts.get(group) ?? 0 }))
              .sort((a, b) => b.usd - a.usd)
              .map((piece) => (
                <li key={piece.group} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-sm"
                    style={{ background: colour(piece.group) }}
                  />
                  {piece.group}
                  <span className="text-muted-foreground ml-auto">
                    {money(piece.usd)}
                    {"\u3000"}
                    {Math.round((piece.usd / Math.max(detail.total, 1)) * 100)}%
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
