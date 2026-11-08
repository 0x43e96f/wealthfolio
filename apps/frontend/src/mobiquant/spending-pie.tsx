import { useState } from "react";

// How the total splits into the groups, as a ring: one arc per group in the same colours
// as 构成, and beside it each group's amount and share. Pointing at an arc or a line
// lights it at once; clicking narrows the page to that group.

export interface PieSlice {
  name: string;
  usd: number;
}

const SIZE = 200;
const RADIUS = 80;
const WIDTH = 30;
const GAP = "　"; // the site's separator between items on one line

// The point on the ring's centre line at a fraction of the way round, from twelve o'clock.
const at = (fraction: number, radius: number) => {
  const angle = fraction * 2 * Math.PI - Math.PI / 2;
  return [SIZE / 2 + radius * Math.cos(angle), SIZE / 2 + radius * Math.sin(angle)];
};

export function SpendingPie({
  slices,
  colour,
  money,
  onPick,
}: {
  slices: PieSlice[];
  colour: (name: string) => string;
  money: (usd: number) => string;
  onPick: (name: string) => void;
}) {
  const [lit, setLit] = useState<string | null>(null);
  // Refunds can leave a group below zero; a ring can only show what was spent.
  const parts = slices.filter((slice) => slice.usd > 0).sort((a, b) => b.usd - a.usd);
  const total = parts.reduce((sum, slice) => sum + slice.usd, 0);
  if (parts.length === 0 || total <= 0)
    return <p className="text-muted-foreground py-6 text-center text-sm">这个范围里没有消费。</p>;

  let start = 0;
  const arcs = parts.map((slice) => {
    const share = slice.usd / total;
    const from = start;
    start += share;
    return { ...slice, share, from, to: start };
  });
  const shown = arcs.find((arc) => arc.name === lit);
  const share = (value: number) => `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-52 w-52 shrink-0"
        role="img"
        aria-label={`各大类占比：${arcs.map((arc) => `${arc.name} ${share(arc.share)}`).join("，")}`}
      >
        {arcs.map((arc) => {
          const big = arc.to - arc.from > 0.5 ? 1 : 0;
          const whole = arc.to - arc.from > 0.9999;
          const [x1, y1] = at(arc.from, RADIUS);
          const [x2, y2] = at(whole ? arc.to - 0.0001 : arc.to, RADIUS);
          return (
            <path
              key={arc.name}
              d={`M ${x1} ${y1} A ${RADIUS} ${RADIUS} 0 ${big} 1 ${x2} ${y2}`}
              fill="none"
              stroke={colour(arc.name)}
              strokeWidth={lit === arc.name ? WIDTH + 8 : WIDTH}
              opacity={lit && lit !== arc.name ? 0.45 : 1}
              className="cursor-pointer"
              onPointerEnter={() => setLit(arc.name)}
              onPointerLeave={() => setLit(null)}
              onClick={() => onPick(arc.name)}
            />
          );
        })}
        {/* A thin gap between arcs, in the page's colour. */}
        {arcs.length > 1 &&
          arcs.map((arc) => {
            const [x1, y1] = at(arc.from, RADIUS - WIDTH / 2 - 5);
            const [x2, y2] = at(arc.from, RADIUS + WIDTH / 2 + 5);
            return (
              <line
                key={`gap-${arc.name}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="var(--background)"
                strokeWidth="2"
                pointerEvents="none"
              />
            );
          })}
        <text
          x={SIZE / 2}
          y={SIZE / 2 - 4}
          textAnchor="middle"
          fontSize="13"
          fill="var(--muted-foreground)"
        >
          {shown ? shown.name : "合计"}
        </text>
        <text
          x={SIZE / 2}
          y={SIZE / 2 + 16}
          textAnchor="middle"
          fontSize="15"
          fontWeight="600"
          fill="var(--foreground)"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {shown ? share(shown.share) : money(total)}
        </text>
      </svg>
      <ul className="w-full max-w-md space-y-1 text-sm" aria-label="占比明细">
        {arcs.map((arc) => (
          <li key={arc.name}>
            <button
              type="button"
              onPointerEnter={() => setLit(arc.name)}
              onPointerLeave={() => setLit(null)}
              onFocus={() => setLit(arc.name)}
              onBlur={() => setLit(null)}
              onClick={() => onPick(arc.name)}
              aria-label={`只看${arc.name}`}
              className={`focus-visible:ring-ring flex w-full items-center gap-2 rounded px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 ${
                lit === arc.name ? "bg-muted" : ""
              }`}
            >
              <span
                aria-hidden
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ background: colour(arc.name) }}
              />
              <span className="min-w-0 truncate">{arc.name}</span>
              <span className="ml-auto shrink-0 font-medium tabular-nums">{share(arc.share)}</span>
              <span className="text-muted-foreground w-28 shrink-0 text-right tabular-nums">
                {money(arc.usd)}
              </span>
            </button>
          </li>
        ))}
        {slices.some((slice) => slice.usd < 0) && (
          <li className="text-muted-foreground px-1 text-xs">
            退款多于花销的类别没画进去{GAP}
            {slices
              .filter((slice) => slice.usd < 0)
              .map((slice) => `${slice.name} ${money(slice.usd)}`)
              .join("，")}
          </li>
        )}
      </ul>
    </div>
  );
}
