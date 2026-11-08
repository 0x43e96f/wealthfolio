import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

// Spending month by month as thin columns. A month's fixed part sits at the bottom in its
// own colour, the rest above it, in the warning colour when the month is well above its
// usual level (the median of the twelve months before, a dashed step line). Over several
// years each year is named under its months with its total. Pointing at a month shows
// its figures at once; clicking (or Enter) opens that month.

export interface TrendPoint {
  key: string; // YYYY-MM
  usd: number;
  usual: number | null; // median of the twelve months before; null with too few of them
  fixed: number; // the part that comes every month whatever happens (rent, subscriptions …)
}

const HEIGHT = 200;
const PAD_X = 8;
const PAD_LEFT = 44; // room for the gridline amounts
const PAD_TOP = 14;
const PAD_BOTTOM = 4;
const GAP = "　"; // the site's separator between items on one line
export const HIGH_RATIO = 1.5; // a month this many times the usual one is marked
export const USUAL_MONTHS = 12;
const USUAL_AT_LEAST = 6; // fewer months before than this and there is no usual level

// The usual level of each month of a gapless monthly series.
export function withUsual(series: { key: string; usd: number; fixed: number }[]): TrendPoint[] {
  return series.map((point, index) => {
    const earlier = series.slice(Math.max(0, index - USUAL_MONTHS), index).map((p) => p.usd);
    // Spending that comes in some months only (a trip, one merchant) has no usual month:
    // a median of mostly empty months would call any month with spending "13 times".
    const empty = earlier.filter((usd) => usd <= 0).length;
    const enough = earlier.length >= USUAL_AT_LEAST && empty * 2 <= earlier.length;
    return { ...point, usual: enough ? median(earlier) : null };
  });
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// $12k, $3.4k, $850: for gridlines and year totals, where the cents are noise.
const short = (usd: number) =>
  usd >= 1000 ? `$${(usd / 1000).toFixed(usd >= 10_000 ? 0 : 1)}k` : `$${Math.round(usd)}`;

export function SpendingTrend({
  points,
  chosen,
  running,
  onPick,
  money,
}: {
  points: TrendPoint[];
  chosen: (key: string) => boolean;
  running: string; // the month still under way, or ""
  onPick: (key: string) => void;
  money: (usd: number) => string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const fit = () => {
      const wide = Math.round(node.getBoundingClientRect().width);
      if (wide) setWidth((was) => (was === wide ? was : wide));
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(fit);
    watch.observe(node);
    return () => watch.disconnect();
  }, []);

  if (points.length === 0)
    return <p className="text-muted-foreground py-6 text-center text-sm">这个范围里没有消费。</p>;

  const top = Math.max(1, ...points.map((point) => Math.max(point.usd, point.usual ?? 0))) * 1.08;
  const step = (width - PAD_LEFT - PAD_X) / points.length;
  const bar = Math.max(2, Math.min(step - 2, 28));
  const x = (index: number) => PAD_LEFT + step * (index + 0.5);
  const y = (usd: number) =>
    HEIGHT - PAD_BOTTOM - (Math.max(0, usd) / top) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
  const high = (point: TrendPoint) =>
    (point.usual ?? 0) > 0 && point.usd > (point.usual ?? 0) * HIGH_RATIO && point.key !== running;

  // The usual level as steps across each month, broken where a month has none.
  const usualRuns: string[][] = [];
  points.forEach((p, index) => {
    if (p.usual == null) {
      usualRuns.push([]);
      return;
    }
    const edges = [
      `${(x(index) - step / 2).toFixed(1)},${y(p.usual).toFixed(1)}`,
      `${(x(index) + step / 2).toFixed(1)},${y(p.usual).toFixed(1)}`,
    ];
    const run = usualRuns[usualRuns.length - 1];
    if (run) run.push(...edges);
    else usualRuns.push(edges);
  });

  // Three quiet gridlines at round amounts.
  const unit = (() => {
    const raw = top / 3;
    const power = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map((m) => m * power).find((m) => m >= raw) ?? raw;
  })();
  const grid = [1, 2, 3].map((k) => k * unit).filter((usd) => usd < top);

  // The chosen months as shaded spans (runs of consecutive months).
  const spans: { from: number; to: number }[] = [];
  points.forEach((point, index) => {
    if (!chosen(point.key) || points.every((p) => chosen(p.key))) return;
    const last = spans[spans.length - 1];
    if (last && last.to === index - 1) last.to = index;
    else spans.push({ from: index, to: index });
  });

  const nearest = (clientX: number, element: Element) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width) return null;
    const drawn = ((clientX - rect.left) / rect.width) * width;
    return Math.min(points.length - 1, Math.max(0, Math.floor((drawn - PAD_LEFT) / step)));
  };
  const point = (event: PointerEvent<SVGSVGElement>) =>
    setAt(nearest(event.clientX, event.currentTarget));
  const keys = (event: KeyboardEvent<SVGSVGElement>) => {
    const now = at ?? points.length - 1;
    if (event.key === "ArrowLeft") setAt(Math.max(0, now - 1));
    else if (event.key === "ArrowRight") setAt(Math.min(points.length - 1, now + 1));
    else if (event.key === "Enter" && at != null) onPick(points[at].key);
    else return;
    event.preventDefault();
  };

  const hovered = at != null ? points[at] : null;
  const versus = (usd: number, usual: number | null) => {
    if (!usual || usual <= 0) return "前 12 个月数据太少或时有时无，没有平常水平可比";
    const ratio = usd / usual;
    if (ratio >= 1.05) return `平常的 ${ratio.toFixed(1)} 倍`;
    if (ratio <= 0.95) return `比平常少 ${Math.round((1 - ratio) * 100)}%`;
    return "和平常差不多";
  };
  // Over several years: each year named under its months with its total, and a hairline
  // between years. Inside one year: the month numbers.
  const many = points.length > 14;
  const years = many
    ? [...new Set(points.map((p) => p.key.slice(0, 4)))].map((year) => {
        const indices = points.flatMap((p, index) => (p.key.startsWith(year) ? [index] : []));
        return {
          year,
          first: indices[0],
          middle: (x(indices[0]) + x(indices[indices.length - 1])) / 2,
          usd: indices.reduce((sum, index) => sum + points[index].usd, 0),
        };
      })
    : [];

  return (
    <div ref={box} className="relative">
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="focus-visible:ring-ring block h-[200px] w-full cursor-pointer touch-none rounded focus-visible:outline-none focus-visible:ring-2"
        role="img"
        tabIndex={0}
        aria-label="每月消费走势，左右键逐月查看，回车打开这个月"
        onPointerMove={point}
        onPointerDown={point}
        onPointerLeave={() => setAt(null)}
        onBlur={() => setAt(null)}
        onKeyDown={keys}
        onClick={() => at != null && onPick(points[at].key)}
      >
        {spans.map((span) => (
          <rect
            key={span.from}
            x={x(span.from) - step / 2}
            width={step * (span.to - span.from + 1)}
            y={0}
            height={HEIGHT}
            fill="var(--muted)"
          />
        ))}
        {grid.map((usd) => (
          <g key={usd}>
            <line
              x1={PAD_LEFT}
              x2={width - PAD_X}
              y1={y(usd)}
              y2={y(usd)}
              stroke="var(--border)"
              strokeOpacity="0.6"
            />
            <text
              x={PAD_LEFT - 6}
              y={y(usd) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--muted-foreground)"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {short(usd)}
            </text>
          </g>
        ))}
        {years.slice(1).map(({ year, first }) => (
          <line
            key={year}
            x1={x(first) - step / 2}
            x2={x(first) - step / 2}
            y1={PAD_TOP}
            y2={y(0)}
            stroke="var(--border)"
          />
        ))}
        {points.map((p, index) => {
          const left = x(index) - bar / 2;
          return (
            <g key={p.key} opacity={at != null && at !== index ? 0.7 : 1}>
              <rect
                x={left}
                width={bar}
                y={y(p.usd)}
                height={Math.max(0, y(p.fixed) - y(p.usd))}
                rx={Math.min(2, bar / 2)}
                fill={high(p) ? "var(--destructive)" : "var(--chart-1)"}
              />
              <rect
                x={left}
                width={bar}
                y={y(p.fixed)}
                height={Math.max(0, y(0) - y(p.fixed))}
                fill="var(--chart-4)"
              />
            </g>
          );
        })}
        <line
          x1={PAD_LEFT}
          x2={width - PAD_X}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--muted-foreground)"
          strokeOpacity="0.5"
        />
        {usualRuns
          .filter((run) => run.length > 1)
          .map((run) => (
            <polyline
              key={run[0]}
              points={run.join(" ")}
              fill="none"
              stroke="var(--foreground)"
              strokeOpacity="0.55"
              strokeDasharray="4 3"
            />
          ))}
      </svg>
      {hovered && at != null && (
        <div
          role="status"
          className="bg-popover text-popover-foreground pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-md border px-2 py-1 text-xs shadow-md"
          style={{
            left: Math.min(Math.max(x(at), 90), width - 90),
            transform: "translateX(-50%)",
          }}
        >
          <p className="font-medium tabular-nums">
            {hovered.key}
            {GAP}
            {money(hovered.usd)}
          </p>
          <p className="text-muted-foreground">
            {hovered.key === running ? "这个月还没过完" : versus(hovered.usd, hovered.usual)}
          </p>
          <p className="text-muted-foreground tabular-nums">
            固定 {money(hovered.fixed)}
            {GAP}其余 {money(hovered.usd - hovered.fixed)}
          </p>
        </div>
      )}
      {many ? (
        <div className="text-muted-foreground relative h-8 text-xs tabular-nums">
          {years.map(({ year, middle, usd }) => (
            <span
              key={year}
              className="absolute -translate-x-1/2 text-center leading-tight"
              style={{ left: middle }}
            >
              {year}
              <br />
              <span className="text-foreground">{short(usd)}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="text-muted-foreground relative h-4 text-xs tabular-nums">
          {points.map((p, index) => (
            <span key={p.key} className="absolute -translate-x-1/2" style={{ left: x(index) }}>
              {Number(p.key.slice(5))}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
