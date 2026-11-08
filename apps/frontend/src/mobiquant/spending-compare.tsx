import { useState } from "react";
import type { SpendTrip, SpendingRecord } from "./client";
import { tagsOf } from "./spending-ledger";
import { SplitList, type SplitItem } from "./spending-split";

// Parts of what the page shows set side by side at one level the owner picks: fine
// categories (the default), merchants, or the values of a tag kind (each trip, each
// means of transport …). Trips also get their days and cost per day. It follows every
// filter above it, so ticking two trips compares those two; picking a line narrows the
// page to it.

const SHOW = 10;
const GAP = "\u3000"; // the site's separator between items on one line
export type CompareBy = string; // 类别, 商户, or a tag kind
type Order = "total" | "change" | "day" | "date";

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000) + 1;

export function Compare({
  rows,
  beforeRows,
  compare,
  trips,
  tagKinds,
  preferred,
  money,
  onPick,
}: {
  rows: SpendingRecord[];
  beforeRows: SpendingRecord[];
  compare: boolean; // there is a period before to set against
  trips: SpendTrip[];
  tagKinds: string[];
  preferred: CompareBy; // what the filters suggest (旅行 once a trip is ticked)
  money: (usd: number) => string;
  onPick: (by: CompareBy, name: string) => void;
}) {
  const [chosen, setChosen] = useState<CompareBy | null>(null);
  const [order, setOrder] = useState<Order>("total");
  const [all, setAll] = useState(false);

  // Only tag kinds whose rows name something (旅行: a trip) can be compared.
  const kinds = tagKinds.filter((kind) =>
    rows.some((row) => tagsOf(row).some((t) => t.kind === kind && t.value)),
  );
  const levels = ["类别", "商户", ...kinds];
  const by =
    chosen && levels.includes(chosen) ? chosen : levels.includes(preferred) ? preferred : "类别";
  const isTrip = by === "旅行";
  const namesOf = (row: SpendingRecord): string[] =>
    by === "类别"
      ? [row.category]
      : by === "商户"
        ? [row.description]
        : tagsOf(row)
            .filter((t) => t.kind === by && t.value)
            .map((t) => t.value);

  const found = new Map<string, { usd: number; count: number }>();
  for (const row of rows)
    for (const name of namesOf(row)) {
      const item = found.get(name) ?? { usd: 0, count: 0 };
      found.set(name, { usd: item.usd + Number(row.usd), count: item.count + 1 });
    }
  const was = new Map<string, number>();
  for (const row of beforeRows)
    for (const name of namesOf(row)) was.set(name, (was.get(name) ?? 0) + Number(row.usd));
  const sum = [...found.values()].reduce((total, item) => total + item.usd, 0);

  const items = [...found.entries()].map(([name, item]) => {
    const trip = isTrip ? trips.find((t) => t.name === name) : undefined;
    const days = trip ? daysBetween(trip.start_day, trip.end_day) : 0;
    return {
      key: name,
      name,
      ...item,
      was: was.get(name) ?? 0,
      start: trip?.start_day ?? "",
      perDay: days ? item.usd / days : 0,
      note: trip
        ? `${trip.start_day} ~ ${trip.end_day}${GAP}${days} 天${GAP}每天 ${money(item.usd / days)}`
        : undefined,
    };
  });
  const orders: [Order, string][] = [
    ["total", "按合计"],
    ...(compare ? ([["change", "按变化"]] as [Order, string][]) : []),
    ...(isTrip
      ? ([
          ["day", "按每天"],
          ["date", "按时间"],
        ] as [Order, string][])
      : []),
  ];
  const how = orders.some(([key]) => key === order) ? order : "total";
  const sorted = [...items].sort((a, b) =>
    how === "change"
      ? b.usd - b.was - (a.usd - a.was)
      : how === "day"
        ? b.perDay - a.perDay
        : how === "date"
          ? b.start.localeCompare(a.start)
          : b.usd - a.usd,
  );
  const shown: SplitItem[] = all ? sorted : sorted.slice(0, SHOW);
  const toggle = (on: boolean) =>
    `focus-visible:ring-ring rounded px-2 py-0.5 focus-visible:outline-none focus-visible:ring-2 ${
      on ? "bg-muted font-medium" : "text-muted-foreground"
    }`;

  return (
    <section aria-label="对比">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-sm font-medium">对比（{sorted.length} 项）</h3>
        <span className="inline-flex flex-wrap text-xs" role="group" aria-label="对比什么">
          {levels.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={by === level}
              onClick={() => setChosen(level)}
              className={toggle(by === level)}
            >
              {level}
            </button>
          ))}
        </span>
        <span className="inline-flex text-xs" role="group" aria-label="排序">
          {orders.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={how === key}
              onClick={() => setOrder(key)}
              className={toggle(how === key)}
            >
              {label}
            </button>
          ))}
        </span>
      </div>
      <SplitList
        items={shown}
        compare={compare}
        money={money}
        sum={sum}
        onOpen={(item) => onPick(by, item.name)}
      />
      {sorted.length > SHOW && (
        <button type="button" className="mt-2 text-sm underline" onClick={() => setAll(!all)}>
          {all ? `只看前 ${SHOW} 项` : `看全部 ${sorted.length} 项`}
        </button>
      )}
    </section>
  );
}
