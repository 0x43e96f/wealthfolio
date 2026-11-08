import { useState } from "react";
import type { SpendTrip, SpendingRecord } from "./client";
import { tagsOf } from "./spending-ledger";

// The trips side by side: what each cost, over how many days, per day, and where most
// of it went. It counts the rows the page's other filters leave (a category chosen
// above compares, say, what each trip spent on food). A trip's name narrows the page to it.

const SHOW = 10;
type Order = "date" | "total" | "day";

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000) + 1;

export function TripCompare({
  rows,
  trips,
  money,
  onPick,
}: {
  rows: SpendingRecord[];
  trips: SpendTrip[];
  money: (usd: number) => string;
  onPick: (name: string) => void;
}) {
  const [order, setOrder] = useState<Order>("date");
  const [all, setAll] = useState(false);

  const found = new Map<string, { usd: number; count: number; parts: Map<string, number> }>();
  for (const row of rows)
    for (const tag of tagsOf(row)) {
      if (tag.kind !== "旅行" || !tag.value) continue;
      const trip = found.get(tag.value) ?? { usd: 0, count: 0, parts: new Map() };
      trip.usd += Number(row.usd);
      trip.count += 1;
      trip.parts.set(row.category, (trip.parts.get(row.category) ?? 0) + Number(row.usd));
      found.set(tag.value, trip);
    }
  const list = [...found.entries()].map(([name, item]) => {
    const trip = trips.find((t) => t.name === name);
    const days = trip ? daysBetween(trip.start_day, trip.end_day) : 0;
    return {
      name,
      ...item,
      start: trip?.start_day ?? "",
      end: trip?.end_day ?? "",
      days,
      perDay: days > 0 ? item.usd / days : 0,
      top: [...item.parts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    };
  });
  const sorted = [...list].sort((a, b) =>
    order === "total"
      ? b.usd - a.usd
      : order === "day"
        ? b.perDay - a.perDay
        : b.start.localeCompare(a.start),
  );
  if (sorted.length === 0) return null;
  const top = Math.max(1, ...sorted.map((trip) => (order === "day" ? trip.perDay : trip.usd)));
  const shown = all ? sorted : sorted.slice(0, SHOW);

  return (
    <section aria-label="旅行对比">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">旅行对比（{sorted.length} 趟）</h3>
        <span className="inline-flex text-xs">
          {(
            [
              ["date", "按时间"],
              ["total", "按合计"],
              ["day", "按每天"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={order === key}
              onClick={() => setOrder(key)}
              className={`focus-visible:ring-ring rounded px-2 py-0.5 focus-visible:outline-none focus-visible:ring-2 ${
                order === key ? "bg-muted font-medium" : "text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </span>
      </div>
      <ul className="divide-border divide-y text-sm">
        {shown.map((trip) => (
          <li key={trip.name} className="py-2">
            <div className="flex items-baseline gap-3">
              <button
                type="button"
                className="focus-visible:ring-ring min-w-0 truncate text-left font-medium underline focus-visible:outline-none focus-visible:ring-2"
                onClick={() => onPick(trip.name)}
              >
                {trip.name}
              </button>
              <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                {trip.days ? `${trip.days} 天，每天 ${money(trip.perDay)}` : ""}
              </span>
              <span className="w-24 shrink-0 text-right font-medium tabular-nums">
                {money(trip.usd)}
              </span>
            </div>
            <div
              className="bg-chart-1/60 mt-1 h-1 rounded"
              style={{
                width: `${Math.max(1, ((order === "day" ? trip.perDay : trip.usd) / top) * 100)}%`,
              }}
            />
            <p className="text-muted-foreground mt-1 text-xs tabular-nums">
              {trip.start && `${trip.start} ~ ${trip.end}\u3000`}
              {trip.count} 笔{"\u3000"}主要花在{" "}
              {trip.top.map(([part, usd]) => `${part} ${money(usd)}`).join("，")}
            </p>
          </li>
        ))}
      </ul>
      {sorted.length > SHOW && (
        <button type="button" className="mt-2 text-sm underline" onClick={() => setAll(!all)}>
          {all ? `只看前 ${SHOW} 趟` : `看全部 ${sorted.length} 趟`}
        </button>
      )}
    </section>
  );
}
