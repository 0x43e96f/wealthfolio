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
import { Ledger, tagsOf, type Tag } from "./spending-ledger";
import { CheckMenu, type MenuNode } from "./spending-menu";
import { cardName, NOWHERE, placeKey, placesFor } from "./spending-place";
import { groupColour, SpendingMix, type MixRow } from "./spending-mix";
import { SpendingPie } from "./spending-pie";
import { MonthExplained } from "./spending-month";
import { Breakdown } from "./spending-breakdown";
import { ChangePill, SEGMENTS, segment } from "./spending-split";
import { TripChart, type TripPoint } from "./spending-tripchart";
import { HIGH_RATIO, SpendingTrend, USUAL_MONTHS, withUsual } from "./spending-trend";

// The 消费 tab. Four drop-downs choose what is counted: a year, a month, any number of
// categories and any number of tags (a trip, a means of transport, 订阅 …), and 日常 /
// 全部 whether transfers and one-off big purchases count. Everything below adds up only
// what they leave: the total, how it splits by the chosen tags and by category (each
// against the period before), the bars over time, and every row of it.

interface View {
  years: string[]; // empty = every year
  month: string; // "" = the whole year; only used when exactly one year is chosen
  categories: string[]; // fine categories; empty = all
  tags: string[]; // tag keys (see keyOf); empty = no tag filter; a row needs any one
  merchant: string;
  card: string; // one card's rows only ("" = every card)
  places: string[]; // place keys (country + city, see placeKey); empty = everywhere
  everyday: boolean; // leave out transfers and single purchases above BIG_USD
}
const START: View = {
  years: [],
  month: "",
  categories: [],
  tags: [],
  merchant: "",
  card: "",
  places: [],
  everyday: false,
};
// A purchase above this is a one-off (a laptop, a flight): it hides how everyday
// spending moves, so 日常 leaves it out.
const BIG_USD = 1000;
const TRANSFER_GROUP = "转账";
// What comes every month whatever happens: the floor under the spending line.
// 教育培训 is left out: it comes once, in big sums.
const FIXED_CATEGORIES = new Set(["房租", "订阅与软件", "保险", "卡费用", "公司事务"]);
const EMPTY_TRIP = { id: null as string | null, name: "", start_day: "", end_day: "", note: "" };

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
  const [chart, setChart] = useState<"走势" | "构成" | "占比">("走势");
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
  const counted = useMemo(() => spending.records.filter((row) => row.counted), [spending.records]);
  const oneOff = (row: SpendingRecord) =>
    groupOf(row.category) === TRANSFER_GROUP || Number(row.usd) > BIG_USD;
  const all = useMemo(
    () => (view.everyday ? counted.filter((row) => !oneOff(row)) : counted),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [counted, view.everyday, spending.groups],
  );
  const years = [...new Set(all.map((row) => row.day.slice(0, 4)))].sort().reverse();
  // One chosen year opens its months, the comparison with the year before and the
  // monthly bars; several years are simply added up.
  const year = view.years.length === 1 ? view.years[0] : "";
  const month = year ? view.month : "";
  const prefix = year ? year + (month ? "-" + month : "") : "";
  const chosenYears = new Set(view.years);
  const before = (() => {
    if (!year) return "";
    if (!month) return String(Number(year) - 1);
    const last = Number(month) - 1;
    return last ? `${year}-${String(last).padStart(2, "0")}` : `${Number(year) - 1}-12`;
  })();
  // A period still running (this month, this year) is set against the same days of the
  // one before: 7 days of November against all of October would read as a fall.
  const today = new Date();
  const todayDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const running = Boolean(prefix) && todayDay.startsWith(prefix);
  const sameSpan = (row: SpendingRecord) =>
    !running ||
    (month ? row.day.slice(8) <= todayDay.slice(8) : row.day.slice(5) <= todayDay.slice(5));
  const beforeName = !before
    ? ""
    : !running
      ? before
      : month
        ? `${before} 同期（1–${Number(todayDay.slice(8))} 日）`
        : `${before} 同期（到 ${Number(todayDay.slice(5, 7))} 月 ${Number(todayDay.slice(8))} 日）`;
  const periodName =
    view.years.length === 0
      ? "全部年份"
      : !year
        ? [...view.years].sort().join("、") + " 年"
        : month
          ? `${year} 年 ${Number(month)} 月`
          : `${year} 年`;

  const chosenCats = new Set(view.categories);
  const chosenTags = view.tags.map(tagFromKey);
  const catOk = (row: SpendingRecord) => chosenCats.size === 0 || chosenCats.has(row.category);
  const tagOk = (row: SpendingRecord) =>
    chosenTags.length === 0 ||
    tagsOf(row).some((t) => chosenTags.some((c) => c.kind === t.kind && c.value === t.value));
  // Where each row was spent (its trip's place, or home), worked out once per load.
  const places = useMemo(() => placesFor(spending.records), [spending.records]);
  const placeOfRow = (row: SpendingRecord) =>
    places.get(row.id) ?? { country: NOWHERE, city: NOWHERE };
  const chosenPlaces = new Set(view.places);
  const placeOk = (row: SpendingRecord) =>
    chosenPlaces.size === 0 || chosenPlaces.has(placeKey(placeOfRow(row)));
  // Merchant and card narrow the same way (one picked from the breakdown).
  const onlyMerchant = (row: SpendingRecord) =>
    (!view.merchant || row.description === view.merchant) &&
    (!view.card || cardName(row) === view.card);
  // The merchant and place filters travel together everywhere the page narrows rows.
  const merchantOk = (row: SpendingRecord) => onlyMerchant(row) && placeOk(row);
  const inPeriod = (when: string) => all.filter((row) => !when || row.day.startsWith(when));

  const period = inPeriod(prefix).filter(
    (row) => chosenYears.size === 0 || chosenYears.has(row.day.slice(0, 4)),
  );
  const shown = period.filter((row) => catOk(row) && tagOk(row) && merchantOk(row));
  const sum = total(shown);
  const beforeRows = before
    ? inPeriod(before).filter((row) => sameSpan(row) && catOk(row) && tagOk(row) && merchantOk(row))
    : [];
  const previous = total(beforeRows);
  // What 日常 leaves out of this same scope, so the owner sees it is not lost.
  const left = view.everyday
    ? counted.filter(
        (row) =>
          oneOff(row) &&
          (!prefix || row.day.startsWith(prefix)) &&
          (chosenYears.size === 0 || chosenYears.has(row.day.slice(0, 4))) &&
          catOk(row) &&
          tagOk(row) &&
          merchantOk(row),
      )
    : [];
  const leftTransfers = left.filter((row) => groupOf(row.category) === TRANSFER_GROUP);
  const leftBig = left.filter((row) => groupOf(row.category) !== TRANSFER_GROUP);

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
  }, [all, prefix, view.years, view.tags, view.merchant, spending.groups]);

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
  }, [all, prefix, view.years, view.categories, view.merchant, spending.tag_kinds]);

  // The breakdown's level follows the filters: the trips once trips are ticked, the
  // merchants of one category, the categories of several, the groups at first.
  const chosenCities = new Set(view.places.map((key) => key.split("\u0000")[1]));
  const preferredLevel =
    (chosenCities.size > 1 ? "城市" : undefined) ??
    chosenTags.find((tag) => tag.value)?.kind ??
    (view.merchant
      ? "类别"
      : view.categories.length === 1
        ? "商户"
        : view.categories.length
          ? "类别"
          : "大类");
  const pickPart = (level: string, name: string) =>
    level === "大类"
      ? pickGroup(name)
      : level === "类别"
        ? go({ categories: [name], merchant: "" })
        : level === "商户"
          ? go({ merchant: name })
          : level === "卡"
            ? go({ card: name })
            : level === "国家"
              ? go({
                  places:
                    placeNodes.find((node) => node.key === name)?.leaves.map((l) => l.key) ?? [],
                })
              : level === "城市"
                ? go({
                    places: placeNodes
                      .flatMap((node) => node.leaves)
                      .filter((leaf) => leaf.label === name)
                      .map((leaf) => leaf.key),
                  })
                : go({ tags: [keyOf({ kind: level, value: name })] });

  // The place menu: countries over their cities, with what each holds under the other
  // filters (the place filter itself left out). 不分地点 comes last.
  const placeNodes = useMemo<MenuNode[]>(() => {
    const cities = new Map<string, Map<string, number>>();
    for (const row of all) {
      const place = placeOfRow(row);
      const country = cities.get(place.country) ?? new Map<string, number>();
      country.set(place.city, country.get(place.city) ?? 0);
      cities.set(place.country, country);
    }
    for (const row of period) {
      if (!catOk(row) || !tagOk(row) || !onlyMerchant(row)) continue;
      const place = placeOfRow(row);
      addTo(cities.get(place.country)!, place.city, Number(row.usd));
    }
    return [...cities.entries()]
      .map(([country, inside]) => {
        const leaves = [...inside.entries()]
          .map(([city, usd]) => ({ key: placeKey({ country, city }), label: city, usd }))
          .sort((a, b) => b.usd - a.usd || a.label.localeCompare(b.label));
        return { key: country, label: country, usd: leaves.reduce((s, l) => s + l.usd, 0), leaves };
      })
      .sort((a, b) =>
        a.key === NOWHERE
          ? 1
          : b.key === NOWHERE
            ? -1
            : b.usd - a.usd || a.label.localeCompare(b.label),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, places, prefix, view.years, view.categories, view.tags, view.merchant]);

  // Looking at trips only, the chart shows trips, not months (most months have none).
  const tripMode = chosenTags.length > 0 && chosenTags.every((tag) => tag.kind === "旅行");
  const tripPoints: TripPoint[] = (() => {
    if (!tripMode) return [];
    const found = new Map<string, number>();
    for (const row of shown)
      for (const tag of tagsOf(row))
        if (tag.kind === "旅行" && tag.value) addTo(found, tag.value, Number(row.usd));
    return [...found.entries()]
      .map(([name, usd]) => {
        const trip = (spending.trips ?? []).find((t) => t.name === name);
        const days = trip
          ? Math.round(
              (Date.parse(trip.end_day + "T00:00:00Z") -
                Date.parse(trip.start_day + "T00:00:00Z")) /
                86_400_000,
            ) + 1
          : 0;
        return { name, usd, start: trip?.start_day ?? "", end: trip?.end_day ?? "", days };
      })
      .sort((a, b) => a.start.localeCompare(b.start));
  })();

  // The line: every month of the chosen years (or of all the data), under the filters.
  // Each month's usual level comes from the twelve before it, so the series starts at
  // the first month of data whatever range is shown.
  const filteredAll = all.filter((row) => catOk(row) && tagOk(row) && merchantOk(row));
  const thisMonth = todayDay.slice(0, 7);
  const trend = (() => {
    const found = new Map<string, number>();
    const fixed = new Map<string, number>();
    for (const row of filteredAll) {
      addTo(found, row.day.slice(0, 7), Number(row.usd));
      if (FIXED_CATEGORIES.has(row.category)) addTo(fixed, row.day.slice(0, 7), Number(row.usd));
    }
    const days = all.map((row) => row.day).sort();
    const firstData = days.length ? days[0].slice(0, 7) : thisMonth;
    const lastData = days.length ? days[days.length - 1].slice(0, 7) : thisMonth;
    const picked = [...view.years].sort();
    const from = picked.length ? `${picked[0]}-01` : firstData;
    const to = picked.length ? [`${picked[picked.length - 1]}-12`, lastData].sort()[0] : lastData;
    const keys: string[] = [];
    const start = [firstData, from].sort()[0];
    for (let [y, m] = start.split("-").map(Number); `${y}-${String(m).padStart(2, "0")}` <= to; ) {
      keys.push(`${y}-${String(m).padStart(2, "0")}`);
      m += 1;
      if (m > 12) [y, m] = [y + 1, 1];
    }
    return withUsual(
      keys.map((key) => ({ key, usd: found.get(key) ?? 0, fixed: fixed.get(key) ?? 0 })),
    ).filter((point) => point.key >= from);
  })();
  // The groups' shares: per month inside one year, per year otherwise (oldest first).
  const groupOrder = [
    ...new Set([...(spending.groups?.order ?? []), ...counted.map((row) => groupOf(row.category))]),
  ];
  const mixRows: MixRow[] = (() => {
    const slot = year ? 7 : 4;
    const found = new Map<string, Map<string, number>>();
    for (const row of filteredAll) {
      const key = row.day.slice(0, slot);
      if (year ? !key.startsWith(year) : chosenYears.size > 0 && !chosenYears.has(key)) continue;
      const parts = found.get(key) ?? new Map<string, number>();
      addTo(parts, groupOf(row.category), Number(row.usd));
      found.set(key, parts);
    }
    return [...found.keys()].sort().map((key) => {
      const parts = found.get(key) ?? new Map<string, number>();
      return {
        key,
        label: year ? `${Number(key.slice(5))} 月` : key,
        parts,
        total: [...parts.values()].reduce((sum, usd) => sum + usd, 0),
      };
    });
  })();
  const pickGroup = (group: string) =>
    go({
      categories: categoryNodes.find((node) => node.key === group)?.leaves.map((l) => l.key) ?? [],
      merchant: "",
    });
  const inChosen = (key: string) =>
    Boolean(prefix || chosenYears.size) &&
    (prefix ? key.startsWith(prefix) : chosenYears.has(key.slice(0, 4)));
  const pickMonth = (key: string) =>
    year === key.slice(0, 4) && month === key.slice(5)
      ? go({ month: "" })
      : go({ years: [key.slice(0, 4)], month: key.slice(5) });

  const trips = spending.trips ?? [];
  const filtered = Boolean(
    view.categories.length || view.tags.length || view.merchant || view.card || view.places.length,
  );

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

  // The year menu: every year, with what it holds under the other filters.
  const yearUsd = new Map<string, number>();
  for (const row of all)
    if (catOk(row) && tagOk(row) && merchantOk(row))
      addTo(yearUsd, row.day.slice(0, 4), Number(row.usd));
  const yearNodes: MenuNode[] = years.map((item) => {
    const usd = yearUsd.get(item) ?? 0;
    return {
      key: item,
      label: `${item} 年`,
      usd,
      leaves: [{ key: item, label: `${item} 年`, usd }],
    };
  });

  const select = "border-input bg-background h-9 rounded-md border px-2 text-sm";
  const moneyText = (usd: number) => money(String(usd));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2" aria-label="筛选">
        <CheckMenu
          name="年份"
          everything="全部年份"
          nodes={yearNodes}
          selected={view.years}
          onChange={(chosen) => go({ years: chosen, month: "" })}
          money={money}
        />
        <select
          aria-label="消费月份"
          disabled={!year}
          title={year ? undefined : "只选一个年份时可以按月看"}
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
        <CheckMenu
          name="地点"
          everything="全部地点"
          nodes={placeNodes}
          selected={view.places}
          onChange={(chosen) => go({ places: chosen })}
          money={money}
        />
        <div
          className="border-input inline-flex h-9 overflow-hidden rounded-md border text-sm"
          role="group"
          aria-label="口径"
        >
          {(
            [
              [false, "全部"],
              [true, "日常"],
            ] as const
          ).map(([everyday, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={view.everyday === everyday}
              title={everyday ? `不含转账和单笔超过 ${moneyText(BIG_USD)} 的` : "所有计入的消费"}
              onClick={() => go({ everyday })}
              className={`focus-visible:ring-ring px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${
                view.everyday === everyday ? "bg-primary text-primary-foreground" : "bg-background"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {view.merchant && (
          <span className="bg-muted inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm">
            商户：{view.merchant}
            <button type="button" aria-label="去掉商户筛选" onClick={() => go({ merchant: "" })}>
              ✕
            </button>
          </span>
        )}
        {view.card && (
          <span className="bg-muted inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm">
            卡：{view.card}
            <button type="button" aria-label="去掉卡筛选" onClick={() => go({ card: "" })}>
              ✕
            </button>
          </span>
        )}
        {filtered && (
          <button
            type="button"
            className="text-muted-foreground text-sm underline"
            onClick={() => go({ categories: [], tags: [], merchant: "", card: "", places: [] })}
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
            {beforeName}：{moneyText(previous)}
            {"\u3000"}
            <ChangePill usd={sum} was={previous} money={moneyText} />
          </p>
        )}
      </div>
      {view.everyday && (leftTransfers.length > 0 || leftBig.length > 0) && (
        <p className="text-muted-foreground -mt-4 text-xs tabular-nums">
          {`日常没算进去的：转账 ${moneyText(total(leftTransfers))}（${leftTransfers.length} 笔），` +
            `单笔超过 ${moneyText(BIG_USD)} 的 ${moneyText(total(leftBig))}（${leftBig.length} 笔）。切到「全部」能看到它们。`}
        </p>
      )}

      <section aria-label="消费图">
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <h3 className="text-sm font-medium">
            {chart === "占比"
              ? `${periodName}各大类占比`
              : chart === "构成"
                ? `大类构成（${year ? `${year} 年每月` : "每年"}）`
                : tripMode
                  ? "每趟旅行"
                  : "每月走势"}
          </h3>
          {chart === "走势" && !tripMode && (
            <span className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="inline-flex items-center gap-1">
                <span aria-hidden className="bg-chart-1 inline-block h-3 w-1.5 rounded-sm" />
                每月
              </span>
              <span className="inline-flex items-center gap-1">
                <span
                  aria-hidden
                  className="border-foreground/60 inline-block w-4 border-t border-dashed"
                />
                平常（前 {USUAL_MONTHS} 个月中位数）
              </span>
              <span className="inline-flex items-center gap-1">
                <span aria-hidden className="bg-destructive inline-block h-3 w-1.5 rounded-sm" />
                超过平常 {HIGH_RATIO} 倍
              </span>
              <span
                className="inline-flex items-center gap-1"
                title={[...FIXED_CATEGORIES].join("、")}
              >
                <span aria-hidden className="bg-chart-4 inline-block h-1.5 w-1.5" />
                固定支出
              </span>
            </span>
          )}
          {chart === "走势" && tripMode && (
            <span className="text-muted-foreground flex items-center gap-x-3 text-xs">
              <span className="inline-flex items-center gap-1">
                <span aria-hidden className="bg-destructive inline-block h-2 w-2 rounded-full" />
                高于平均
              </span>
              <span className="inline-flex items-center gap-1">
                <span aria-hidden className="bg-success inline-block h-2 w-2 rounded-full" />
                低于平均
              </span>
            </span>
          )}
          <span className={`${SEGMENTS} sm:ml-auto`} role="group" aria-label="切换图">
            {(["走势", "构成", "占比"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                aria-pressed={chart === tab}
                onClick={() => setChart(tab)}
                className={segment(chart === tab)}
              >
                {tab}
              </button>
            ))}
          </span>
        </div>
        {chart === "占比" ? (
          <SpendingPie
            slices={groupOrder.map((group) => ({
              name: group,
              usd: total(shown.filter((row) => groupOf(row.category) === group)),
            }))}
            colour={(group) => groupColour(groupOrder, group)}
            money={moneyText}
            onPick={pickGroup}
          />
        ) : chart === "构成" ? (
          <SpendingMix rows={mixRows} groups={groupOrder} money={moneyText} onGroup={pickGroup} />
        ) : tripMode ? (
          <TripChart
            points={tripPoints}
            money={moneyText}
            onPick={(name) => go({ tags: [keyOf({ kind: "旅行", value: name })] })}
          />
        ) : (
          <SpendingTrend
            points={trend}
            chosen={inChosen}
            running={thisMonth}
            onPick={pickMonth}
            money={moneyText}
          />
        )}
      </section>

      {year && month && !tripMode && (
        <MonthExplained
          monthKey={prefix}
          rows={filteredAll}
          partOf={(row) => (view.categories.length === 1 ? row.description : row.category)}
          money={moneyText}
          running={prefix === thisMonth}
        />
      )}

      <Breakdown
        rows={shown}
        beforeRows={beforeRows}
        beforeName={beforeName}
        groupOf={groupOf}
        trips={trips}
        tagKinds={tagNodes.map((node) => node.key)}
        placeOf={placeOfRow}
        preferred={preferredLevel}
        resetKey={JSON.stringify([
          view.categories,
          view.tags,
          view.merchant,
          view.card,
          view.places,
        ])}
        money={moneyText}
        onPick={pickPart}
      />

      <Ledger
        rows={shown}
        groupOf={groupOf}
        placeOf={placeOfRow}
        groupings={[
          "大类",
          "类别",
          "商户",
          "卡",
          "国家",
          "城市",
          ...tagNodes
            .map((node) => node.key)
            .filter((kind) =>
              shown.some((row) => tagsOf(row).some((t) => t.kind === kind && t.value)),
            ),
        ]}
        preferred={chosenTags.find((tag) => tag.value)?.kind ?? "月份"}
        resetKey={JSON.stringify([
          view.categories,
          view.tags,
          view.merchant,
          view.card,
          view.places,
        ])}
        noteOf={(grouping, name) => {
          const trip = grouping === "旅行" ? trips.find((t) => t.name === name) : undefined;
          return trip ? `${trip.start_day} ~ ${trip.end_day}` : "";
        }}
        onOpenGroup={pickPart}
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
