import { useEffect, useMemo, useState } from "react";
import type { SpendingRecord } from "./client";

// Every row the filters leave, read like a ledger. By month (newest first, each month
// with its subtotal) or grouped by what the owner is looking at: each trip, each group,
// category or merchant as a heading with its total, folded until opened. Each row says
// when, where, what for, how much and paid with what.

const PAGE = 200; // rows at a time when listed by month
const GROUP_PAGE = 100; // rows shown inside one opened group
const MONTH = "月份";

export interface Tag {
  kind: string;
  value: string;
}
export const tagsOf = (row: SpendingRecord): Tag[] => row.tags ?? [];
export const tagText = (tag: Tag) => (tag.value ? `${tag.kind}：${tag.value}` : tag.kind);

const sumOf = (rows: SpendingRecord[]) => rows.reduce((total, row) => total + Number(row.usd), 0);

export function Ledger({
  rows,
  groupOf,
  groupings,
  preferred,
  resetKey,
  noteOf,
  money,
  onOpenGroup,
  onPickTag,
  onRecategorize,
  onTag,
}: {
  rows: SpendingRecord[];
  groupOf: (category: string) => string;
  groupings: string[]; // 大类, 类别, 商户 and tag kinds; 月份 is always offered first
  preferred: string; // the grouping the filters suggest (旅行 once trips are ticked)
  resetKey: string; // changes with the filters; the owner's own choice then lapses
  noteOf: (grouping: string, name: string) => string; // a trip's dates, say
  money: (value: string) => string;
  onOpenGroup: (grouping: string, name: string) => void;
  onPickTag: (tag: Tag) => void;
  onRecategorize: (row: SpendingRecord) => void;
  onTag: (row: SpendingRecord) => void;
}) {
  const [query, setQuery] = useState("");
  const [byAmount, setByAmount] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [chosen, setChosen] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    setChosen(null);
    setOpen(new Set());
    setLimit(PAGE);
  }, [resetKey]);
  const options = [MONTH, ...groupings];
  const grouping =
    chosen && options.includes(chosen) ? chosen : options.includes(preferred) ? preferred : MONTH;

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

  // The groups: a row lands under each name it has at this level (a row with no value of
  // a tag kind under 没有).
  const groups = useMemo(() => {
    if (grouping === MONTH) return [];
    const namesOf = (row: SpendingRecord): string[] => {
      if (grouping === "大类") return [groupOf(row.category)];
      if (grouping === "类别") return [row.category];
      if (grouping === "商户") return [row.description];
      const values = tagsOf(row)
        .filter((t) => t.kind === grouping && t.value)
        .map((t) => t.value);
      return values.length ? values : [`没有${grouping}`];
    };
    const found = new Map<string, SpendingRecord[]>();
    for (const row of list)
      for (const name of namesOf(row)) {
        const bucket = found.get(name) ?? [];
        bucket.push(row); // a local list being built, not shared state
        found.set(name, bucket);
      }
    const byTime = !["大类", "类别", "商户"].includes(grouping);
    return [...found.entries()]
      .map(([name, members]) => ({
        name,
        rows: members,
        usd: sumOf(members),
        latest: members.reduce((last, row) => (row.day > last ? row.day : last), ""),
      }))
      .sort((a, b) =>
        // A tag's groups (trips) newest first; the others by what they hold.
        byTime ? b.latest.localeCompare(a.latest) : b.usd - a.usd,
      );
  }, [list, grouping, groupOf]);

  const months = useMemo(() => {
    const totals = new Map<string, { usd: number; count: number }>();
    for (const row of list) {
      const month = row.day.slice(0, 7);
      const found = totals.get(month) ?? { usd: 0, count: 0 };
      totals.set(month, { usd: found.usd + Number(row.usd), count: found.count + 1 });
    }
    return totals;
  }, [list]);

  const toggle = (on: boolean) =>
    `focus-visible:ring-ring rounded px-2 py-1 focus-visible:outline-none focus-visible:ring-2 ${
      on ? "bg-muted font-medium" : "text-muted-foreground"
    }`;
  const flip = (name: string) => {
    const next = new Set(open);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setOpen(next);
  };
  const row = (item: SpendingRecord) => (
    <Row
      key={item.id}
      row={item}
      groupOf={groupOf}
      money={money}
      onPickTag={onPickTag}
      onRecategorize={onRecategorize}
      onTag={onTag}
    />
  );

  return (
    <section aria-label="消费明细">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">消费明细（{list.length} 笔）</h3>
        <div className="flex flex-wrap text-xs" role="group" aria-label="明细分组">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={grouping === option}
              onClick={() => {
                setChosen(option);
                setOpen(new Set());
              }}
              className={toggle(grouping === option)}
            >
              按{option}
            </button>
          ))}
        </div>
        <div className="flex text-xs" role="group" aria-label="明细排序">
          <button
            type="button"
            aria-pressed={!byAmount}
            onClick={() => setByAmount(false)}
            className={toggle(!byAmount)}
          >
            新的在前
          </button>
          <button
            type="button"
            aria-pressed={byAmount}
            onClick={() => setByAmount(true)}
            className={toggle(byAmount)}
          >
            大的在前
          </button>
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
      ) : grouping === MONTH ? (
        <>
          <ol className="divide-border divide-y text-sm">
            {list.slice(0, limit).map((item, index, page) => {
              const month = item.day.slice(0, 7);
              const heading =
                !byAmount && (index === 0 || page[index - 1].day.slice(0, 7) !== month);
              return (
                <li key={item.id}>
                  {heading && (
                    <div className="bg-muted/50 text-muted-foreground flex items-center justify-between px-2 py-1 text-xs">
                      <span>{month}</span>
                      <span className="tabular-nums">
                        {money(String(months.get(month)?.usd ?? 0))}
                        {"　"}
                        {months.get(month)?.count} 笔
                      </span>
                    </div>
                  )}
                  <ol>{row(item)}</ol>
                </li>
              );
            })}
          </ol>
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
        </>
      ) : (
        <ol className="space-y-1 text-sm">
          {groups.map((group) => {
            const opened = groups.length === 1 || open.has(group.name);
            const note = noteOf(grouping, group.name);
            return (
              <li key={group.name} className="border-border rounded-md border">
                <div className="flex items-center gap-2 px-2 py-2">
                  <button
                    type="button"
                    aria-expanded={opened}
                    onClick={() => flip(group.name)}
                    className="focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2"
                  >
                    <span aria-hidden className="text-muted-foreground w-3 shrink-0 text-xs">
                      {opened ? "▾" : "▸"}
                    </span>
                    <span className="min-w-0 truncate font-medium">{group.name}</span>
                    {note && (
                      <span className="text-muted-foreground hidden shrink-0 text-xs tabular-nums sm:inline">
                        {note}
                      </span>
                    )}
                    <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                      {group.rows.length} 笔
                    </span>
                    <span className="w-24 shrink-0 text-right font-medium tabular-nums">
                      {money(String(group.usd))}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground shrink-0 text-xs underline"
                    onClick={() => onOpenGroup(grouping, group.name)}
                  >
                    只看这组
                  </button>
                </div>
                {opened && (
                  <div className="border-border border-t">
                    <ol className="divide-border divide-y">
                      {group.rows.slice(0, GROUP_PAGE).map(row)}
                    </ol>
                    {group.rows.length > GROUP_PAGE && (
                      <button
                        type="button"
                        className="text-muted-foreground w-full py-2 text-center text-xs underline"
                        onClick={() => onOpenGroup(grouping, group.name)}
                      >
                        这组还有 {group.rows.length - GROUP_PAGE} 笔，只看这组就能全部看到
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Row({
  row,
  groupOf,
  money,
  onPickTag,
  onRecategorize,
  onTag,
}: {
  row: SpendingRecord;
  groupOf: (category: string) => string;
  money: (value: string) => string;
  onPickTag: (tag: Tag) => void;
  onRecategorize: (row: SpendingRecord) => void;
  onTag: (row: SpendingRecord) => void;
}) {
  const title = row.label ?? row.description;
  const foreign = row.orig_currency && row.orig_currency !== "USD";
  return (
    <li className="px-2 py-2">
      <div className="flex items-start gap-3">
        <span className="text-muted-foreground w-24 shrink-0 whitespace-nowrap tabular-nums">
          {row.day}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium">{title}</p>
          {row.description !== title && (
            <p className="text-muted-foreground break-words text-xs">{row.description}</p>
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
      <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-0 text-xs sm:pl-[6.75rem]">
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
          <button type="button" className="underline" onClick={() => onRecategorize(row)}>
            改分类
          </button>
          <button type="button" className="underline" onClick={() => onTag(row)}>
            标签
          </button>
        </span>
      </div>
    </li>
  );
}
