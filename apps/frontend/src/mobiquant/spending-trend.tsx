import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

// Spending month by month as one line. Each month's usual level is the median of the
// twelve months before it (a dashed line); months well above theirs are marked. Pointing
// at the line shows that month's figure at once; clicking (or Enter) opens that month.

export interface TrendPoint {
  key: string; // YYYY-MM
  usd: number;
  usual: number | null; // median of the twelve months before; null with too few of them
  fixed: number; // the part that comes every month whatever happens (rent, subscriptions …)
}

const HEIGHT = 200;
const PAD_X = 10;
const PAD_TOP = 14;
const PAD_BOTTOM = 6;
export const HIGH_RATIO = 1.5; // a month this many times the usual one is marked
export const USUAL_MONTHS = 12;
const USUAL_AT_LEAST = 6; // fewer months before than this and there is no usual level

// The usual level of each month of a gapless monthly series.
export function withUsual(series: { key: string; usd: number; fixed: number }[]): TrendPoint[] {
  return series.map((point, index) => {
    const earlier = series.slice(Math.max(0, index - USUAL_MONTHS), index).map((p) => p.usd);
    return { ...point, usual: earlier.length >= USUAL_AT_LEAST ? median(earlier) : null };
  });
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

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
  const x = (index: number) =>
    points.length > 1 ? PAD_X + (index * (width - 2 * PAD_X)) / (points.length - 1) : width / 2;
  const y = (usd: number) =>
    HEIGHT - PAD_BOTTOM - (Math.max(0, usd) / top) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
  const line = points.map((point, index) => `${x(index).toFixed(1)},${y(point.usd).toFixed(1)}`);
  const high = (point: TrendPoint) =>
    (point.usual ?? 0) > 0 && point.usd > (point.usual ?? 0) * HIGH_RATIO && point.key !== running;
  // The usual line, broken where a month has none.
  const usualRuns: string[][] = [];
  points.forEach((p, index) => {
    if (p.usual == null) return void usualRuns.push([]);
    const run = usualRuns[usualRuns.length - 1];
    const at = `${x(index).toFixed(1)},${y(p.usual).toFixed(1)}`;
    if (run) run.push(at);
    else usualRuns.push([at]);
  });
  const step = points.length > 1 ? (width - 2 * PAD_X) / (points.length - 1) : width;

  // The chosen months as shaded spans (runs of consecutive months).
  const spans: { from: number; to: number }[] = [];
  points.forEach((point, index) => {
    if (!chosen(point.key)) return;
    const last = spans[spans.length - 1];
    if (last && last.to === index - 1) last.to = index;
    else spans.push({ from: index, to: index });
  });

  const nearest = (clientX: number, element: Element) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width) return null;
    const drawn = ((clientX - rect.left) / rect.width) * width;
    const ratio = Math.min(1, Math.max(0, (drawn - PAD_X) / (width - 2 * PAD_X)));
    return Math.round(ratio * (points.length - 1));
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
    if (!usual || usual <= 0) return "前 12 个月数据不够，没有平常水平";
    const ratio = usd / usual;
    if (ratio >= 1.05) return `平常的 ${ratio.toFixed(1)} 倍`;
    if (ratio <= 0.95) return `比平常少 ${Math.round((1 - ratio) * 100)}%`;
    return "和平常差不多";
  };
  // Year names under the line when it spans years, month numbers when it is one year.
  const many = points.length > 14;
  const ticks = points
    .map((p, index) => ({ index, key: p.key }))
    .filter(({ key, index }) => (many ? key.endsWith("-01") || index === 0 : true));

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
            width={Math.max(step, 2) * (span.to - span.from + 1)}
            y={0}
            height={HEIGHT}
            fill="var(--muted)"
          />
        ))}
        {points.length > 1 && (
          <>
            <polygon
              points={`${x(0).toFixed(1)},${y(0)} ${line.join(" ")} ${x(points.length - 1).toFixed(1)},${y(0)}`}
              fill="var(--chart-1)"
              fillOpacity="0.15"
            />
            <polyline
              points={line.join(" ")}
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <polygon
              points={`${x(0).toFixed(1)},${y(0)} ${points
                .map((p, index) => `${x(index).toFixed(1)},${y(p.fixed).toFixed(1)}`)
                .join(" ")} ${x(points.length - 1).toFixed(1)},${y(0)}`}
              fill="var(--chart-4)"
              fillOpacity="0.55"
            />
          </>
        )}
        {usualRuns
          .filter((run) => run.length > 1)
          .map((run) => (
            <polyline
              key={run[0]}
              points={run.join(" ")}
              fill="none"
              stroke="var(--muted-foreground)"
              strokeDasharray="5 5"
            />
          ))}
        {points.map((p, index) =>
          high(p) ? (
            <circle key={p.key} cx={x(index)} cy={y(p.usd)} r="4" fill="var(--destructive)" />
          ) : null,
        )}
        {hovered && at != null && (
          <>
            <line
              x1={x(at)}
              x2={x(at)}
              y1={0}
              y2={HEIGHT}
              stroke="var(--muted-foreground)"
              strokeOpacity="0.5"
            />
            <circle
              cx={x(at)}
              cy={y(hovered.usd)}
              r="5"
              fill="var(--chart-1)"
              stroke="var(--background)"
              strokeWidth="2"
            />
          </>
        )}
      </svg>
      {hovered && at != null && (
        <div
          role="status"
          className="bg-popover text-popover-foreground pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-md border px-2 py-1 text-xs shadow-md"
          style={{
            left: Math.min(Math.max(x(at), 70), width - 70),
            transform: "translateX(-50%)",
          }}
        >
          <p className="font-medium tabular-nums">
            {hovered.key}
            {"　"}
            {money(hovered.usd)}
          </p>
          <p className="text-muted-foreground">
            {hovered.key === running ? "这个月还没过完" : versus(hovered.usd, hovered.usual)}
          </p>
          <p className="text-muted-foreground tabular-nums">
            固定 {money(hovered.fixed)}
            {"\u3000"}其余 {money(hovered.usd - hovered.fixed)}
          </p>
        </div>
      )}
      <div className="text-muted-foreground relative h-4 text-xs tabular-nums">
        {ticks.map(({ index, key }) => (
          <span
            key={key}
            className="absolute -translate-x-1/2"
            style={{ left: Math.min(Math.max(x(index), 14), width - 14) }}
          >
            {many ? key.slice(0, 4) : Number(key.slice(5))}
          </span>
        ))}
      </div>
    </div>
  );
}
