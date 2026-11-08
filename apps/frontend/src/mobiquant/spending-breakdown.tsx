import { useEffect, useState } from "react";
import type { SpendTrip, SpendingRecord } from "./client";
import { tagsOf } from "./spending-ledger";
import { cardName, type Place } from "./spending-place";
import { SEGMENTS, segment, SplitList, type SplitItem } from "./spending-split";

// The one list that splits what the page shows. Its level follows the filters (groups
// at first, the categories of the chosen groups, the merchants of one category, the
// trips once trips are ticked) and the owner can switch it: 大类, 类别, 商户, or any tag
// kind with values. Trips also carry their days and cost per day. Picking a line
// narrows the page to it.

const SHOW = 12;
const GAP = "　"; // the site's separator between items on one line
type Order = "total" | "change" | "day" | "date";

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000) + 1;

export function Breakdown({
  rows,
  beforeRows,
  beforeName,
  groupOf,
  trips,
  tagKinds,
  placeOf,
  preferred,
  resetKey,
  money,
  onPick,
}: {
  rows: SpendingRecord[];
  beforeRows: SpendingRecord[];
  beforeName: string; // "" when there is no period before to set against
  groupOf: (category: string) => string;
  trips: SpendTrip[];
  tagKinds: string[];
  placeOf: (row: SpendingRecord) => Place;
  preferred: string; // the level the filters suggest
  resetKey: string; // changes with the filters; the owner's own choice of level then lapses
  money: (usd: number) => string;
  onPick: (level: string, name: string) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [order, setOrder] = useState<Order>("total");
  const [all, setAll] = useState(false);
  useEffect(() => {
    setChosen(null);
    setAll(false);
  }, [resetKey]);

  // Only tag kinds whose rows name something (旅行: a trip) can split the total.
  const kinds = tagKinds.filter((kind) =>
    rows.some((row) => tagsOf(row).some((t) => t.kind === kind && t.value)),
  );
  const levels = ["大类", "类别", "商户", "卡", "国家", "城市", ...kinds];
  const by =
    chosen && levels.includes(chosen) ? chosen : levels.includes(preferred) ? preferred : "大类";
  const isTrip = by === "旅行";
  const namesOf = (row: SpendingRecord): string[] =>
    by === "大类"
      ? [groupOf(row.category)]
      : by === "类别"
        ? [row.category]
        : by === "商户"
          ? [row.description]
          : by === "卡"
            ? [cardName(row)]
            : by === "国家"
              ? [placeOf(row).country]
              : by === "城市"
                ? [placeOf(row).city]
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
  // A part spent before and not now is a change worth seeing (not for trips: each is once).
  if (!isTrip)
    for (const name of was.keys()) if (!found.has(name)) found.set(name, { usd: 0, count: 0 });
  const sum = rows.reduce((total, row) => total + Number(row.usd), 0);

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
  const compare = Boolean(beforeName) && !isTrip;
  const orders: [Order, string][] = [
    ["total", "按金额"],
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
          : b.usd - a.usd || b.was - a.was,
  );
  const shown: SplitItem[] = all ? sorted : sorted.slice(0, SHOW);
  const toggle = segment;

  return (
    <section aria-label="拆分" className="max-w-3xl">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-sm font-medium">按{by}</h3>
        <span className={SEGMENTS} role="group" aria-label="按什么拆分">
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
        <span className={`${SEGMENTS} sm:ml-auto`} role="group" aria-label="排序">
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
      {compare && <p className="text-muted-foreground mb-2 text-xs">涨跌和 {beforeName} 比</p>}
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
