import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as PointerMove,
  type TouchEvent as FingerMove,
} from "react";
import { Button } from "@wealthfolio/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@wealthfolio/ui/components/ui/card";
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  ShieldCheck,
  Wallet,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  amount,
  ownedAccounts,
  percent,
  readAsset,
  usd,
  type Account,
  type Context,
  type Group,
  type History,
  type LedgerStatus,
  plain,
  type Trades,
  saveYield,
  type Yields,
} from "./client";

const tabs = [
  "资产总览",
  "资产曲线",
  "资产分布",
  "持仓明细",
  "衍生品",
  "收益",
  "交易流水",
  "待处理事项",
] as const;
const units = ["USD", "CAD", "CNY", "HKD"] as const;
const classOrder = ["stablecoin", "cash", "fund", "securities", "major", "altcoin"];
const classRank = (name: string) => classOrder.indexOf(name) + 1 || classOrder.length + 1;
const slices = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#9333ea",
  "#dc2626",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#4f46e5",
  "#0d9488",
  "#64748b",
];
const classes: Record<string, string> = {
  stablecoin: "稳定币",
  major: "主流币",
  altcoin: "山寨币",
  securities: "股票与证券",
  fund: "基金与债券",
  cash: "现金",
};
const providers: Record<string, string> = {
  binance: "Binance",
  okx: "OKX",
  bybit: "Bybit",
  backpack: "Backpack",
  ibkr: "IBKR 盈透",
  futu: "富途牛牛",
  manual: "手动账户",
  debank: "EVM 钱包",
  solana: "Solana 钱包",
};
const issues: Record<string, string> = {
  missing_or_stale_snapshot: "快照过期或尚未同步",
  incomplete_coverage: "资产覆盖不完整",
  duplicate_account: "重复账户已排除",
  account_identity_unverified: "账户身份待核验",
};
const notes: Record<string, string> = {
  end_of_day_statement: "数据来自券商日终报表：持仓、现金与估值均为上一交易日收盘。",
  valued_at_last_close: "数量与现金已计入当日成交（约 5–10 分钟延迟）；价格仍为上一交易日收盘价。",
  positions_end_of_day: "持仓数量与现金为上一交易日收盘；美元股票按最新报价估值。",
  some_prices_at_last_close: "期权、非美元标的等没有报价的持仓仍按上一收盘价或成交价。",
  fund_detail_unavailable: "基金与债券只有总额：富途接口不提供明细和币种。",
  fills_awaiting_statement: "有外币成交暂无汇率，待下一份日终报表计入。",
};
const eventNames: Record<string, string> = {
  trade: "成交",
  deposit: "充值",
  withdrawal: "提现",
  account_transfer: "账户划转",
  convert: "闪兑",
  interest: "利息",
  dividend: "股息",
  tax: "预扣税",
  realized_pnl: "已实现盈亏",
  commission: "手续费",
  fee: "手续费",
  transfer: "划转",
  account_change: "账户变动",
  funding_fee: "资金费",
  settlement: "结算",
};
function date(value: string | undefined) {
  return value ? new Date(value).toLocaleString("zh-CN") : "尚未同步";
}

// An exchange-style balance curve: one point per day's close, a filled area, and
// a reading for whichever day the pointer is over. Geometry uses floats; every
// figure shown is formatted from the exact strings.
function Trend({
  points,
  money,
}: {
  points: History["points"];
  money: (value: string | null | undefined) => string;
}) {
  const [at, setAt] = useState<number | null>(null);
  const width = 800;
  const height = 260;
  const pad = 8;
  const values = points.map((point) => Number(point.net_usd));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || Math.abs(high) || 1;
  const floor = high === low ? low - span / 2 : low - span * 0.1;
  const top = high === low ? high + span / 2 : high + span * 0.1;
  const x = (index: number) =>
    points.length > 1 ? pad + (index * (width - 2 * pad)) / (points.length - 1) : width / 2;
  const y = (value: number) =>
    height - pad - ((value - floor) / (top - floor)) * (height - 2 * pad);
  const line = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`);
  const shown = at ?? points.length - 1;
  const point = points[shown];
  const move = (event: PointerMove<SVGSVGElement> | FingerMove<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const clientX = "touches" in event ? event.touches[0]?.clientX : event.clientX;
    if (clientX == null || !box.width) return;
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    setAt(Math.round(ratio * (points.length - 1)));
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums">{money(point.net_usd)}</span>
        <span className="text-muted-foreground text-sm">{point.date} 收盘</span>
        {point.change_usd != null && (
          <span
            className={
              "text-sm tabular-nums " +
              (point.change_usd.startsWith("-") ? "text-red-600" : "text-green-600")
            }
          >
            {point.change_usd.startsWith("-") ? "" : "+"}
            {money(point.change_usd)}
            {point.change_pct != null ? `（${point.change_pct}%）` : ""}
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-64 w-full cursor-crosshair touch-none"
        role="img"
        aria-label="净资产历史曲线"
        onMouseMove={move}
        onTouchMove={move}
        onMouseLeave={() => setAt(null)}
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </linearGradient>
        </defs>
        {points.length > 1 && (
          <>
            <polygon
              points={`${x(0).toFixed(1)},${height - pad} ${line.join(" ")} ${x(points.length - 1).toFixed(1)},${height - pad}`}
              fill="url(#trend-fill)"
            />
            <polyline
              points={line.join(" ")}
              fill="none"
              stroke="#2563eb"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
        <line
          x1={x(shown)}
          x2={x(shown)}
          y1={pad}
          y2={height - pad}
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeDasharray="4 4"
        />
        <circle cx={x(shown)} cy={y(values[shown])} r="5" fill="#2563eb" stroke="white" />
      </svg>
      <div className="text-muted-foreground mt-1 flex justify-between text-xs">
        <span>{points[0].date}</span>
        <span>
          区间最低 {money(String(points[values.indexOf(low)].net_usd))} · 最高{" "}
          {money(String(points[values.indexOf(high)].net_usd))}
        </span>
        <span>{points[points.length - 1].date}</span>
      </div>
    </div>
  );
}
// A cell is its text, or text with the value it sorts by when the two differ.
type Cell = string | null | undefined | { text: string; sort: number | string; act?: () => void };
const sortable = (text: string, value: string | number | null | undefined): Cell => ({
  text,
  sort: Number(value ?? 0) || 0,
});
function Rows({
  headers,
  rows,
  search,
  pick,
}: {
  headers: string[];
  rows: Cell[][];
  search?: string;
  pick?: { column: number; label: string };
}) {
  const [order, setOrder] = useState<{ column: number; down: boolean } | null>(null);
  const [query, setQuery] = useState("");
  const [choice, setChoice] = useState("");
  if (!rows.length)
    return (
      <p className="text-muted-foreground py-10 text-center">暂无数据。连接只读账户后开始同步。</p>
    );
  const text = (cell: Cell) => (cell == null ? "—" : typeof cell === "string" ? cell : cell.text);
  const rank = (cell: Cell) => (cell != null && typeof cell === "object" ? cell.sort : text(cell));
  const options = pick ? [...new Set(rows.map((row) => text(row[pick.column])))].sort() : [];
  const needle = query.trim().toLowerCase();
  let shown = rows.filter(
    (row) =>
      (!needle || row.some((cell) => text(cell).toLowerCase().includes(needle))) &&
      (!choice || !pick || text(row[pick.column]) === choice),
  );
  if (order)
    shown = [...shown].sort((a, b) => {
      const x = rank(a[order.column]);
      const y = rank(b[order.column]);
      const result =
        typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y), "zh-CN", { numeric: true });
      return order.down ? -result : result;
    });
  return (
    <div>
      {(search || pick) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {search && (
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={search}
              aria-label={search}
              className="border-input bg-background h-9 w-56 rounded-md border px-3 text-sm"
            />
          )}
          {pick && (
            <select
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              aria-label={pick.label}
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            >
              <option value="">{pick.label}：全部</option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
          <span className="text-muted-foreground self-center text-xs">
            {shown.length} / {rows.length} 行 · 点击表头排序
          </span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              {headers.map((header, column) => (
                <th key={header} className="text-muted-foreground border-b px-4 py-3 font-medium">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 whitespace-nowrap"
                    onClick={() =>
                      setOrder((current) =>
                        current?.column === column
                          ? { column, down: !current.down }
                          : { column, down: true },
                      )
                    }
                  >
                    {header}
                    {order?.column === column ? (order.down ? " ▼" : " ▲") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 400).map((row, index) => (
              <tr key={index} className="border-b last:border-0">
                {row.map((cell, column) => (
                  <td key={column} className="whitespace-nowrap px-4 py-3">
                    {cell != null && typeof cell === "object" && cell.act ? (
                      <button type="button" className="underline" onClick={cell.act}>
                        {cell.text}
                      </button>
                    ) : (
                      text(cell)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > 400 && (
        <p className="text-muted-foreground mt-2 text-xs">
          仅显示前 400 行，共 {shown.length} 行；用搜索或筛选缩小范围。
        </p>
      )}
    </div>
  );
}

// Geometry only: the legend beside it carries the exact figures. Pointing at a
// slice, or at its legend line, lists what it is made of.
function Pie({
  rows,
  label,
}: {
  rows: { label: string; value: string; share: string | null; detail: string[] }[];
  label: string;
}) {
  const [over, setOver] = useState<string | null>(null);
  let turned = 0;
  const arcs = rows
    .filter((row) => Number(row.share ?? 0) > 0)
    .map((row, index) => {
      const share = Math.min(1, Number(row.share));
      const from = turned * 2 * Math.PI - Math.PI / 2;
      turned += share;
      const to = turned * 2 * Math.PI - Math.PI / 2;
      const point = (angle: number) =>
        `${(100 + 90 * Math.cos(angle)).toFixed(2)} ${(100 + 90 * Math.sin(angle)).toFixed(2)}`;
      return {
        ...row,
        color: slices[index % slices.length],
        path:
          share >= 0.9999
            ? "M 100 10 A 90 90 0 1 1 99.99 10 Z"
            : `M 100 100 L ${point(from)} A 90 90 0 ${share > 0.5 ? 1 : 0} 1 ${point(to)} Z`,
      };
    });
  if (!arcs.length) return <p className="text-muted-foreground text-sm">暂无数据。</p>;
  const current = arcs.find((arc) => arc.label === over);
  return (
    <div className="flex flex-wrap items-start gap-8" onMouseLeave={() => setOver(null)}>
      <svg viewBox="0 0 200 200" className="size-56 shrink-0" role="img" aria-label={label}>
        {arcs.map((arc) => (
          <path
            key={arc.label}
            d={arc.path}
            fill={arc.color}
            stroke="white"
            strokeWidth="1"
            opacity={over && over !== arc.label ? 0.35 : 1}
            onMouseEnter={() => setOver(arc.label)}
            onClick={() => setOver(arc.label)}
          >
            <title>{arc.label}</title>
          </path>
        ))}
      </svg>
      <ul className="space-y-2 text-sm">
        {arcs.map((arc) => (
          <li key={arc.label}>
            <button
              type="button"
              className={
                "flex items-center gap-2 rounded px-1 text-left " +
                (over === arc.label ? "bg-muted" : "")
              }
              onMouseEnter={() => setOver(arc.label)}
              onFocus={() => setOver(arc.label)}
              onClick={() => setOver(arc.label)}
            >
              <span className="inline-block size-3 rounded-sm" style={{ background: arc.color }} />
              <span className="w-28">{arc.label}</span>
              <span className="w-16 tabular-nums">{percent(arc.share)}</span>
              <span className="text-muted-foreground tabular-nums">{arc.value}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="border-border min-h-40 min-w-64 flex-1 rounded-lg border p-3 text-sm">
        {current ? (
          <>
            <p className="mb-2 font-medium">
              {current.label} · {percent(current.share)} · {current.value}
            </p>
            <ul className="space-y-1">
              {current.detail.map((item) => (
                <li key={item} className="tabular-nums">
                  {item}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-muted-foreground">把鼠标移到某一块或某一行上，查看它包含什么。</p>
        )}
      </div>
    </div>
  );
}

export function Portfolio() {
  const [context, setContext] = useState<Context | null>(null);
  const [ledger, setLedger] = useState<LedgerStatus>({ available: false });
  const [history, setHistory] = useState<History | null>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]>("资产总览");
  const [hidden, setHidden] = useState(false);
  const [dust, setDust] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [opened, setOpened] = useState<string | null>(null);
  const [trades, setTrades] = useState<Trades | null>(null);
  const [yields, setYields] = useState<Yields | null>(null);
  const [flow, setFlow] = useState<"汇总" | "成交" | "资金">("汇总");
  const [unit, setUnit] = useState<(typeof units)[number]>("USD");
  const [split, setSplit] = useState<"大类" | "平台" | "合并">("大类");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const embedded = new URLSearchParams(window.location.search).get("embed") === "1";
  const money = (value: string | null | undefined) => (hidden ? "••••" : usd(value));
  const privateText = (value: string) => (hidden ? "••••" : value);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const timeout = window.setTimeout(() => current.abort(), 20_000);
    setBusy(true);
    setError("");
    try {
      const [data, status, past, deals, income] = await Promise.all([
        readAsset<Context>("context", current.signal),
        readAsset<LedgerStatus>("wealthfolio/status", current.signal).catch(() => ({
          available: false,
        })),
        readAsset<History>("history", current.signal).catch(() => null),
        readAsset<Trades>("trades?days=365", current.signal).catch(() => null),
        readAsset<Yields>("yields", current.signal).catch(() => null),
      ]);
      if (current.signal.aborted) return;
      if (!Array.isArray(data.overview?.accounts) || !Array.isArray(data.recent_events))
        throw new Error("Invalid asset context");
      setContext(data);
      setLedger(status);
      if (past && Array.isArray(past.points)) setHistory(past);
      if (deals && Array.isArray(deals.fills)) setTrades(deals);
      if (income && Array.isArray(income.rows)) setYields(income);
    } catch {
      if (controller.current === current)
        setError("刷新失败。保留上次显示的数据，请检查同步状态并稍后重试。");
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    return () => {
      controller.current?.abort();
    };
  }, [refresh]);
  const accounts = context ? ownedAccounts(context) : [];
  const holdings = accounts.flatMap((account) =>
    (account.snapshot?.holdings ?? []).map((holding) => ({
      ...holding,
      account: account.label,
      connection: account.id,
    })),
  );
  const positions = accounts.flatMap((account) =>
    (account.snapshot?.positions ?? []).map((position) => ({
      ...position,
      account: account.label,
    })),
  );
  // The same asset in different accounts sits together, largest holding first.
  const totals = new Map<string, number>();
  for (const holding of holdings)
    totals.set(holding.symbol, (totals.get(holding.symbol) ?? 0) + Number(holding.usd_value ?? 0));
  const options = holdings.filter((holding) => holding.scope === "opt");
  const editYield = async (connection: string, asset: string, current?: string) => {
    const answer = window.prompt(
      `${asset} 的年化（%）。留空并确定 = 清除手填的年化。`,
      current ?? "",
    );
    if (answer === null) return;
    const rate = answer.trim().replace("%", "");
    try {
      await saveYield(connection, asset, rate === "" ? null : rate);
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "保存失败");
    }
  };
  const allocation = context?.allocation;
  const exposure = context?.exposure;
  const trend = history?.points ?? [];
  const today = trend[trend.length - 1];
  const observation = (item: NonNullable<typeof allocation>["observations"][number]) =>
    item.kind === "platform_concentration"
      ? `${providers[item.subject ?? ""] ?? item.subject} 占已知净资产 ${percent(item.share)}，单一平台占比过半。`
      : item.kind === "asset_concentration"
        ? `${item.subject} 占已估值持仓 ${percent(item.share)}，单一非稳定币资产占比过半。`
        : `有 ${item.count} 项持仓缺少报价，未计入分布。`;
  // The owner's rule: anything under ten dollars, or without a market to price it,
  // is noise. It stays in the totals where it has a value and out of the tables.
  // By size, not sign: a short position or a margin loan is negative and matters.
  const small = (value: string | null | undefined) => value == null || Math.abs(Number(value)) < 10;
  const merged = allocation?.by_asset ?? [];
  // Each asset's share of everything valued, across all accounts: the largest
  // eleven on their own and the rest together. Pointing at one lists where it sits.
  const ranked = [...merged]
    .filter((row) => !small(row.usd))
    .sort((a, b) => Number(b.usd) - Number(a.usd));
  const rest = ranked.slice(11);
  const assetSlices = [
    ...ranked.slice(0, 11).map((row) => ({
      label: row.symbol,
      value: money(row.usd),
      share: row.share,
      detail: [...row.sources]
        .sort((a, b) => Number(b.usd ?? 0) - Number(a.usd ?? 0))
        .map((source) => `${privateText(source.account)} · ${money(source.usd)}`),
    })),
    ...(rest.length
      ? [
          {
            label: `其他 ${rest.length} 项`,
            value: money(String(rest.reduce((sum, row) => sum + Number(row.usd), 0).toFixed(2))),
            share: String(rest.reduce((sum, row) => sum + Number(row.share ?? 0), 0)),
            detail: [
              ...rest
                .slice(0, 12)
                .map((row) => `${row.symbol} · ${money(row.usd)} · ${percent(row.share)}`),
              ...(rest.length > 12 ? [`…… 另有 ${rest.length - 12} 项`] : []),
            ],
          },
        ]
      : []),
  ];
  const smallCount =
    tab === "资产分布"
      ? merged.filter((row) => small(row.usd)).length
      : holdings.filter((row) => small(row.usd_value)).length;
  const dustToggle = smallCount > 0 && (
    <p className="text-muted-foreground mt-3 text-xs">
      {dust
        ? `已显示 ${smallCount} 项低于 $10 或暂无报价的持仓。`
        : `已隐藏 ${smallCount} 项低于 $10 或暂无报价的持仓。`}{" "}
      <button type="button" className="underline" onClick={() => setDust((value) => !value)}>
        {dust ? "隐藏" : "显示全部"}
      </button>
    </p>
  );
  const accountStatus = (account: Account) =>
    account.stale
      ? "快照过期或尚未同步"
      : account.snapshot?.balances_complete
        ? "余额已同步"
        : "覆盖不完整";
  // Accounts the owner filed under one name show as a single row that opens up.
  type OverviewRow =
    | { kind: "group"; group: Group; members: Account[]; platforms: string; latest?: string }
    | { kind: "account"; account: Account; member: boolean };
  const overviewRows: OverviewRow[] = [];
  const grouped = new Set<string>();
  for (const group of context?.groups ?? []) {
    const members = accounts.filter((account) => group.accounts.includes(account.id));
    if (!members.length) continue;
    members.forEach((account) => grouped.add(account.id));
    overviewRows.push({
      kind: "group",
      group,
      members,
      platforms: [
        ...new Set(members.map((account) => providers[account.provider] ?? account.provider)),
      ].join(" · "),
      latest: members
        .map((account) => account.snapshot?.source_time)
        .filter((value): value is string => !!value)
        .sort()
        .pop(),
    });
    if (expanded[group.name])
      members.forEach((account) => overviewRows.push({ kind: "account", account, member: true }));
  }
  accounts
    .filter((account) => !grouped.has(account.id))
    .forEach((account) => overviewRows.push({ kind: "account", account, member: false }));
  const detail = (account: Account) => {
    const summary = context?.account_summaries?.[account.id];
    const snapshot = account.snapshot;
    if (!snapshot) return <p className="text-muted-foreground text-sm">尚无快照。</p>;
    const lines = [...snapshot.holdings]
      .filter((holding) => dust || !small(holding.usd_value))
      .sort((a, b) => Math.abs(Number(b.usd_value ?? 0)) - Math.abs(Number(a.usd_value ?? 0)));
    const figures: [string, string][] = summary
      ? [
          ["净值", money(summary.net_usd)],
          ["现金与稳定币", money(summary.cash_usd)],
          ["持仓市值", money(summary.invested_usd)],
          ["总敞口", money(summary.gross_exposure_usd)],
          ["杠杆", summary.leverage ? `${summary.leverage}×` : "—"],
          ["借款", money(summary.borrowed_usd)],
        ]
      : [];
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {figures.map(([title, value]) => (
            <div key={title}>
              <p className="text-muted-foreground text-xs">{title}</p>
              <p className="font-medium tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          杠杆 = 总敞口 ÷ 净值；总敞口为非现金持仓市值的绝对值加衍生品名义价值。
          {snapshot.missing
            .filter((item) => notes[item])
            .map((item) => " " + notes[item])
            .join("")}
        </p>
        {(summary?.by_currency?.length ?? 0) > 0 && (
          <p className="text-sm">
            按币种：
            {summary!
              .by_currency!.map(
                (row) =>
                  `${hidden ? "••••" : amount(row.native, row.currency)}` +
                  (row.currency === "USD" ? "" : `（≈ ${money(row.usd)}）`),
              )
              .join(" · ")}
          </p>
        )}
        <Rows
          headers={["持仓", "数量", "成本价", "浮动盈亏", "原币市值", "折合美元", "账户范围"]}
          rows={lines.map((holding) => [
            holding.symbol,
            privateText(holding.quantity),
            holding.cost != null ? `${plain(holding.cost)} ${holding.currency ?? ""}` : "—",
            holding.pnl != null
              ? hidden
                ? "••••"
                : amount(holding.pnl, holding.currency ?? "")
              : "—",
            holding.currency && holding.native_value != null
              ? hidden
                ? "••••"
                : amount(holding.native_value, holding.currency)
              : "—",
            money(holding.usd_value),
            holding.scope,
          ])}
        />
        {snapshot.positions.length > 0 && (
          <Rows
            headers={["合约", "方向", "数量", "名义敞口", "未实现盈亏"]}
            rows={snapshot.positions.map((position) => [
              position.instrument,
              position.side,
              privateText(position.quantity),
              money(position.notional_usd),
              money(position.unrealized_pnl),
            ])}
          />
        )}
      </div>
    );
  };
  const name = (id: string) =>
    context?.overview.accounts.find((account) => account.id === id)?.label ?? "未知账户";

  return (
    <main className="bg-background text-foreground min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-muted-foreground mb-1 text-sm">
              {embedded ? "真实资产" : "MobiQuant"}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">Portfolio</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              交易所与链上钱包 · 只读同步 · 按来源对账
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setHidden((value) => !value)}
              aria-label={hidden ? "显示金额" : "隐藏金额"}
            >
              {hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            </Button>
            <Button variant="outline" onClick={() => void refresh()} disabled={busy}>
              <RefreshCw className="mr-2 size-4" />
              {busy ? "刷新中" : "刷新"}
            </Button>
            <Button asChild>
              <a href="connections?tab=connections">账户连接</a>
            </Button>
          </div>
        </header>
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <ShieldCheck className="size-4" />
          德国私有节点 · 仅查询权限 ·{" "}
          {ledger.available ? "Wealthfolio 账本已连接" : "Wealthfolio 账本暂不可用"}
        </p>
        {error && (
          <p
            role="alert"
            className="border-destructive text-destructive rounded-lg border p-3 text-sm"
          >
            {error}
          </p>
        )}
        <section className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-muted-foreground flex items-center justify-between text-sm font-medium">
                <span>已知净资产</span>
                <select
                  value={unit}
                  onChange={(event) => setUnit(event.target.value as (typeof units)[number])}
                  aria-label="计价币种"
                  className="border-input bg-background text-foreground h-7 rounded-md border px-2 text-xs"
                >
                  {units.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">
                {hidden
                  ? "••••"
                  : unit === "USD" || !context?.net_by_currency?.[unit]
                    ? usd(context?.overview.known_net_usd)
                    : amount(context.net_by_currency[unit], unit)}
              </p>
              {unit !== "USD" && context?.fx?.[unit] && (
                <p className="text-muted-foreground mt-1 text-xs">
                  1 USD = {plain(context.fx[unit])} {unit}
                </p>
              )}
              <p className="text-muted-foreground mt-2 text-xs">
                {context?.overview.complete
                  ? "所选账户余额覆盖完整"
                  : "覆盖范围内的最近已知估值，缺失项不视为零"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm font-medium">自有账户</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{context?.overview.included_accounts ?? "—"}</p>
              <p className="text-muted-foreground mt-2 text-xs">
                已估值 {context?.overview.valued_accounts ?? "—"} 个 · 观察与重复账户不计入
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm font-medium">
                今日净值变化
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">
                {today?.change_usd != null ? money(today.change_usd) : "暂不可计算"}
              </p>
              <p className="text-muted-foreground mt-2 text-xs">
                {today?.change_pct != null ? `${today.change_pct}% · ` : ""}
                较上一日收盘（温哥华 0 点），含充值与提现
              </p>
            </CardContent>
          </Card>
        </section>
        <nav className="flex gap-2 overflow-x-auto" aria-label="Portfolio 视图">
          {tabs.map((item) => (
            <Button
              key={item}
              variant={tab === item ? "default" : "outline"}
              onClick={() => setTab(item)}
              aria-pressed={tab === item}
            >
              {item}
            </Button>
          ))}
        </nav>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="size-5" />
              {tab}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tab === "资产总览" && trend.length > 1 && (
              <div className="mb-6">
                <div className="text-muted-foreground mb-2 flex justify-between text-xs">
                  <span>
                    {trend[0].date} · {money(trend[0].net_usd)}
                  </span>
                  <span>
                    {trend[trend.length - 1].date} · {money(trend[trend.length - 1].net_usd)}
                  </span>
                </div>
                {!hidden && <Trend points={trend} money={money} />}
                <p className="text-muted-foreground mt-2 text-xs">
                  {history?.note}
                  {trend.some((point) => !point.complete) && " 部分日期尚有账户未同步，数值偏低。"}
                </p>
              </div>
            )}
            {tab === "资产曲线" && (
              <div className="space-y-4">
                <p className="text-muted-foreground text-sm">
                  每天以温哥华时间 0 点为界，取各账户当日最后一次同步的净值相加。
                  {history?.note}
                  新接入账户的那一天不计算涨跌。
                </p>
                {trend.length > 0 && !hidden && <Trend points={trend} money={money} />}
                <Rows
                  headers={["日期", "净资产", "较前一日", "涨跌幅", "计入账户"]}
                  rows={[...trend]
                    .reverse()
                    .map((point) => [
                      point.date,
                      sortable(money(point.net_usd), point.net_usd),
                      sortable(
                        point.change_usd == null ? "—" : money(point.change_usd),
                        point.change_usd,
                      ),
                      sortable(
                        point.change_pct == null ? "—" : `${point.change_pct}%`,
                        point.change_pct,
                      ),
                      `${point.valued_accounts}${point.complete ? "" : "（不全）"}`,
                    ])}
                />
              </div>
            )}
            {tab === "资产分布" && (
              <div className="space-y-8">
                <div className="flex flex-wrap gap-2">
                  {(["大类", "平台", "合并"] as const).map((item) => (
                    <Button
                      key={item}
                      size="sm"
                      variant={split === item ? "default" : "outline"}
                      onClick={() => setSplit(item)}
                    >
                      {item === "大类" ? "按大类" : item === "平台" ? "按平台" : "跨账户合并持仓"}
                    </Button>
                  ))}
                </div>
                {(allocation?.observations ?? []).length > 0 && (
                  <ul className="border-border space-y-1 rounded-lg border p-3 text-sm">
                    {allocation?.observations.map((item) => (
                      <li key={item.kind}>{observation(item)}</li>
                    ))}
                  </ul>
                )}
                {split === "平台" && (
                  <section>
                    <h3 className="mb-3 text-sm font-medium">按平台 · 已知净资产</h3>
                    <Pie
                      label="平台占比"
                      rows={(allocation?.by_platform ?? []).map((row) => ({
                        label: `${providers[row.provider] ?? row.provider} · ${row.accounts} 个账户`,
                        value: money(row.usd),
                        share: row.share,
                        detail: accounts
                          .filter((account) => account.provider === row.provider)
                          .sort(
                            (a, b) =>
                              Number(b.snapshot?.net_usd ?? 0) - Number(a.snapshot?.net_usd ?? 0),
                          )
                          .map(
                            (account) =>
                              `${privateText(account.label)} · ${money(account.snapshot?.net_usd)}`,
                          ),
                      }))}
                    />
                  </section>
                )}
                {split === "大类" && (
                  <section>
                    <h3 className="mb-3 text-sm font-medium">按大类 · 已估值持仓</h3>
                    <Pie
                      label="资产大类占比"
                      rows={(allocation?.by_class ?? []).map((row) => {
                        const members = merged
                          .filter((item) => item.class === row.class && !small(item.usd))
                          .sort((a, b) => Number(b.usd) - Number(a.usd));
                        return {
                          label: classes[row.class] ?? row.class,
                          value: money(row.usd),
                          share: row.share,
                          detail: [
                            ...members
                              .slice(0, 12)
                              .map(
                                (item) =>
                                  `${item.symbol} · ${money(item.usd)} · ${percent(item.share)}`,
                              ),
                            ...(members.length > 12 ? [`…… 另有 ${members.length - 12} 项`] : []),
                          ],
                        };
                      })}
                    />
                  </section>
                )}
                {split === "合并" && (
                  <section>
                    <h3 className="mb-3 text-sm font-medium">跨账户合并持仓</h3>
                    <div className="mb-6">
                      <Pie label="各资产占比" rows={assetSlices} />
                    </div>
                    <Rows
                      search="搜索资产"
                      pick={{ column: 1, label: "大类" }}
                      headers={["资产", "大类", "合计数量", "估值", "占比", "来源"]}
                      rows={[...merged]
                        .filter((row) => dust || !small(row.usd))
                        .sort(
                          (a, b) =>
                            classRank(a.class) - classRank(b.class) ||
                            Number(b.usd) - Number(a.usd),
                        )
                        .map((row) => [
                          row.symbol,
                          classes[row.class] ?? row.class,
                          sortable(privateText(plain(row.quantity)), row.quantity),
                          sortable(money(row.usd), row.usd),
                          sortable(percent(row.share), row.share),
                          privateText(
                            [...new Set(row.sources.map((source) => source.account))].join("、"),
                          ),
                        ])}
                    />
                    {dustToggle}
                  </section>
                )}
                <p className="text-muted-foreground text-xs">
                  占比按已有报价的代币持仓计算；协议仓位已包含在钱包净值中，不重复拆分。链上同名代币按各自合约分开统计。
                </p>
              </div>
            )}
            {tab === "资产总览" && accounts.length === 0 && (
              <p className="text-muted-foreground py-10 text-center">
                暂无数据。连接只读账户后开始同步。
              </p>
            )}
            {tab === "资产总览" && accounts.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      {["账户", "平台", "已知净值", "快照时间", "同步与覆盖"].map((header) => (
                        <th
                          key={header}
                          className="text-muted-foreground border-b px-4 py-3 font-medium"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {overviewRows.map((row) =>
                      row.kind === "group" ? (
                        <tr
                          key={"group:" + row.group.name}
                          className="hover:bg-muted/40 cursor-pointer border-b"
                          onClick={() =>
                            setExpanded((current) => ({
                              ...current,
                              [row.group.name]: !current[row.group.name],
                            }))
                          }
                        >
                          <td className="whitespace-nowrap px-4 py-3 font-medium">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1"
                              aria-expanded={!!expanded[row.group.name]}
                            >
                              {expanded[row.group.name] ? (
                                <ChevronDown className="size-4" />
                              ) : (
                                <ChevronRight className="size-4" />
                              )}
                              {privateText(row.group.name)}
                            </button>
                            <span className="text-muted-foreground ml-2 text-xs">
                              {row.members.length} 个账户
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">{row.platforms}</td>
                          <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">
                            {money(row.group.net_usd)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">{date(row.latest)}</td>
                          <td className="whitespace-nowrap px-4 py-3">
                            {row.group.complete ? "全部已同步" : "部分账户覆盖不完整"}
                          </td>
                        </tr>
                      ) : (
                        <Fragment key={row.account.id}>
                          <tr
                            className="hover:bg-muted/40 cursor-pointer border-b last:border-0"
                            onClick={() =>
                              setOpened((current) =>
                                current === row.account.id ? null : row.account.id,
                              )
                            }
                          >
                            <td
                              className={
                                "whitespace-nowrap px-4 py-3" +
                                (row.member ? " text-muted-foreground pl-10" : "")
                              }
                            >
                              <button
                                type="button"
                                className="inline-flex items-center gap-1"
                                aria-expanded={opened === row.account.id}
                                aria-label={`${row.account.label} 明细`}
                              >
                                {opened === row.account.id ? (
                                  <ChevronDown className="size-4" />
                                ) : (
                                  <ChevronRight className="size-4" />
                                )}
                                {privateText(row.account.label)}
                              </button>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3">
                              {providers[row.account.provider] ?? row.account.provider}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                              {money(row.account.snapshot?.net_usd)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3">
                              {date(row.account.snapshot?.source_time)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3">
                              {accountStatus(row.account)}
                            </td>
                          </tr>
                          {opened === row.account.id && (
                            <tr className="bg-muted/20 border-b">
                              <td colSpan={5} className="px-4 py-4">
                                {detail(row.account)}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {tab === "持仓明细" && (
              <>
                <Rows
                  search="搜索资产或账户"
                  pick={{ column: 1, label: "账户" }}
                  headers={["资产", "账户", "数量", "估值", "账户范围", ""]}
                  rows={[...holdings]
                    .filter((holding) => dust || !small(holding.usd_value))
                    .sort(
                      (a, b) =>
                        (totals.get(b.symbol) ?? 0) - (totals.get(a.symbol) ?? 0) ||
                        a.symbol.localeCompare(b.symbol) ||
                        Number(b.usd_value ?? 0) - Number(a.usd_value ?? 0),
                    )
                    .map((holding) => [
                      holding.symbol,
                      privateText(holding.account),
                      sortable(privateText(plain(holding.quantity)), holding.quantity),
                      sortable(money(holding.usd_value), holding.usd_value),
                      holding.scope,
                      {
                        text: "年化",
                        sort: 0,
                        act: () => void editYield(holding.connection, holding.symbol),
                      },
                    ])}
                />
                {dustToggle}
              </>
            )}
            {tab === "衍生品" && (
              <>
                <p className="text-muted-foreground mb-4 text-sm">
                  名义敞口用于观察风险，不再加入净资产。账户净值已包含的未实现盈亏不重复计算。
                </p>
                {exposure && positions.length > 0 && (
                  <p className="mb-4 text-sm">
                    多头 {money(exposure.long_usd)} · 空头 {money(exposure.short_usd)} · 净敞口{" "}
                    {money(exposure.net_usd)} · 总名义 {money(exposure.gross_usd)}
                    {exposure.gross_to_net_assets
                      ? ` · 总名义为已知净资产的 ${exposure.gross_to_net_assets} 倍`
                      : ""}
                    {exposure.unvalued_positions
                      ? ` · ${exposure.unvalued_positions} 个仓位缺少名义价值`
                      : ""}
                  </p>
                )}
                <Rows
                  search="搜索合约"
                  headers={["合约", "账户", "方向", "数量", "名义敞口 / 期权市值", "未实现盈亏"]}
                  rows={[
                    ...positions.map((position): Cell[] => [
                      position.instrument,
                      privateText(position.account),
                      position.side,
                      sortable(privateText(plain(position.quantity)), position.quantity),
                      sortable(money(position.notional_usd), position.notional_usd),
                      sortable(money(position.unrealized_pnl), position.unrealized_pnl),
                    ]),
                    // Options held at a broker: the value shown is the premium's
                    // market value, which is already part of net assets.
                    ...options.map((holding): Cell[] => [
                      holding.symbol,
                      privateText(holding.account),
                      holding.quantity.startsWith("-") ? "期权 · 卖方" : "期权 · 买方",
                      sortable(privateText(plain(holding.quantity)), holding.quantity),
                      sortable(money(holding.usd_value), holding.usd_value),
                      holding.pnl != null
                        ? sortable(
                            hidden ? "••••" : amount(holding.pnl, holding.currency ?? ""),
                            holding.pnl,
                          )
                        : "—",
                    ]),
                  ]}
                />
              </>
            )}
            {tab === "收益" && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                  {(
                    [
                      ["生息资产", money(yields?.earning_usd)],
                      ["加权年化", yields?.weighted_apy ? `${yields.weighted_apy}%` : "—"],
                      ["预计月收益", money(yields?.monthly_usd)],
                      ["预计年收益", money(yields?.yearly_usd)],
                      ["未生息的现金与稳定币", money(yields?.idle_usd)],
                    ] as const
                  ).map(([title, value]) => (
                    <div key={title}>
                      <p className="text-muted-foreground text-xs">{title}</p>
                      <p className="text-xl font-semibold tabular-nums">{value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-muted-foreground text-sm">
                  收益是按当前市值和年化估算的，不是实际到账。年化标“平台”的是平台自己给出的利率，随同步更新；
                  标“手填”的是你填的，以你填的为准，清空后恢复为平台利率。
                </p>
                <section>
                  <h3 className="mb-3 text-sm font-medium">生息中</h3>
                  <Rows
                    search="搜索资产或账户"
                    headers={["资产", "账户", "市值", "年化", "来源", "预计月收益", "更新日期", ""]}
                    rows={(yields?.rows ?? []).map((row) => [
                      row.asset,
                      privateText(row.account),
                      sortable(money(row.usd), row.usd),
                      sortable(`${row.apy}%`, row.apy),
                      row.source === "manual" ? "手填" : "平台",
                      sortable(money(row.monthly_usd), row.monthly_usd),
                      row.updated_at ? date(row.updated_at).slice(0, 10) : "随同步",
                      {
                        text: "修改",
                        sort: 0,
                        act: () => void editYield(row.connection_id, row.asset, row.apy),
                      },
                    ])}
                  />
                </section>
                <section>
                  <h3 className="mb-3 text-sm font-medium">还没有年化的现金、稳定币、基金与债券</h3>
                  <Rows
                    search="搜索资产或账户"
                    headers={["资产", "账户", "大类", "市值", ""]}
                    rows={(yields?.unset ?? []).map((row) => [
                      row.asset,
                      privateText(row.account),
                      classes[row.class] ?? row.class,
                      sortable(money(row.usd), row.usd),
                      {
                        text: "设置年化",
                        sort: 0,
                        act: () => void editYield(row.connection_id, row.asset),
                      },
                    ])}
                  />
                  <p className="text-muted-foreground mt-2 text-xs">
                    其他持仓（比如某只股票的股息率）也可以设置：到“持仓明细”找到它，点该行的“年化”。
                  </p>
                </section>
              </div>
            )}
            {tab === "交易流水" && (
              <>
                <div className="mb-4 flex flex-wrap gap-2">
                  {(["汇总", "成交", "资金"] as const).map((item) => (
                    <Button
                      key={item}
                      size="sm"
                      variant={flow === item ? "default" : "outline"}
                      onClick={() => setFlow(item)}
                    >
                      {item === "汇总" ? "按标的汇总" : item === "成交" ? "成交明细" : "资金流水"}
                    </Button>
                  ))}
                </div>
                {flow === "汇总" && (
                  <>
                    <p className="text-muted-foreground mb-4 text-sm">
                      近一年内每个账户、每个标的的买卖与已实现盈亏，金额以该标的的计价币种表示。
                      标“平台”的盈亏是平台自己给出的数字；标“推算”的是按均价成本从这段成交里算出的；
                      标“不完整”表示这段成交之前就已有持仓（按现持仓倒推），那部分成本未知，数字仅供参考。
                    </p>
                    <Rows
                      search="搜索标的"
                      pick={{ column: 1, label: "账户" }}
                      headers={[
                        "标的",
                        "账户",
                        "买入量 / 均价",
                        "卖出量 / 均价",
                        "期内净持仓 / 成本",
                        "已实现盈亏",
                        "手续费",
                        "首笔 – 末笔",
                      ]}
                      rows={(trades?.summary ?? []).map((row) => [
                        row.instrument,
                        privateText(row.account),
                        sortable(
                          `${privateText(plain(row.bought))} @ ${plain(row.average_buy)}`,
                          row.bought,
                        ),
                        sortable(
                          `${privateText(plain(row.sold))} @ ${plain(row.average_sell)}`,
                          row.sold,
                        ),
                        sortable(
                          `${privateText(plain(row.net_position))} @ ${plain(row.average_cost)}`,
                          row.net_position,
                        ),
                        sortable(
                          hidden
                            ? "••••"
                            : `${amount(row.realized, row.quote)}（${
                                row.basis === "source"
                                  ? "平台"
                                  : row.basis === "computed"
                                    ? "推算"
                                    : `不完整，期初约 ${plain(row.opening_position)}`
                              }）`,
                          row.realized,
                        ),
                        sortable(privateText(plain(row.fees)), row.fees),
                        {
                          text: `${date(row.first).slice(0, 10)} – ${date(row.last).slice(0, 10)}`,
                          sort: row.last,
                        },
                      ])}
                    />
                  </>
                )}
                {flow === "成交" && (
                  <>
                    <p className="text-muted-foreground mb-4 text-sm">
                      共 {trades?.total ?? 0} 笔成交，已载入最近 {trades?.fills.length ?? 0} 笔。
                      合约的数量单位以平台为准（OKX 为张）。
                    </p>
                    <Rows
                      headers={[
                        "时间",
                        "账户",
                        "标的",
                        "方向",
                        "数量",
                        "成交价",
                        "手续费",
                        "平台盈亏",
                      ]}
                      search="搜索标的或账户"
                      pick={{ column: 3, label: "方向" }}
                      rows={(trades?.fills ?? []).map((fill) => [
                        { text: date(fill.occurred_at), sort: fill.occurred_at },
                        privateText(fill.account),
                        fill.asset,
                        fill.amount.startsWith("-") ? "卖出" : "买入",
                        sortable(
                          privateText(plain(fill.amount.replace("-", ""))),
                          fill.amount.replace("-", ""),
                        ),
                        sortable(`${plain(fill.price)} ${fill.quote}`, fill.price),
                        sortable(privateText(plain(fill.fee)), fill.fee),
                        fill.pnl == null
                          ? "—"
                          : sortable(hidden ? "••••" : amount(fill.pnl, fill.quote), fill.pnl),
                      ])}
                    />
                  </>
                )}
                {flow === "资金" && (
                  <>
                    <p className="text-muted-foreground mb-4 text-sm">
                      {context?.reconciliation.activity_window}。币种变动不等于已实现收益。
                    </p>
                    <Rows
                      headers={["时间", "账户", "类型", "资产", "变动数量", "费用"]}
                      rows={(context?.recent_events ?? []).map((event) => [
                        date(event.occurred_at),
                        privateText(name(event.connection_id)),
                        eventNames[event.kind] ?? event.kind,
                        event.asset,
                        privateText(event.amount),
                        privateText(event.fee),
                      ])}
                    />
                  </>
                )}
              </>
            )}
            {tab === "待处理事项" && (
              <div className="space-y-4">
                <p className="text-muted-foreground text-sm">
                  同步失败、快照过期、覆盖不完整或被排除的账户会列在这里；每天的净值变化见“资产曲线”。
                </p>
                {(context?.overview.issues ?? []).length === 0 && (
                  <p className="py-6 text-center text-sm">所有账户同步正常，没有待处理项。</p>
                )}
                {(context?.overview.issues ?? []).length > 0 && (
                  <Rows
                    headers={["账户", "待处理项"]}
                    rows={(context?.overview.issues ?? []).map((issue) => [
                      privateText(name(issue.connection_id)),
                      issues[issue.reason] ?? "数据覆盖需要核验",
                    ])}
                  />
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <footer className="text-muted-foreground flex flex-wrap justify-between gap-3 text-xs">
          <span>页面更新时间：{date(context?.overview.as_of)}</span>
          <a
            href="https://github.com/0x43e96f/wealthfolio/tree/feature/mobiquant-portfolio-v3.9.1"
            target="_blank"
            rel="noopener noreferrer"
          >
            基于 Wealthfolio · AGPL-3.0 · 查看源码
          </a>
        </footer>
      </div>
    </main>
  );
}
