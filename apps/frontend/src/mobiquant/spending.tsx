import { useEffect, useMemo, useState } from "react";
import { Button } from "@wealthfolio/ui/components/ui/button";
import {
  deleteTrip,
  importCardCsv,
  markTag,
  markTrip,
  saveMerchantCategory,
  saveTrip,
  type Spending,
  type SpendingRecord,
} from "./client";
import { Ledger, tagsOf, tagText, type Tag } from "./spending-ledger";
import { CheckMenu, type MenuNode } from "./spending-menu";

// The 消费 tab. Four drop-downs choose what is counted: a year, a month, any number of
// categories and any number of tags (a trip, a means of transport, 订阅 …). Everything
// below adds up only what they leave: the total, how it splits by the chosen tags and by
// category, the bars over time, and every row of it.

interface View {
  year: string; // "" = every year
  month: string; // "" = the whole year
  categories: string[]; // fine categories; empty = all
  tags: string[]; // tag keys (see keyOf); empty = no tag filter; a row needs any one
  merchant: string;
}
const START: View = { year: "", month: "", categories: [], tags: [], merchant: "" };
const EMPTY_TRIP = { id: null as string | null, name: "", start_day: "", end_day: "", note: "" };
const SPLIT_ROWS = 40;

const keyOf = (tag: Tag) => `${tag.kind}\u0000${tag.value}`;
const tagFromKey = (key: string): Tag => {
  const [kind, value = ""] = key.split("\u0000");
  return { kind, value };
};
const total = (list: SpendingRecord[]) => list.reduce((sum, row) => sum + Number(row.usd), 0);
const addTo = (map: Map<string, number>, key: string, usd: number) =>
  map.set(key, (map.get(key) ?? 0) + usd);

export function SpendingTab({
  spending,
  money,
  refresh,
  fail,
}: {
  spending: Spending;
  money: (value: string | null | undefined) => string;
  refresh: () => Promise<void>;
  fail: (message: string) => void;
}) {
  const [view, setView] = useState<View>(START);
  const [note, setNote] = useState("");
  const [managing, setManaging] = useState(false);
  const [tripForm, setTripForm] = useState(EMPTY_TRIP);

  // Every filter change is a step of the browser's history: back undoes it.
  const go = (patch: Partial<View>) => {
    const next = { ...view, ...patch };
    window.history.pushState({ ...(window.history.state ?? {}), mqSpend: next }, "");
    setView(next);
  };
  useEffect(() => {
    const back = (event: PopStateEvent) => {
      const state = event.state as { mqSpend?: View } | null;
      setView(state?.mqSpend ?? START);
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);

  const groupOf = (category: string) => spending.groups?.of[category] ?? category;
  const all = useMemo(() => spending.records.filter((row) => row.counted), [spending.records]);
  const years = [...new Set(all.map((row) => row.day.slice(0, 4)))].sort().reverse();
  const prefix = view.year ? view.year + (view.month ? "-" + view.month : "") : "";
  const before = (() => {
    if (!view.year) return "";
    if (!view.month) return String(Number(view.year) - 1);
    const last = Number(view.month) - 1;
    return last ? `${view.year}-${String(last).padStart(2, "0")}` : `${Number(view.year) - 1}-12`;
  })();
  const periodName = !view.year
    ? "全部年份"
    : view.month
      ? `${view.year} 年 ${Number(view.month)} 月`
      : `${view.year} 年`;

  const chosenCats = new Set(view.categories);
  const chosenTags = view.tags.map(tagFromKey);
  const catOk = (row: SpendingRecord) => chosenCats.size === 0 || chosenCats.has(row.category);
  const tagOk = (row: SpendingRecord) =>
    chosenTags.length === 0 ||
    tagsOf(row).some((t) => chosenTags.some((c) => c.kind === t.kind && c.value === t.value));
  const merchantOk = (row: SpendingRecord) => !view.merchant || row.description === view.merchant;
  const inPeriod = (when: string) => all.filter((row) => !when || row.day.startsWith(when));

  const period = inPeriod(prefix);
  const shown = period.filter((row) => catOk(row) && tagOk(row) && merchantOk(row));
  const sum = total(shown);
  const previous = before
    ? total(inPeriod(before).filter((row) => catOk(row) && tagOk(row) && merchantOk(row)))
    : 0;

  // The category menu: groups over their categories, with the money each holds under the
  // other filters. Every category ever used is listed, so a choice never disappears.
  const categoryNodes = useMemo<MenuNode[]>(() => {
    const usd = new Map<string, number>();
    for (const row of period)
      if (tagOk(row) && merchantOk(row)) addTo(usd, row.category, Number(row.usd));
    const used = [...new Set(all.map((row) => row.category))];
    const order = spending.groups?.order ?? [];
    const groupNames = [...new Set([...order, ...used.map(groupOf)])].filter((group) =>
      used.some((category) => groupOf(category) === group),
    );
    return groupNames.map((group) => {
      const leaves = used
        .filter((category) => groupOf(category) === group)
        .map((category) => ({ key: category, label: category, usd: usd.get(category) ?? 0 }))
        .sort((a, b) => b.usd - a.usd || a.label.localeCompare(b.label));
      return { key: group, label: group, usd: leaves.reduce((s, l) => s + l.usd, 0), leaves };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, prefix, view.tags, view.merchant, spending.groups]);

  // The tag menu: each kind over its values. A kind's own total counts a row once even
  // when it carries two values of it (two of the owner's own tags).
  const tagNodes = useMemo<MenuNode[]>(() => {
    const leafUsd = new Map<string, number>();
    const kindUsd = new Map<string, number>();
    for (const row of period) {
      if (!catOk(row) || !merchantOk(row)) continue;
      const kinds = new Set<string>();
      for (const tag of tagsOf(row)) {
        addTo(leafUsd, keyOf(tag), Number(row.usd));
        kinds.add(tag.kind);
      }
      for (const kind of kinds) addTo(kindUsd, kind, Number(row.usd));
    }
    const values = new Map<string, Set<string>>();
    for (const row of all)
      for (const tag of tagsOf(row))
        values.set(tag.kind, (values.get(tag.kind) ?? new Set()).add(tag.value));
    const kinds = [
      ...new Set([...(spending.tag_kinds ?? []).map((item) => item.kind), ...values.keys()]),
    ].filter((kind) => values.has(kind));
    return kinds.map((kind) => ({
      key: kind,
      label: kind,
      usd: kindUsd.get(kind) ?? 0,
      leaves: [...(values.get(kind) ?? [])]
        .map((value) => {
          const key = keyOf({ kind, value });
          return { key, label: value || kind, usd: leafUsd.get(key) ?? 0 };
        })
        .sort((a, b) => b.usd - a.usd || a.label.localeCompare(b.label)),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, prefix, view.categories, view.merchant, spending.tag_kinds]);

  // How the chosen tags split the total. A row with two chosen tags is in both lines.
  const byTag = chosenTags
    .map((tag) => {
      const mine = shown.filter((row) =>
        tagsOf(row).some((t) => t.kind === tag.kind && t.value === tag.value),
      );
      return { key: keyOf(tag), name: tagText(tag), usd: total(mine), count: mine.length };
    })
    .sort((a, b) => b.usd - a.usd);

  // How the total splits one level below what is chosen: groups when no category is,
  // merchants when one is, categories otherwise.
  const level = view.merchant
    ? ""
    : view.categories.length === 0
      ? "大类"
      : view.categories.length === 1
        ? "商户"
        : "类别";
  const splitKey = (row: SpendingRecord) =>
    level === "大类" ? groupOf(row.category) : level === "商户" ? row.description : row.category;
  const split = (() => {
    const found = new Map<string, { usd: number; count: number }>();
    for (const row of shown) {
      const item = found.get(splitKey(row)) ?? { usd: 0, count: 0 };
      found.set(splitKey(row), { usd: item.usd + Number(row.usd), count: item.count + 1 });
    }
    return [...found.entries()]
      .map(([name, item]) => ({ name, ...item }))
      .sort((a, b) => b.usd - a.usd);
  })();
  const openSplit = (name: string) => {
    if (level === "大类")
      go({
        categories: categoryNodes.find((node) => node.key === name)?.leaves.map((l) => l.key) ?? [],
      });
    else if (level === "类别") go({ categories: [name] });
    else go({ merchant: name });
  };

  // The bars: the months of the chosen year, or every year.
  const bars = (() => {
    const rows = (view.year ? inPeriod(view.year) : all).filter(
      (row) => catOk(row) && tagOk(row) && merchantOk(row),
    );
    const slot = view.year ? 7 : 4;
    const found = new Map<string, number>();
    for (const row of rows) addTo(found, row.day.slice(0, slot), Number(row.usd));
    const keys = view.year
      ? Array.from({ length: 12 }, (_, i) => `${view.year}-${String(i + 1).padStart(2, "0")}`)
      : [...years].reverse();
    const top = Math.max(1, ...keys.map((key) => found.get(key) ?? 0));
    return keys.map((key) => ({
      key,
      usd: found.get(key) ?? 0,
      height: ((found.get(key) ?? 0) / top) * 100,
    }));
  })();

  const trips = spending.trips ?? [];
  const filtered = Boolean(view.categories.length || view.tags.length || view.merchant);

  const attempt = async (job: () => Promise<void>, failure: string) => {
    try {
      await job();
      await refresh();
    } catch (error) {
      fail(error instanceof Error ? error.message : failure);
    }
  };
  const recategorize = (row: SpendingRecord) => {
    const choice = window.prompt(
      `把「${row.description}」今后都归到哪一类？\n${spending.categories.join("、")}`,
      row.category,
    );
    if (!choice || choice === row.category) return;
    void attempt(() => saveMerchantCategory(row.description, choice.trim()), "分类保存失败");
  };
  // One prompt for both kinds of hand-made tag.
  const tagRow = (row: SpendingRecord) => {
    const mine = tagsOf(row)
      .filter((t) => t.kind === "自定义")
      .map((t) => t.value);
    const answer = window.prompt(
      `给这笔打标签。\n` +
        `填「旅行:名称」= 归到那趟旅行（${trips.map((t) => t.name).join("、") || "还没有旅行"}）；「旅行:无」= 不属于任何旅行；「旅行:自动」= 按日期。\n` +
        `填其他名字 = 加上自己的标签；已有的同名标签（现有：${mine.join("、") || "无"}）再填一次 = 去掉。`,
      "",
    );
    const text = (answer ?? "").trim();
    if (!text) return;
    if (text.startsWith("旅行:") || text.startsWith("旅行：")) {
      const wanted = text.slice(3).trim();
      const found = trips.find((trip) => trip.name === wanted);
      const target = wanted === "无" ? "none" : wanted === "自动" ? "auto" : found?.id;
      if (!target) return fail("没有这个旅行");
      void attempt(() => markTrip(row.id, target), "旅行保存失败");
      return;
    }
    void attempt(() => markTag(row.id, text, !mine.includes(text)), "标签保存失败");
  };
  const pickTag = (tag: Tag) =>
    view.tags.includes(keyOf(tag)) ? undefined : go({ tags: [...view.tags, keyOf(tag)] });
  const saveTripForm = () =>
    attempt(async () => {
      const { id, ...body } = tripForm;
      await saveTrip(id, body);
      setTripForm(EMPTY_TRIP);
    }, "旅行保存失败");
  const removeTrip = (id: string, name: string) => {
    if (!window.confirm(`删除旅行「${name}」？\n只删标签，消费记录和分类不变。`)) return;
    void attempt(async () => {
      await deleteTrip(id);
      go({ tags: view.tags.filter((key) => key !== keyOf({ kind: "旅行", value: name })) });
    }, "删除失败");
  };
  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const done = await importCardCsv(await file.text());
      setNote(`已导入 ${done.rows} 行，其中新增 ${done.new} 行。`);
      await refresh();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "导入失败");
    }
  };

  if (all.length === 0)
    return (
      <p className="text-muted-foreground py-10 text-center">
        还没有消费记录。每月在 ether.fi 的交易记录页下载 CSV，点右上角导入。
      </p>
    );

  const select = "border-input bg-background h-9 rounded-md border px-2 text-sm";
  const moneyText = (usd: number) => money(String(usd));
  const share = (usd: number) => (sum > 0 ? `${Math.round((usd / sum) * 100)}%` : "");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2" aria-label="筛选">
        <select
          aria-label="消费年份"
          value={view.year}
          onChange={(event) => go({ year: event.target.value, month: "" })}
          className={select}
        >
          <option value="">全部年份</option>
          {years.map((item) => (
            <option key={item} value={item}>
              {item} 年
            </option>
          ))}
        </select>
        <select
          aria-label="消费月份"
          disabled={!view.year}
          value={view.month}
          onChange={(event) => go({ month: event.target.value })}
          className={select}
        >
          <option value="">全年</option>
          {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((item) => (
            <option key={item} value={item}>
              {Number(item)} 月
            </option>
          ))}
        </select>
        <CheckMenu
          name="类别"
          everything="全部类别"
          nodes={categoryNodes}
          selected={view.categories}
          onChange={(categories) => go({ categories, merchant: "" })}
          money={money}
        />
        <CheckMenu
          name="标签"
          everything="不限标签"
          nodes={tagNodes}
          selected={view.tags}
          onChange={(tags) => go({ tags })}
          money={money}
        />
        {view.merchant && (
          <span className="bg-muted inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm">
            商户：{view.merchant}
            <button type="button" aria-label="去掉商户筛选" onClick={() => go({ merchant: "" })}>
              ✕
            </button>
          </span>
        )}
        {filtered && (
          <button
            type="button"
            className="text-muted-foreground text-sm underline"
            onClick={() => go({ categories: [], tags: [], merchant: "" })}
          >
            清除类别和标签
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
        <div>
          <p className="text-muted-foreground text-sm">{periodName}消费</p>
          <p className="text-3xl font-semibold tabular-nums">{moneyText(sum)}</p>
        </div>
        <p className="text-muted-foreground text-sm tabular-nums">{shown.length} 笔</p>
        {before && (
          <p className="text-muted-foreground text-sm tabular-nums">
            {before}：{moneyText(previous)}
            {previous > 0 &&
              `（${sum >= previous ? "多" : "少"} ${moneyText(Math.abs(sum - previous))}）`}
          </p>
        )}
      </div>

      <div className="flex h-16 items-end gap-1" aria-label={view.year ? "按月金额" : "按年金额"}>
        {bars.map((bar) => (
          <button
            key={bar.key}
            type="button"
            title={`${bar.key}：${moneyText(bar.usd)}`}
            aria-label={`${bar.key} ${moneyText(bar.usd)}`}
            onClick={() =>
              view.year
                ? go({ month: bar.key.slice(5) === view.month ? "" : bar.key.slice(5) })
                : go({ year: bar.key, month: "" })
            }
            className={`focus-visible:ring-ring min-w-[6px] flex-1 rounded-t focus-visible:outline-none focus-visible:ring-2 ${
              bar.key === prefix ? "bg-primary" : "bg-primary/30"
            }`}
            style={{ height: `${Math.max(bar.height, 2)}%` }}
          />
        ))}
      </div>
      <div className="text-muted-foreground -mt-5 flex justify-between text-xs tabular-nums">
        <span>{bars[0]?.key}</span>
        <span>{bars[bars.length - 1]?.key}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {byTag.length > 0 && (
          <section aria-label="按标签">
            <h3 className="mb-2 text-sm font-medium">按标签</h3>
            <SplitList
              items={byTag.map((item) => ({ ...item, key: item.key }))}
              sum={sum}
              money={moneyText}
              share={share}
            />
            {byTag.length > 1 && (
              <p className="text-muted-foreground mt-1 text-xs">
                一笔带两个所选标签时两行都算，合计按一次算。
              </p>
            )}
          </section>
        )}
        {level && (
          <section aria-label={`按${level}`}>
            <h3 className="mb-2 text-sm font-medium">按{level}</h3>
            <SplitList
              items={split.slice(0, SPLIT_ROWS).map((item) => ({ ...item, key: item.name }))}
              sum={sum}
              money={moneyText}
              share={share}
              onOpen={openSplit}
            />
            {split.length > SPLIT_ROWS && (
              <p className="text-muted-foreground mt-1 text-xs">
                只列前 {SPLIT_ROWS} 项，其余在下面的明细里搜。
              </p>
            )}
          </section>
        )}
      </div>

      <Ledger
        rows={shown}
        groupOf={groupOf}
        money={(value) => money(value)}
        onPickTag={pickTag}
        onRecategorize={recategorize}
        onTag={tagRow}
      />

      <section className="text-muted-foreground space-y-3 text-xs">
        <button type="button" className="underline" onClick={() => setManaging(!managing)}>
          {managing ? "收起旅行管理" : "管理旅行"}
        </button>
        {managing && (
          <div className="border-border text-foreground space-y-3 rounded-lg border p-3 text-sm">
            <ul className="space-y-1">
              {trips.map((trip) => (
                <li key={trip.id} className="flex flex-wrap items-center gap-2">
                  <span>{trip.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {trip.start_day} ~ {trip.end_day}
                  </span>
                  <button
                    type="button"
                    className="underline"
                    onClick={() =>
                      setTripForm({
                        id: trip.id,
                        name: trip.name,
                        start_day: trip.start_day,
                        end_day: trip.end_day,
                        note: trip.note,
                      })
                    }
                  >
                    改
                  </button>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => removeTrip(trip.id, trip.name)}
                  >
                    删
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-2">
              <input
                aria-label="旅行名称"
                placeholder="旅行名称"
                maxLength={60}
                value={tripForm.name}
                onChange={(event) => setTripForm({ ...tripForm, name: event.target.value })}
                className={`${select} w-44`}
              />
              <input
                type="date"
                aria-label="旅行开始日"
                value={tripForm.start_day}
                onChange={(event) => setTripForm({ ...tripForm, start_day: event.target.value })}
                className={select}
              />
              <input
                type="date"
                aria-label="旅行结束日"
                value={tripForm.end_day}
                onChange={(event) => setTripForm({ ...tripForm, end_day: event.target.value })}
                className={select}
              />
              <input
                aria-label="旅行备注"
                placeholder="备注（可不填）"
                maxLength={200}
                value={tripForm.note}
                onChange={(event) => setTripForm({ ...tripForm, note: event.target.value })}
                className={`${select} w-56`}
              />
              <Button
                size="sm"
                disabled={!tripForm.name || !tripForm.start_day || !tripForm.end_day}
                onClick={() => void saveTripForm()}
              >
                {tripForm.id ? "保存修改" : "新增旅行"}
              </Button>
              {tripForm.id && (
                <Button size="sm" variant="outline" onClick={() => setTripForm(EMPTY_TRIP)}>
                  取消修改
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              起止日含首尾；几趟重叠时短的那趟优先。订阅、卡费用、转账、保险、房租等账单、网购、加密货币买的礼品卡不按日期自动算进旅行（租车算）；
              要算就在明细里点「标签」，填「旅行:名称」。
            </p>
          </div>
        )}
        <p>
          返现（已赚 / 已领）：{money(spending.cashback_earned_usd)} /{" "}
          {money(spending.cashback_claimed_usd)}
          {"\u3000"}
          <label className="cursor-pointer underline">
            导入 ether.fi 导出的 CSV
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="导入卡交易记录"
              className="hidden"
              onChange={(event) => void loadFile(event.target.files?.[0])}
            />
          </label>
        </p>
        {note && <p className="text-foreground text-sm">{note}</p>}
        <details>
          <summary className="cursor-pointer">充值核对（卡里充了多少，对照你记的出金）</summary>
          <table className="mt-2 w-full">
            <thead>
              <tr className="text-left">
                <th>月份</th>
                <th>卡</th>
                <th className="text-right">卡里的充值</th>
                <th className="text-right">已记的出金</th>
                <th className="text-right">差额</th>
              </tr>
            </thead>
            <tbody>
              {spending.topup_check.map((row) => (
                <tr key={row.source + row.month} className="border-border border-t">
                  <td>{row.month}</td>
                  <td>
                    {row.source === "solayer"
                      ? "Solayer"
                      : row.source === "plasma"
                        ? "Plasma"
                        : "ether.fi"}
                  </td>
                  <td className="text-right tabular-nums">{money(row.topup_usd)}</td>
                  <td className="text-right tabular-nums">{money(row.recorded_usd)}</td>
                  <td className="text-right tabular-nums">
                    {money(row.gap_usd)}
                    {Math.abs(Number(row.gap_usd)) > 5 ? "（对不上）" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1">
            差额大说明有充值没记进出金，或出金记在了别的名字下（只对照经由写
            etherfi、去向为刷卡消费的）。
          </p>
        </details>
      </section>
    </div>
  );
}

// One line per part of the total, with a bar for its share; a line opens when onOpen is set.
function SplitList({
  items,
  money,
  share,
  sum,
  onOpen,
}: {
  items: { key: string; name: string; usd: number; count: number }[];
  money: (usd: number) => string;
  share: (usd: number) => string;
  sum: number;
  onOpen?: (name: string) => void;
}) {
  if (items.length === 0)
    return <p className="text-muted-foreground py-3 text-sm">这个范围里没有消费。</p>;
  return (
    <ul className="space-y-1 text-sm">
      {items.map((item) => (
        <li key={item.key}>
          <div className="flex items-baseline gap-2">
            {onOpen ? (
              <button
                type="button"
                className="focus-visible:ring-ring min-w-0 truncate text-left underline focus-visible:outline-none focus-visible:ring-2"
                onClick={() => onOpen(item.name)}
              >
                {item.name}
              </button>
            ) : (
              <span className="min-w-0 truncate">{item.name}</span>
            )}
            <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
              {item.count} 笔{"\u3000"}
              {share(item.usd)}
            </span>
            <span className="w-24 shrink-0 text-right tabular-nums">{money(item.usd)}</span>
          </div>
          <div
            className="bg-primary/30 mt-0.5 h-1 rounded"
            style={{ width: `${sum > 0 ? Math.max(1, (item.usd / sum) * 100) : 0}%` }}
          />
        </li>
      ))}
    </ul>
  );
}
