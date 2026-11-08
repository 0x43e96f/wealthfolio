import type { SpendingRecord } from "./client";
import { tagsOf } from "./spending-ledger";
import { median } from "./spending-trend";

// One month set against its usual level: the median of the twelve months before it,
// in total and category by category, with its biggest purchases and the trips in it.
// It answers "why was this month high (or low)".

const BASE_MONTHS = 12;
const TOP_ROWS = 5;

const monthsBefore = (key: string, count: number) => {
  const [year, month] = key.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(year, month - 2 - i, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
};

export function MonthExplained({
  monthKey,
  rows,
  partOf,
  money,
  running,
}: {
  monthKey: string;
  rows: SpendingRecord[]; // every month, already narrowed by the page's filters
  partOf: (row: SpendingRecord) => string; // what to split by (category, or merchant)
  money: (usd: number) => string;
  running: boolean;
}) {
  const before = monthsBefore(monthKey, BASE_MONTHS);
  const mine = rows.filter((row) => row.day.startsWith(monthKey));
  const total = mine.reduce((sum, row) => sum + Number(row.usd), 0);

  // Each earlier month's total and each part's amount in it (0 when nothing was spent).
  const monthTotals = new Map(before.map((key) => [key, 0]));
  const partMonths = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const key = row.day.slice(0, 7);
    if (!monthTotals.has(key)) continue;
    monthTotals.set(key, (monthTotals.get(key) ?? 0) + Number(row.usd));
    const part = partMonths.get(partOf(row)) ?? new Map<string, number>();
    part.set(key, (part.get(key) ?? 0) + Number(row.usd));
    partMonths.set(partOf(row), part);
  }
  const usual = median([...monthTotals.values()]);
  const now = new Map<string, number>();
  for (const row of mine) now.set(partOf(row), (now.get(partOf(row)) ?? 0) + Number(row.usd));
  const parts = [...new Set([...now.keys(), ...partMonths.keys()])]
    .map((name) => {
      const usualPart = median(before.map((key) => partMonths.get(name)?.get(key) ?? 0));
      const usd = now.get(name) ?? 0;
      return { name, usd, usual: usualPart, diff: usd - usualPart };
    })
    .filter((part) => Math.abs(part.diff) >= 1);
  const more = parts.filter((part) => part.diff > 0).sort((a, b) => b.diff - a.diff);
  const less = parts.filter((part) => part.diff < 0).sort((a, b) => a.diff - b.diff);
  const biggest = [...mine].sort((a, b) => Number(b.usd) - Number(a.usd)).slice(0, TOP_ROWS);
  const trips = new Map<string, number>();
  for (const row of mine)
    for (const tag of tagsOf(row))
      if (tag.kind === "旅行") trips.set(tag.value, (trips.get(tag.value) ?? 0) + Number(row.usd));

  const diff = total - usual;
  const line = (name: string, usd: number, base: number, change: number) => (
    <li key={name} className="flex items-baseline gap-2">
      <span className="min-w-0 truncate">{name}</span>
      <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
        {money(usd)}，平常 {money(base)}
      </span>
      <span
        className={`w-24 shrink-0 text-right tabular-nums ${change > 0 ? "text-destructive" : "text-success"}`}
      >
        {change > 0 ? "多" : "少"} {money(Math.abs(change))}
      </span>
    </li>
  );

  return (
    <section aria-label="这个月和平常比" className="border-border space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-medium">
          {monthKey} 和前 {BASE_MONTHS} 个月比
        </h3>
        <p className="mt-1 text-sm tabular-nums">
          这个月 {money(total)}，前 {BASE_MONTHS} 个月每月中位数 {money(usual)}
          {"　"}
          <span className={diff > 0 ? "text-destructive" : "text-success"}>
            {diff >= 0 ? "多" : "少"} {money(Math.abs(diff))}
          </span>
          {running && <span className="text-muted-foreground">（这个月还没过完）</span>}
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h4 className="mb-1 text-sm">比平常多花在</h4>
          {more.length ? (
            <ul className="space-y-1 text-sm">
              {more.slice(0, 6).map((part) => line(part.name, part.usd, part.usual, part.diff))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">没有哪一类比平常多。</p>
          )}
          {less.length > 0 && (
            <>
              <h4 className="mb-1 mt-3 text-sm">比平常少花在</h4>
              <ul className="space-y-1 text-sm">
                {less.slice(0, 3).map((part) => line(part.name, part.usd, part.usual, part.diff))}
              </ul>
            </>
          )}
        </div>
        <div>
          <h4 className="mb-1 text-sm">这个月最大的 {TOP_ROWS} 笔</h4>
          <ul className="space-y-1 text-sm">
            {biggest.map((row) => (
              <li key={row.id} className="flex items-baseline gap-2">
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {row.day.slice(5)}
                </span>
                <span className="min-w-0 truncate">{row.label ?? row.description}</span>
                <span className="ml-auto shrink-0 tabular-nums">{money(Number(row.usd))}</span>
              </li>
            ))}
          </ul>
          {trips.size > 0 && (
            <p className="text-muted-foreground mt-3 text-sm tabular-nums">
              这个月的旅行：
              {[...trips.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, usd]) => `${name} ${money(usd)}`)
                .join("，")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
