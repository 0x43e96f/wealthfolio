import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
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
  saveCashout,
  type Finance,
  type Period,
} from "./client";

const tabs = [
  "资产总览",
  "资产曲线",
  "财务全景",
  "资产分布",
  "持仓明细",
  "衍生品",
  "收益",
  "交易流水",
  "待处理事项",
] as const;
const units = ["USD", "CAD", "CNY", "HKD"] as const;
const bars = [
  ["1h", "1 小时"],
  ["4h", "4 小时"],
  ["1d", "日"],
  ["1M", "月"],
] as const;
const denominations: Record<string, string> = {
  CNY: "人民币资产",
  HKD: "港元资产",
  USD: "美元资产",
  CAD: "加元资产",
  stablecoin: "稳定币（U）",
  crypto: "加密货币（非稳定币）",
  unknown: "未注明币种",
};
const places: Record<string, string> = {
  china: "中国账户",
  canada: "加拿大",
  hongkong: "香港（富途与香港银行）",
  ibkr: "IBKR",
  usd: "美元账户",
  card: "刷卡消费",
  subscription: "会员与订阅",
};
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
// The curve with a window onto it. Scrolling up over the chart zooms in around
// the pointer and scrolling down zooms out; the arrows move the window along.
function Trend({
  points,
  money,
}: {
  points: History["points"];
  money: (value: string | null | undefined) => string;
}) {
  const [range, setRange] = useState<[number, number] | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const total = points.length;
  const [from, to] = range && range[1] < total ? range : [0, total - 1];
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    // Registered by hand: the page must not scroll while the chart is zoomed,
    // and React's own wheel listener is not allowed to prevent that.
    const wheel = (event: WheelEvent) => {
      if (total < 4) return;
      event.preventDefault();
      const box = node.getBoundingClientRect();
      const ratio = box.width
        ? Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
        : 0.5;
      setRange((current) => {
        const [a, b] = current && current[1] < total ? current : [0, total - 1];
        const size = b - a;
        const next = Math.max(
          2,
          Math.min(total - 1, Math.round(size * (event.deltaY < 0 ? 0.8 : 1.25))),
        );
        if (next >= total - 1) return null;
        const start = Math.max(
          0,
          Math.min(total - 1 - next, Math.round(a + ratio * size - ratio * next)),
        );
        return [start, start + next];
      });
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [total]);
  const shift = (direction: number) =>
    setRange((current) => {
      if (!current) return current;
      const size = current[1] - current[0];
      const start = Math.max(
        0,
        Math.min(total - 1 - size, current[0] + direction * Math.max(1, Math.round(size / 3))),
      );
      return [start, start + size];
    });
  // Dragging moves the window: the curve follows the pointer, so dragging right
  // brings earlier days into view.
  const grip = useRef<{ x: number; start: number } | null>(null);
  const hold = (clientX: number) => {
    if (range) grip.current = { x: clientX, start: range[0] };
  };
  const pull = (clientX: number) => {
    const held = grip.current;
    const width = frame.current?.getBoundingClientRect().width;
    if (!held || !range || !width) return;
    const size = range[1] - range[0];
    const start = Math.max(
      0,
      Math.min(total - 1 - size, held.start - Math.round(((clientX - held.x) / width) * size)),
    );
    if (start !== range[0]) setRange([start, start + size]);
  };
  const release = () => {
    grip.current = null;
  };
  if (!total) return null;
  return (
    <div
      ref={frame}
      className={range ? "cursor-grab select-none active:cursor-grabbing" : undefined}
      onMouseDown={(event) => hold(event.clientX)}
      onMouseMove={(event) => pull(event.clientX)}
      onMouseUp={release}
      onMouseLeave={release}
      onTouchStart={(event) => hold(event.touches[0].clientX)}
      onTouchMove={(event) => pull(event.touches[0].clientX)}
      onTouchEnd={release}
    >
      <TrendView points={points.slice(from, to + 1)} money={money} />
      <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
        {range ? (
          <>
            <span>
              已放大：{points[from].date} 至 {points[to].date} · 按住图表左右拖动
            </span>
            <button type="button" className="underline" onClick={() => shift(-1)}>
              ← 往前
            </button>
            <button type="button" className="underline" onClick={() => shift(1)}>
              往后 →
            </button>
            <button type="button" className="underline" onClick={() => setRange(null)}>
              看全部
            </button>
          </>
        ) : (
          total > 3 && <span>在图上向上滚动放大，向下滚动缩小；放大后可以按住拖动。</span>
        )}
      </div>
    </div>
  );
}

function TrendView({
  points,
  money,
}: {
  points: History["points"];
  money: (value: string | null | undefined) => string;
}) {
  const [at, setAt] = useState<number | null>(null);
  // The drawing is as wide as the space it is given. It was a fixed 800 by 260 scaled to fit the height, so in
  // a card wider than that the curve sat in the middle with a quarter of the card empty on either side, the
  // dates under it stood at the card's edges and not under its ends, and the reading followed the pointer's
  // place in the card and not the point under it.
  const drawing = useRef<SVGSVGElement>(null);
  const [{ width, height }, setSize] = useState({ width: 800, height: 260 });
  useLayoutEffect(() => {
    const node = drawing.current;
    if (!node) return;
    const fit = () => {
      const box = node.getBoundingClientRect();
      const wide = Math.round(box.width);
      const tall = Math.round(box.height);
      if (!wide || !tall) return; // not laid out (hidden, or a test without a layout): keep the last size
      setSize((size) =>
        size.width === wide && size.height === tall ? size : { width: wide, height: tall },
      );
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(fit);
    watch.observe(node);
    return () => watch.disconnect();
  }, []);
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
  const shown = Math.min(at ?? points.length - 1, points.length - 1);
  const point = points[shown];
  const move = (event: PointerMove<SVGSVGElement> | FingerMove<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const clientX = "touches" in event ? event.touches[0]?.clientX : event.clientX;
    if (clientX == null || !box.width) return;
    // The point drawn nearest the pointer: the same arithmetic as x(), the other way round.
    const drawn = ((clientX - box.left) / box.width) * width;
    const ratio = Math.min(1, Math.max(0, (drawn - pad) / (width - 2 * pad)));
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
        ref={drawing}
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
        <circle cx={x(shown)} cy={y(values[shown])} r="5" fill="#2563eb" stroke="var(--card)" />
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
  // Clicking a slice holds it, so the pointer can cross other slices on its way
  // to the list without changing what is shown; clicking it again lets go.
  const [held, setHeld] = useState<string | null>(null);
  const hold = (name: string) => setHeld((current) => (current === name ? null : name));
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
  const shown = held ?? over;
  const current = arcs.find((arc) => arc.label === shown);
  return (
    <div
      className="grid items-start gap-8 md:grid-cols-[14rem_minmax(0,22rem)_minmax(0,1fr)]"
      onMouseLeave={() => setOver(null)}
    >
      <svg viewBox="0 0 200 200" className="size-56 shrink-0" role="img" aria-label={label}>
        {arcs.map((arc) => (
          <path
            key={arc.label}
            d={arc.path}
            fill={arc.color}
            stroke="var(--card)"
            strokeWidth="1"
            opacity={shown && shown !== arc.label ? 0.35 : 1}
            className="cursor-pointer"
            onMouseEnter={() => setOver(arc.label)}
            onClick={() => hold(arc.label)}
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
                (shown === arc.label ? "bg-muted" : "")
              }
              aria-pressed={held === arc.label}
              onMouseEnter={() => setOver(arc.label)}
              onFocus={() => setOver(arc.label)}
              onClick={() => hold(arc.label)}
            >
              <span className="inline-block size-3 rounded-sm" style={{ background: arc.color }} />
              <span className="w-28">{arc.label}</span>
              <span className="w-16 tabular-nums">{percent(arc.share)}</span>
              <span className="text-muted-foreground tabular-nums">{arc.value}</span>
            </button>
          </li>
        ))}
      </ul>
      {/* A fixed height: what is listed here must never move the page, or the
          slice under the pointer changes and the reading flickers. */}
      <div className="border-border h-72 overflow-y-auto rounded-lg border p-3 text-sm">
        {current ? (
          <>
            <p className="mb-2 font-medium">
              {current.label} · {percent(current.share)} · {current.value}
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                {held === current.label ? "已固定 · 再点一次取消" : "点击可固定"}
              </span>
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
          <p className="text-muted-foreground">
            把鼠标移到某一块或某一行上查看它包含什么；点击可以固定住，再慢慢看右边的明细。
          </p>
        )}
      </div>
    </div>
  );
}

export function Portfolio() {
  const [context, setContext] = useState<Context | null>(null);
  const [ledger, setLedger] = useState<LedgerStatus | null>(null); // null until its status has been read
  const [history, setHistory] = useState<History | null>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]>("资产总览");
  const [hidden, setHidden] = useState(false);
  const [dust, setDust] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [opened, setOpened] = useState<string | null>(null);
  const [trades, setTrades] = useState<Trades | null>(null);
  const [yields, setYields] = useState<Yields | null>(null);
  const [finance, setFinance] = useState<Finance | null>(null);
  const [line, setLine] = useState<"net" | "generated">("net");
  const [entry, setEntry] = useState({ day: "", place: "", usd: "", destination: "china" });
  const [bar, setBar] = useState<(typeof bars)[number][0]>("1d");
  const [curve, setCurve] = useState<History | null>(null);
  // The curve's own reading, at whichever bar size is chosen. The daily series
  // loaded with the page already serves the daily view.
  useEffect(() => {
    if (bar === "1d") {
      setCurve(null);
      return;
    }
    const current = new AbortController();
    readAsset<History>(`history?interval=${bar}`, current.signal)
      .then((found) => {
        if (Array.isArray(found.points)) setCurve(found);
      })
      .catch(() => undefined);
    return () => current.abort();
  }, [bar, context?.overview.as_of]);
  const [flow, setFlow] = useState<"汇总" | "成交" | "资金">("汇总");
  // The trade ledger is a year of fills (2.7 MB of them by October 2026) and only the 交易流水 tab shows it.
  // It was read with every opening of the page; it is read when that tab is opened, and again after each
  // refresh while the tab is in front.
  const [round, setRound] = useState(0); // refreshes of the page that succeeded
  const tradesRound = useRef(0); // the refresh the trades on screen were read after
  const [tradesBusy, setTradesBusy] = useState(false);
  const [tradesError, setTradesError] = useState("");
  useEffect(() => {
    if (tab !== "交易流水" || round === 0 || tradesRound.current === round) return;
    let left = false;
    const current = new AbortController();
    const timeout = window.setTimeout(() => current.abort(), 20_000);
    setTradesBusy(true);
    setTradesError("");
    readAsset<Trades>("trades?days=365", current.signal)
      .then((deals) => {
        if (left) return;
        if (!Array.isArray(deals.fills)) throw new Error("Invalid trades");
        setTrades(deals);
        tradesRound.current = round;
      })
      .catch(() => {
        if (!left) setTradesError("成交没有读到，点“刷新”再试一次。");
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (!left) setTradesBusy(false);
      });
    return () => {
      left = true;
      window.clearTimeout(timeout);
      current.abort();
    };
  }, [tab, round]);
  const [unit, setUnit] = useState<(typeof units)[number]>("USD");
  const [split, setSplit] = useState<"大类" | "币种" | "平台" | "合并">("大类");
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
      // The page is drawn from what its first screen shows: the context and the daily curve. The ledger's
      // status (one line of the header), the yields and the long view (other tabs) are read alongside and put
      // in place when they arrive. All five were awaited together, so whichever was slowest held the figures
      // back: the 0.1 KB ledger status, when it happened to need a new connection to the asset server, took
      // 1.0 s where the context had arrived in 0.4 s, and one that hung would have left the page empty.
      const first = Promise.all([
        readAsset<Context>("context", current.signal),
        readAsset<History>("history", current.signal).catch(() => null),
      ]).then(([data, past]) => {
        if (!Array.isArray(data.overview?.accounts) || !Array.isArray(data.recent_events))
          throw new Error("Invalid asset context");
        return [data, past] as const;
      });
      // Nothing of a round is shown before its context, or without it.
      const beside = <T,>(reading: Promise<T>, keep: (found: T) => void) =>
        Promise.all([reading, first]).then(
          ([found]) => {
            if (!current.signal.aborted) keep(found);
          },
          () => undefined,
        );
      const rest = Promise.all([
        beside(
          readAsset<LedgerStatus>("wealthfolio/status", current.signal).catch(() => ({
            available: false,
          })),
          setLedger,
        ),
        beside(readAsset<Yields>("yields", current.signal), (income) => {
          if (Array.isArray(income.rows)) setYields(income);
        }),
        beside(readAsset<Finance>("finance", current.signal), (long) => {
          if (Array.isArray(long.points)) setFinance(long);
        }),
      ]);
      const [data, past] = await first;
      if (current.signal.aborted) return;
      setContext(data);
      if (past && Array.isArray(past.points)) setHistory(past);
      setRound((count) => count + 1);
      await rest; // "刷新中" until the rest is in as well
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
  const addCashout = async () => {
    try {
      await saveCashout({ ...entry, usd: entry.usd.replace(/,/g, "").trim() });
      setEntry({ day: "", place: "", usd: "", destination: entry.destination });
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "保存失败");
    }
  };
  // The long curve reuses the balance chart: one reading per day that has one.
  const longLine = (finance?.points ?? []).map((point, index, all) => {
    const value = line === "net" ? point.net_usd : point.generated_usd;
    const before = index
      ? line === "net"
        ? all[index - 1].net_usd
        : all[index - 1].generated_usd
      : null;
    return {
      date: point.date,
      net_usd: value,
      valued_accounts: 1,
      complete: true,
      change_usd: before == null ? null : String(Math.round(Number(value) - Number(before))),
      change_pct: null,
    };
  });
  const result = (row: Period) =>
    row.result_usd == null
      ? "—"
      : sortable(money(row.result_usd) + (row.basis_changed ? " *" : ""), row.result_usd);
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
  const plotted = bar === "1d" ? trend : (curve?.points ?? []);
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
  // The table keeps a wallet token apart from the exchange coin of the same name,
  // since a contract can call itself anything. For this chart a stablecoin or a
  // major coin that has passed that check counts as one asset wherever it sits.
  const combined = new Map<string, (typeof merged)[number]>();
  for (const row of merged) {
    if (small(row.usd)) continue;
    const key =
      row.class === "stablecoin" || row.class === "major" ? row.symbol.toUpperCase() : row.asset;
    const held = combined.get(key);
    combined.set(
      key,
      held
        ? {
            ...held,
            usd: String(Number(held.usd) + Number(row.usd)),
            share: String(Number(held.share ?? 0) + Number(row.share ?? 0)),
            sources: [...held.sources, ...row.sources],
          }
        : row,
    );
  }
  const ranked = [...combined.values()].sort((a, b) => Number(b.usd) - Number(a.usd));
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
          {ledger === null
            ? "Wealthfolio 账本状态读取中"
            : ledger.available
              ? "Wealthfolio 账本已连接"
              : "Wealthfolio 账本暂不可用"}
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
                <div className="flex flex-wrap gap-2">
                  {bars.map(([value, title]) => (
                    <Button
                      key={value}
                      size="sm"
                      variant={bar === value ? "default" : "outline"}
                      onClick={() => setBar(value)}
                    >
                      {title}
                    </Button>
                  ))}
                </div>
                {plotted.length > 0 && !hidden && <Trend points={plotted} money={money} />}
                <Rows
                  headers={["时间", "净资产", "较前一期", "涨跌幅", "计入账户"]}
                  rows={[...plotted]
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
            {tab === "财务全景" && (
              <div className="space-y-8">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  {(
                    [
                      ["加密资产现值", money(finance?.points[finance.points.length - 1]?.net_usd)],
                      ["累计出金", money(finance?.cashout_total_usd)],
                      [
                        "累计创造（现值 + 出金）",
                        money(finance?.points[finance.points.length - 1]?.generated_usd),
                      ],
                      ["出金后仍在各账户里的", money(finance?.kept_usd)],
                    ] as const
                  ).map(([title, value]) => (
                    <div key={title}>
                      <p className="text-muted-foreground text-xs">{title}</p>
                      <p className="text-xl font-semibold tabular-nums">{value}</p>
                    </div>
                  ))}
                </div>
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="mr-2 text-sm font-medium">加密资产 · 2021 年至今</h3>
                    {(
                      [
                        ["net", "净值"],
                        ["generated", "净值 + 累计出金"],
                      ] as const
                    ).map(([value, title]) => (
                      <Button
                        key={value}
                        size="sm"
                        variant={line === value ? "default" : "outline"}
                        onClick={() => setLine(value)}
                      >
                        {title}
                      </Button>
                    ))}
                  </div>
                  {longLine.length > 0 && !hidden && <Trend points={longLine} money={money} />}
                  <p className="text-muted-foreground text-xs">
                    {finance?.note}
                    “净值 + 累计出金”把取走的钱加回去，看的是加密这边一共创造了多少。
                  </p>
                </section>
                <section>
                  <h3 className="mb-3 text-sm font-medium">按年</h3>
                  <Rows
                    headers={["年份", "年末净值", "当年出金", "净值变化", "当年盈亏"]}
                    rows={[...(finance?.yearly ?? [])]
                      .reverse()
                      .map((row) => [
                        row.period,
                        sortable(money(row.close_usd), row.close_usd),
                        sortable(money(row.cashout_usd), row.cashout_usd),
                        row.change_usd == null
                          ? "—"
                          : sortable(money(row.change_usd), row.change_usd),
                        result(row),
                      ])}
                  />
                </section>
                <section>
                  <h3 className="mb-3 text-sm font-medium">按月</h3>
                  <Rows
                    search="搜索月份，例如 2024"
                    headers={["月份", "月末净值", "当月出金", "净值变化", "当月盈亏"]}
                    rows={[...(finance?.monthly ?? [])]
                      .reverse()
                      .map((row) => [
                        row.period,
                        sortable(money(row.close_usd), row.close_usd),
                        sortable(money(row.cashout_usd), row.cashout_usd),
                        row.change_usd == null
                          ? "—"
                          : sortable(money(row.change_usd), row.change_usd),
                        result(row),
                      ])}
                  />
                  <p className="text-muted-foreground mt-2 text-xs">
                    盈亏 = 净值变化 +
                    当期出金：取走的钱是赚到的，不是亏掉的。没有记录的月份不显示。带 *
                    的那一期跨越了手工记录和自动同步的交接，两边统计的钱包不完全相同，数字不可比。
                  </p>
                </section>
                <section>
                  <h3 className="mb-3 text-sm font-medium">出金去了哪里</h3>
                  <Pie
                    label="出金去向"
                    rows={(finance?.destinations ?? []).map((row) => ({
                      label: places[row.destination] ?? row.destination,
                      value: money(row.moved_usd),
                      share: row.share,
                      detail: row.places.map((item) => `${item.place} · ${money(item.usd)}`),
                    }))}
                  />
                </section>
                <section>
                  <h3 className="mb-3 text-sm font-medium">转过去的钱，现在还剩多少</h3>
                  <Rows
                    headers={["去向", "累计转入", "现在的余额", "差额"]}
                    rows={(finance?.destinations ?? []).map((row) => [
                      places[row.destination] ?? row.destination,
                      sortable(money(row.moved_usd), row.moved_usd),
                      row.held_usd == null ? "已花掉" : sortable(money(row.held_usd), row.held_usd),
                      row.difference_usd == null
                        ? sortable(money("-" + row.moved_usd), -Number(row.moved_usd))
                        : sortable(money(row.difference_usd), row.difference_usd),
                    ])}
                  />
                  <p className="text-muted-foreground mt-2 text-xs">
                    差额是这些年在当地的开销加上那里的投资盈亏，两者从这些数字里分不开。现在的余额随汇率和行情变动。
                  </p>
                </section>
                <section>
                  <h3 className="mb-3 text-sm font-medium">各年出金去向</h3>
                  <Rows
                    headers={["年份", ...Object.keys(places).map((key) => places[key])]}
                    rows={[...(finance?.by_year ?? [])]
                      .reverse()
                      .map((row) => [
                        row.year,
                        ...Object.keys(places).map((key) =>
                          row[key] ? sortable(money(row[key]), row[key]) : "—",
                        ),
                      ])}
                  />
                </section>
                <section>
                  <h3 className="mb-3 text-sm font-medium">记一笔新的出金</h3>
                  <div className="flex flex-wrap items-end gap-2 text-sm">
                    <input
                      type="date"
                      aria-label="出金日期"
                      value={entry.day}
                      onChange={(event) => setEntry({ ...entry, day: event.target.value })}
                      className="border-input bg-background h-9 rounded-md border px-2"
                    />
                    <input
                      aria-label="经由"
                      placeholder="经由（如 okx、bylls）"
                      value={entry.place}
                      onChange={(event) => setEntry({ ...entry, place: event.target.value })}
                      className="border-input bg-background h-9 w-44 rounded-md border px-2"
                    />
                    <input
                      aria-label="美元金额"
                      placeholder="美元金额"
                      inputMode="decimal"
                      value={entry.usd}
                      onChange={(event) => setEntry({ ...entry, usd: event.target.value })}
                      className="border-input bg-background h-9 w-32 rounded-md border px-2"
                    />
                    <select
                      aria-label="去向"
                      value={entry.destination}
                      onChange={(event) => setEntry({ ...entry, destination: event.target.value })}
                      className="border-input bg-background h-9 rounded-md border px-2"
                    >
                      {Object.entries(places).map(([key, title]) => (
                        <option key={key} value={key}>
                          {title}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={!entry.day || !entry.place || !entry.usd}
                      onClick={() => void addCashout()}
                    >
                      保存
                    </Button>
                  </div>
                </section>
              </div>
            )}
            {tab === "资产分布" && (
              <div className="space-y-8">
                <div className="flex flex-wrap gap-2">
                  {(["大类", "币种", "平台", "合并"] as const).map((item) => (
                    <Button
                      key={item}
                      size="sm"
                      variant={split === item ? "default" : "outline"}
                      onClick={() => setSplit(item)}
                    >
                      {item === "大类"
                        ? "按大类"
                        : item === "币种"
                          ? "按币种"
                          : item === "平台"
                            ? "按平台"
                            : "跨账户合并持仓"}
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
                {split === "币种" && (
                  <section>
                    <h3 className="mb-3 text-sm font-medium">
                      按币种 · 各国货币资产、稳定币与其他加密货币
                    </h3>
                    <Pie
                      label="币种占比"
                      rows={(allocation?.by_denomination ?? []).map((row) => ({
                        label: denominations[row.denomination] ?? `${row.denomination} 资产`,
                        value: money(row.usd),
                        share: row.share,
                        detail: [
                          ...row.classes.map(
                            (part) =>
                              `${classes[part.class] ?? part.class}合计 · ${money(part.usd)}`,
                          ),
                          "——",
                          ...row.items
                            .filter((item) => !small(item.usd))
                            .map((item) => `${item.symbol} · ${money(item.usd)}`),
                        ],
                      }))}
                    />
                    <p className="text-muted-foreground mt-3 text-xs">
                      美元、港元、人民币、加元资产包含该币种的现金、股票和基金，都已折成美元显示；
                      稳定币和其他加密货币单独成类，不计入美元资产。
                    </p>
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
                {flow !== "资金" && tradesBusy && (
                  <p role="status" className="text-muted-foreground mb-4 text-sm">
                    {trades ? "正在读取最新的成交…" : "正在读取近一年的成交…"}
                  </p>
                )}
                {flow !== "资金" && tradesError && (
                  <p
                    role="alert"
                    className="border-destructive text-destructive mb-4 rounded-lg border p-3 text-sm"
                  >
                    {tradesError}
                  </p>
                )}
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
