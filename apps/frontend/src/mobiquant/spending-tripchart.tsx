import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

// When the page looks at trips, months are the wrong unit: most months have none. This
// draws one point per trip in time order against the average trip (a dashed line); a
// trip above it is in the warning colour, below it in the calm one. Pointing at a trip
// shows where, when, how long and what it cost against the average, at once; clicking
// (or Enter) narrows the page to it.

export interface TripPoint {
  name: string;
  start: string; // "" when the trip's dates are unknown
  end: string;
  days: number;
  usd: number;
}

const HEIGHT = 200;
const PAD_X = 16;
const PAD_TOP = 14;
const PAD_BOTTOM = 6;

export function TripChart({
  points,
  money,
  onPick,
}: {
  points: TripPoint[];
  money: (usd: number) => string;
  onPick: (name: string) => void;
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
    return <p className="text-muted-foreground py-6 text-center text-sm">这个范围里没有旅行。</p>;

  const average = points.reduce((sum, p) => sum + p.usd, 0) / points.length;
  const top = Math.max(1, average, ...points.map((p) => p.usd)) * 1.1;
  const x = (index: number) =>
    points.length > 1 ? PAD_X + (index * (width - 2 * PAD_X)) / (points.length - 1) : width / 2;
  const y = (usd: number) =>
    HEIGHT - PAD_BOTTOM - (Math.max(0, usd) / top) * (HEIGHT - PAD_TOP - PAD_BOTTOM);
  const tone = (usd: number) => (usd > average ? "var(--destructive)" : "var(--success)");

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
    else if (event.key === "Enter" && at != null) onPick(points[at].name);
    else return;
    event.preventDefault();
  };

  const hovered = at != null ? points[at] : null;
  const versus = (usd: number) => {
    const diff = usd - average;
    const pct = average > 0 ? Math.round((Math.abs(diff) / average) * 100) : 0;
    if (pct < 5) return "和平均差不多";
    return `比平均${diff > 0 ? "多" : "少"} ${money(Math.abs(diff))}（${pct}%）`;
  };
  // A year under the first trip of that year, unless it would sit on the one before.
  const ticks: { index: number; year: string }[] = [];
  points.forEach((p, index) => {
    const year = p.start.slice(0, 4);
    const last = ticks[ticks.length - 1];
    if (!year || (index > 0 && points[index - 1].start.slice(0, 4) === year)) return;
    if (last && x(index) - x(last.index) < 40) return;
    ticks.push({ index, year });
  });
  return (
    <div ref={box} className="relative">
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="focus-visible:ring-ring block h-[200px] w-full cursor-pointer touch-none rounded focus-visible:outline-none focus-visible:ring-2"
        role="img"
        tabIndex={0}
        aria-label="每趟旅行的花费，左右键逐趟查看，回车只看这一趟"
        onPointerMove={point}
        onPointerDown={point}
        onPointerLeave={() => setAt(null)}
        onBlur={() => setAt(null)}
        onKeyDown={keys}
        onClick={() => at != null && onPick(points[at].name)}
      >
        <line
          x1={PAD_X}
          x2={width - PAD_X}
          y1={y(average)}
          y2={y(average)}
          stroke="var(--muted-foreground)"
          strokeDasharray="5 5"
        />
        {points.map((p, index) => (
          <g key={p.name}>
            <line
              x1={x(index)}
              x2={x(index)}
              y1={y(0)}
              y2={y(p.usd)}
              stroke={tone(p.usd)}
              strokeOpacity={at === index ? 0.9 : 0.4}
              strokeWidth="2"
            />
            <circle cx={x(index)} cy={y(p.usd)} r={at === index ? 6 : 4} fill={tone(p.usd)} />
          </g>
        ))}
      </svg>
      <span
        className="text-muted-foreground bg-background pointer-events-none absolute right-0 px-1 text-xs tabular-nums"
        style={{ top: Math.max(0, y(average) - 18) }}
      >
        平均每趟 {money(average)}
      </span>
      {hovered && at != null && (
        <div
          role="status"
          className="bg-popover text-popover-foreground pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-md border px-2 py-1 text-xs shadow-md"
          style={{ left: Math.min(Math.max(x(at), 90), width - 90), transform: "translateX(-50%)" }}
        >
          <p className="font-medium">{hovered.name}</p>
          {hovered.start && (
            <p className="text-muted-foreground tabular-nums">
              {hovered.start} ~ {hovered.end}
              {"　"}
              {hovered.days} 天
            </p>
          )}
          <p className="tabular-nums">
            {money(hovered.usd)}
            {hovered.days > 0 && (
              <span className="text-muted-foreground">
                {"　"}每天 {money(hovered.usd / hovered.days)}
              </span>
            )}
          </p>
          <p className={hovered.usd > average ? "text-destructive" : "text-success"}>
            {versus(hovered.usd)}
          </p>
        </div>
      )}
      <div className="text-muted-foreground relative h-4 text-xs tabular-nums">
        {ticks.map(({ index, year }) => (
          <span
            key={year}
            className="absolute -translate-x-1/2"
            style={{ left: Math.min(Math.max(x(index), 14), width - 14) }}
          >
            {year}
          </span>
        ))}
      </div>
    </div>
  );
}
