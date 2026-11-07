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

// The 消费 tab. One path goes down the money (all → group → category → merchant → each
// row); tags are a second axis beside it (a trip, a means of transport, 订阅 …), chosen
// on the right and always counted inside whatever the path has narrowed to.

interface Tag {
  kind: string;
  value: string;
}
interface View {
  year: string | null; // null = the latest year with spending
  month: string | null; // null = the latest month, "" = the whole year
  group: string;
  category: string;
  merchant: string;
  tag: Tag | null; // value "" = any value of the kind
}
const START: View = { year: null, month: null, group: "", category: "", merchant: "", tag: null };
const EMPTY_TRIP = { id: null as string | null, name: "", start_day: "", end_day: "", note: "" };
const LIST_LIMIT = 400;

const sum = (list: { usd: string }[]) => list.reduce((total, row) => total + Number(row.usd), 0);
const tagsOf = (row: SpendingRecord): Tag[] => row.tags ?? [];
const tagText = (tag: Tag) => (tag.value ? `${tag.kind} · ${tag.value}` : tag.kind);
const hasTag = (row: SpendingRecord, tag: Tag) =>
  tagsOf(row).some((t) => t.kind === tag.kind && (!tag.value || t.value === tag.value));

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
  const [query, setQuery] = useState("");
  const [byAmount, setByAmount] = useState(false);
  const [managing, setManaging] = useState(false);
  const [tripForm, setTripForm] = useState(EMPTY_TRIP);

  // Every drill-down and tag choice is a step of the browser's history: back undoes it.
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
  const latest = all[0]?.day ?? "";
  const year = view.year ?? latest.slice(0, 4);
  // A month only means something inside a year.
  const month = year ? (view.month ?? latest.slice(5, 7)) : "";
  const prefix = year + (month ? "-" + month : "");
  const before = (() => {
    if (!year) return "";
    if (!month) return String(Number(year) - 1);
    const last = Number(month) - 1;
    return last ? `${year}-${String(last).padStart(2, "0")}` : `${Number(year) - 1}-12`;
  })();

  const inPeriod = (when: string) => all.filter((row) => !when || row.day.startsWith(when));
  const onPath = (row: SpendingRecord) =>
    (!view.group || groupOf(row.category) === view.group) &&
    (!view.category || row.category === view.category) &&
    (!view.merchant || row.description === view.merchant);
  const scoped = (rows: SpendingRecord[]) =>
    rows.filter((row) => onPath(row) && (!view.tag || hasTag(row, view.tag)));

  const period = inPeriod(prefix);
  const pathRows = period.filter(onPath); // what the tags are counted in
  const shown = scoped(period);
  const previous = scoped(inPeriod(before));
  const total = sum(shown);

  // The level below the path: groups, then categories, then merchants.
  const level = view.merchant ? "" : view.category ? "商户" : view.group ? "细分类" : "大类";
  const keyOf = (row: SpendingRecord) =>
    view.category ? row.description : view.group ? row.category : groupOf(row.category);
  const children = (() => {
    const mine = new Map<string, { usd: number; count: number }>();
    for (const row of shown) {
      const found = mine.get(keyOf(row)) ?? { usd: 0, count: 0 };
      mine.set(keyOf(row), { usd: found.usd + Number(row.usd), count: found.count + 1 });
    }
    const was = new Map<string, number>();
    for (const row of previous) was.set(keyOf(row), (was.get(keyOf(row)) ?? 0) + Number(row.usd));
    return [...mine.entries()]
      .sort((a, b) => b[1].usd - a[1].usd)
      .map(([name, found]) => ({ name, ...found, was: was.get(name) ?? 0 }));
  })();

  // Tags with the money they hold inside the path (not narrowed by the chosen tag).
  const tagTotals = (() => {
    const kinds = new Map<string, { usd: number; values: Map<string, number> }>();
    for (const row of pathRows)
      for (const tag of tagsOf(row)) {
        const found = kinds.get(tag.kind) ?? { usd: 0, values: new Map<string, number>() };
        found.usd += Number(row.usd);
        if (tag.value)
          found.values.set(tag.value, (found.values.get(tag.value) ?? 0) + Number(row.usd));
        kinds.set(tag.kind, found);
      }
    return kinds;
  })();

  // The bars: the months of the chosen year, or the years when all years are chosen.
  const bars = (() => {
    const rows = scoped(year ? inPeriod(year) : all);
    const slot = year ? 7 : 4;
    const found = new Map<string, number>();
    for (const row of rows)
      found.set(row.day.slice(0, slot), (found.get(row.day.slice(0, slot)) ?? 0) + Number(row.usd));
    const keys = year
      ? Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`)
      : [...found.keys()].sort();
    const top = Math.max(1, ...keys.map((key) => found.get(key) ?? 0));
    return keys.map((key) => ({
      key,
      usd: found.get(key) ?? 0,
      height: ((found.get(key) ?? 0) / top) * 100,
    }));
  })();

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = shown.filter(
      (row) =>
        !needle ||
        [row.label ?? row.description, row.category, row.card, row.day, ...tagsOf(row).map(tagText)]
          .join(" ")
          .toLowerCase()
          .includes(needle),
    );
    return byAmount ? [...list].sort((a, b) => Number(b.usd) - Number(a.usd)) : list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.length, query, byAmount, view, spending.records]);

  const trips = spending.trips ?? [];
  const clear = () => go({ group: "", category: "", merchant: "", tag: null });
  const filtered = Boolean(view.group || view.category || view.merchant || view.tag);

  const attempt = async (job: () => Promise<void>, failure: string) => {
    try {
      await job();
      await refresh();
    } catch (error) {
      fail(error instanceof Error ? error.message : failure);
    }
  };
  const retag = (merchant: string, current: string) => {
    const choice = window.prompt(
      `把「${merchant}」今后都归到哪一类？\n${spending.categories.join("、")}`,
      current,
    );
    if (!choice || choice === current) return;
    void attempt(() => saveMerchantCategory(merchant, choice.trim()), "分类保存失败");
  };
  // One prompt for both kinds of hand-made tag.
  const tagRow = (row: SpendingRecord) => {
    const mine = tagsOf(row)
      .filter((t) => t.kind === "自定义")
      .map((t) => t.value);
    const answer = window.prompt(
      `给这笔打标签。\n` +
        `· 填「旅行:名称」= 归到那趟旅行（${trips.map((t) => t.name).join("、") || "还没有旅行"}）；「旅行:无」= 不属于任何旅行；「旅行:自动」= 按日期。\n` +
        `· 填其他名字 = 加上自己的标签；已有的同名标签（现有：${mine.join("、") || "无"}）再填一次 = 去掉。`,
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
      if (view.tag?.kind === "旅行" && view.tag.value === name) go({ tag: null });
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

  const select = "border-input bg-background h-9 rounded-md border px-2";
  const chip = "bg-muted inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-xs";
  const picked = (kind: string, value: string) =>
    view.tag?.kind === kind && view.tag.value === value;
  const pickTag = (tag: Tag) => go({ tag: picked(tag.kind, tag.value) ? null : tag });
  const orderedKinds = (spending.tag_kinds ?? []).map((item) => item.kind);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {(
          [
            [
              year ? (month ? `${prefix} 消费` : `${year} 年消费`) : "全部年份消费",
              money(String(total)),
            ],
            [`对比 ${before || "—"}`, before ? money(String(sum(previous))) : "—"],
            ["笔数", String(shown.length)],
          ] as const
        ).map(([title, value]) => (
          <div key={title} className="mq-stat">
            <p className="text-muted-foreground text-xs">{title}</p>
            <p className="text-xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          aria-label="消费年份"
          value={year}
          onChange={(event) => go({ year: event.target.value })}
          className={select}
        >
          <option value="">全部年份</option>
          {[...new Set(all.map((row) => row.day.slice(0, 4)))].map((item) => (
            <option key={item} value={item}>
              {item} 年
            </option>
          ))}
        </select>
        <select
          aria-label="消费月份"
          disabled={!year}
          value={month}
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
        <div className="flex h-12 flex-1 items-end gap-1" aria-label="按月金额">
          {bars.map((bar) => (
            <button
              key={bar.key}
              type="button"
              title={`${bar.key} · ${money(String(bar.usd))}`}
              onClick={() =>
                year
                  ? go({ month: bar.key.slice(5) === month ? "" : bar.key.slice(5) })
                  : go({ year: bar.key, month: "" })
              }
              className={`min-w-[6px] flex-1 rounded-t ${bar.key === prefix ? "bg-primary" : "bg-primary/30"}`}
              style={{ height: `${Math.max(bar.height, 2)}%` }}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="当前筛选">
        <button className="underline" onClick={() => go({ group: "", category: "", merchant: "" })}>
          全部
        </button>
        {view.group && (
          <>
            ›{" "}
            <button className="underline" onClick={() => go({ category: "", merchant: "" })}>
              {view.group}
            </button>
          </>
        )}
        {view.category && (
          <>
            ›{" "}
            <button className="underline" onClick={() => go({ merchant: "" })}>
              {view.category}
            </button>
          </>
        )}
        {view.merchant && (
          <>
            › <span>{view.merchant}</span>
          </>
        )}
        {view.tag && (
          <span className={chip}>
            标签 {tagText(view.tag)}
            <button aria-label="去掉标签筛选" onClick={() => go({ tag: null })}>
              ✕
            </button>
          </span>
        )}
        {filtered && (
          <button className="text-muted-foreground ml-auto underline" onClick={clear}>
            清除全部
          </button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section>
          <h3 className="mb-3 text-sm font-medium">
            {level ? `${level}（点一行往下看）` : "这个商户的每一笔见下面的明细"}
          </h3>
          {level && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-left text-xs">
                  <th className="py-1">{level}</th>
                  <th className="text-right">金额</th>
                  <th className="text-right">占比</th>
                  <th className="text-right">{before || "上期"}</th>
                  <th className="text-right">变化</th>
                  <th className="text-right">笔数</th>
                </tr>
              </thead>
              <tbody>
                {children.slice(0, 60).map((child) => (
                  <tr key={child.name} className="border-border border-t">
                    <td className="py-1">
                      <button
                        className="text-left underline"
                        onClick={() =>
                          view.category
                            ? go({ merchant: child.name })
                            : view.group
                              ? go({ category: child.name })
                              : go({ group: child.name })
                        }
                      >
                        {child.name}
                      </button>
                      <div
                        className="bg-primary/30 mt-0.5 h-1 rounded"
                        style={{
                          width: `${total > 0 ? Math.max(2, (child.usd / total) * 100) : 0}%`,
                        }}
                      />
                    </td>
                    <td className="text-right tabular-nums">{money(String(child.usd))}</td>
                    <td className="text-right tabular-nums">
                      {total > 0 ? `${Math.round((child.usd / total) * 100)}%` : "—"}
                    </td>
                    <td className="text-right tabular-nums">
                      {before ? money(String(child.was)) : "—"}
                    </td>
                    <td className="text-right tabular-nums">
                      {before ? money(String(child.usd - child.was)) : "—"}
                    </td>
                    <td className="text-right tabular-nums">{child.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {level && children.length === 0 && (
            <p className="text-muted-foreground py-6 text-center text-sm">这个范围里没有消费。</p>
          )}
          {children.length > 60 && (
            <p className="text-muted-foreground mt-1 text-xs">只列前 60 项，其余在明细里搜。</p>
          )}
        </section>

        <section aria-label="标签">
          <h3 className="mb-3 text-sm font-medium">
            标签（金额 = 在上面这个范围里带这个标签的钱）
          </h3>
          <div className="max-h-96 space-y-3 overflow-y-auto text-sm">
            {orderedKinds.map((kind) => {
              const found = tagTotals.get(kind);
              const values = [...(found?.values ?? [])].sort((a, b) => b[1] - a[1]);
              const source = spending.tag_kinds?.find((item) => item.kind === kind)?.source;
              return (
                <div key={kind}>
                  <div className="flex items-center justify-between">
                    <button
                      disabled={!found}
                      className={`${picked(kind, "") ? "font-semibold underline" : ""} ${found ? "" : "text-muted-foreground"}`}
                      onClick={() => pickTag({ kind, value: "" })}
                    >
                      {kind}
                      {source === "trip" ? "（全部旅行）" : ""}
                    </button>
                    <span className="tabular-nums">{found ? money(String(found.usd)) : "—"}</span>
                  </div>
                  {values.map(([value, usd]) => (
                    <div key={value} className="ml-4 flex items-center justify-between">
                      <button
                        className={picked(kind, value) ? "font-semibold underline" : ""}
                        onClick={() => pickTag({ kind, value })}
                      >
                        {value}
                      </button>
                      <span className="tabular-nums">{money(String(usd))}</span>
                    </div>
                  ))}
                  {source === "trip" && (
                    <button
                      className="text-muted-foreground ml-4 text-xs underline"
                      onClick={() => setManaging(!managing)}
                    >
                      {managing ? "收起旅行管理" : "管理旅行"}
                    </button>
                  )}
                  {source === "manual" && !found && (
                    <p className="text-muted-foreground ml-4 text-xs">
                      在明细里点「标签」给单笔打。
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {managing && (
        <section className="border-border space-y-3 rounded-lg border p-3 text-sm">
          <h3 className="font-medium">管理旅行（旅行是日期区间，区间内的消费自动带这个标签）</h3>
          <ul className="space-y-1">
            {trips.map((trip) => (
              <li key={trip.id} className="flex flex-wrap items-center gap-2">
                <span>{trip.name}</span>
                <span className="text-muted-foreground">
                  {trip.start_day} ~ {trip.end_day}
                </span>
                <button
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
                <button className="underline" onClick={() => removeTrip(trip.id, trip.name)}>
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
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-medium">
            每一笔（分类不对点「改分类」，这个商户以后都按新的算）
          </h3>
          <input
            aria-label="搜索明细"
            placeholder="搜索商户、分类、标签或卡号"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={`${select} ml-auto w-64`}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="py-1">日期</th>
                <th>商户</th>
                <th className="text-right">
                  <button onClick={() => setByAmount(!byAmount)}>美元{byAmount ? " ↓" : ""}</button>
                </th>
                <th>原币种</th>
                <th>大类</th>
                <th>分类</th>
                <th>标签</th>
                <th>卡</th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, LIST_LIMIT).map((row) => (
                <tr key={row.id} className="border-border border-t">
                  <td className="whitespace-nowrap py-1">{row.day}</td>
                  <td>{row.label ?? row.description}</td>
                  <td className="text-right tabular-nums">{money(row.usd)}</td>
                  <td>
                    {row.orig_currency && row.orig_currency !== "USD"
                      ? `${row.orig_amount} ${row.orig_currency}`
                      : "—"}
                  </td>
                  <td>{groupOf(row.category)}</td>
                  <td>{row.category}</td>
                  <td>
                    {tagsOf(row).length
                      ? tagsOf(row).map((tag) => (
                          <button
                            key={tagText(tag)}
                            className={`${chip} mr-1`}
                            onClick={() => go({ tag })}
                          >
                            {tagText(tag)}
                          </button>
                        ))
                      : "—"}
                  </td>
                  <td>{row.card || "—"}</td>
                  <td>
                    <button
                      className="underline"
                      onClick={() => retag(row.description, row.category)}
                    >
                      改分类
                    </button>
                  </td>
                  <td>
                    <button className="underline" onClick={() => tagRow(row)}>
                      标签
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <p className="text-muted-foreground py-6 text-center text-sm">没有符合筛选的消费。</p>
        )}
        {rows.length > LIST_LIMIT && (
          <p className="text-muted-foreground mt-2 text-xs">
            表里只列前 {LIST_LIMIT} 笔；上面的合计、占比和对比包含全部 {rows.length} 笔。
          </p>
        )}
      </section>

      <section className="text-muted-foreground space-y-3 text-xs">
        <p>
          返现（已赚 / 已领）：{money(spending.cashback_earned_usd)} /{" "}
          {money(spending.cashback_claimed_usd)} ·{" "}
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
