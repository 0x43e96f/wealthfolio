import { useMemo, useState } from "react";
import type { SpendingRecord } from "./client";

// Every row the filters leave, read like a ledger: newest month first, each month with
// its own subtotal, each row saying when, where, what for, how much and paid with what.

const PAGE = 200;

export interface Tag {
  kind: string;
  value: string;
}
export const tagsOf = (row: SpendingRecord): Tag[] => row.tags ?? [];
export const tagText = (tag: Tag) => (tag.value ? `${tag.kind}：${tag.value}` : tag.kind);

export function Ledger({
  rows,
  groupOf,
  money,
  onPickTag,
  onRecategorize,
  onTag,
}: {
  rows: SpendingRecord[];
  groupOf: (category: string) => string;
  money: (value: string) => string;
  onPickTag: (tag: Tag) => void;
  onRecategorize: (row: SpendingRecord) => void;
  onTag: (row: SpendingRecord) => void;
}) {
  const [query, setQuery] = useState("");
  const [byAmount, setByAmount] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const found = rows.filter(
      (row) =>
        !needle ||
        [
          row.label ?? row.description,
          row.description,
          row.category,
          groupOf(row.category),
          row.card,
          row.day,
          ...tagsOf(row).map(tagText),
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle),
    );
    return byAmount ? [...found].sort((a, b) => Number(b.usd) - Number(a.usd)) : found;
  }, [rows, query, byAmount, groupOf]);

  // By date the rows fall under month headings; by amount they are one list.
  const months = useMemo(() => {
    const totals = new Map<string, { usd: number; count: number }>();
    for (const row of list) {
      const month = row.day.slice(0, 7);
      const found = totals.get(month) ?? { usd: 0, count: 0 };
      totals.set(month, { usd: found.usd + Number(row.usd), count: found.count + 1 });
    }
    return totals;
  }, [list]);

  const page = list.slice(0, limit);
  const sortButton = (label: string, on: boolean) => (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => setByAmount(label === "按金额")}
      className={`focus-visible:ring-ring rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-2 ${
        on ? "bg-muted font-medium" : "text-muted-foreground"
      }`}
    >
      {label}
    </button>
  );

  return (
    <section aria-label="每一笔">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">每一笔（{list.length} 笔）</h3>
        <div className="flex text-xs">
          {sortButton("按日期", !byAmount)}
          {sortButton("按金额", byAmount)}
        </div>
        <input
          aria-label="搜索明细"
          placeholder="搜索商户、描述、分类、标签或卡"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(PAGE);
          }}
          className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm sm:ml-auto sm:w-64"
        />
      </div>

      {list.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          没有符合筛选的消费。换个年份，或把类别、标签清空再看。
        </p>
      ) : (
        <ol className="divide-border divide-y text-sm">
          {page.map((row, index) => {
            const month = row.day.slice(0, 7);
            const heading = !byAmount && (index === 0 || page[index - 1].day.slice(0, 7) !== month);
            const title = row.label ?? row.description;
            const foreign = row.orig_currency && row.orig_currency !== "USD";
            return (
              <li key={row.id}>
                {heading && (
                  <div className="bg-muted/50 text-muted-foreground flex items-center justify-between px-2 py-1 text-xs">
                    <span>{month}</span>
                    <span className="tabular-nums">
                      {money(String(months.get(month)?.usd ?? 0))}
                      {"\u3000"}
                      {months.get(month)?.count} 笔
                    </span>
                  </div>
                )}
                <div className="px-2 py-2">
                  <div className="flex items-start gap-3">
                    <span className="text-muted-foreground w-20 shrink-0 tabular-nums">
                      {row.day}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-medium">{title}</p>
                      {row.description !== title && (
                        <p className="text-muted-foreground break-words text-xs">
                          {row.description}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-medium tabular-nums">{money(row.usd)}</p>
                      {foreign && (
                        <p className="text-muted-foreground text-xs tabular-nums">
                          {row.orig_amount} {row.orig_currency}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-0 text-xs sm:pl-[5.75rem]">
                    <span>
                      {groupOf(row.category) === row.category
                        ? row.category
                        : `${groupOf(row.category)} / ${row.category}`}
                    </span>
                    {row.card && <span>付款：{row.card}</span>}
                    {tagsOf(row).map((tag) => (
                      <button
                        key={tagText(tag)}
                        type="button"
                        onClick={() => onPickTag(tag)}
                        className="bg-muted text-foreground focus-visible:ring-ring rounded-full px-2 py-0.5 focus-visible:outline-none focus-visible:ring-2"
                      >
                        {tagText(tag)}
                      </button>
                    ))}
                    <span className="ml-auto flex gap-3">
                      <button
                        type="button"
                        className="underline"
                        onClick={() => onRecategorize(row)}
                      >
                        改分类
                      </button>
                      <button type="button" className="underline" onClick={() => onTag(row)}>
                        标签
                      </button>
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {list.length > limit && (
        <div className="mt-3 text-center">
          <button
            type="button"
            className="text-sm underline"
            onClick={() => setLimit(limit + PAGE)}
          >
            再显示 {Math.min(PAGE, list.length - limit)} 笔（还有 {list.length - limit} 笔）
          </button>
        </div>
      )}
    </section>
  );
}
