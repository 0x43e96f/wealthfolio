import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { usd } from "./client";
import { cents, decimal, decimalSum, negate } from "./attribution-money";

interface Contribution {
  connection_id: string;
  account: string;
  source_asset: string;
  price_effect_usd: string | null;
  quantity_effect_usd: string | null;
  change_pct: string | null;
  activity_count: number;
  reason: string;
}
export interface Attribution {
  start: string;
  end: string;
  price_effect_usd: string;
  quantity_effect_usd: string;
  gains_usd: string;
  losses_usd: string;
  unmatched_movements: number;
  internal_transfers: unknown[];
  account_transfers: number;
  basis_changed: boolean;
  partial: boolean;
  comparable_accounts: number;
  counted_accounts: number;
  truncated: boolean;
  assets: {
    asset: string;
    symbol: string;
    price_effect_usd: string | null;
    quantity_effect_usd: string | null;
    partial: boolean;
    accounts: Contribution[];
  }[];
  accounts: {
    connection_id: string;
    account: string;
    observed_start: string | null;
    observed_end: string | null;
    observed_change_usd: string | null;
    price_effect_usd: string | null;
    quantity_effect_usd: string | null;
    unexplained_usd: string | null;
    reasons: string[];
  }[];
  note: string;
}

/** A change under this many dollars is not listed: the owner asked for the moves, not the dust. */
export const FLOOR = 10;
const COLUMNS = "grid grid-cols-[minmax(0,1fr)_6.5rem_3.25rem_5.5rem] items-center gap-3";

const size = (value: unknown) => (decimal(value) == null ? 0 : Math.abs(Number(value)));
const listed = (...values: unknown[]) => values.some((value) => size(value) >= FLOOR);
const day = (value: string) =>
  Number.isNaN(new Date(value).getTime())
    ? null
    : new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Vancouver",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(value));
const stamp = (value: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN", { timeZone: "America/Vancouver" }) : "缺少快照";
const clock = (value: string) =>
  Number.isNaN(new Date(value).getTime())
    ? "—"
    : new Intl.DateTimeFormat("zh-CN", {
        timeZone: "America/Vancouver",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value));

export function AttributionPanel({
  data,
  hidden,
  date,
  total,
  close,
}: {
  data: Attribution;
  hidden: boolean;
  date: string | null;
  total: string | null;
  close: string | null;
}) {
  const [filter, setFilter] = useState("all");
  const money = (value: unknown) => (hidden ? "••••" : usd(decimal(value)));
  const signed = (value: unknown) =>
    hidden ? "••••" : `${Number(decimal(value)) > 0 ? "+" : ""}${usd(decimal(value))}`;
  // Manual crypto symbols can themselves be private account names.
  const name = (value: string) => (hidden ? "••••" : value);
  const tone = (value: unknown) =>
    hidden || decimal(value) == null
      ? ""
      : Number(value) < 0
        ? "text-destructive"
        : Number(value) > 0
          ? "text-success"
          : "";
  const sameDay = date === day(data.start);
  const opening = sameDay ? decimalSum([close, negate(total)]) : null;
  const share = (value: string | null) => {
    if (hidden || decimal(value) == null || opening == null || Number(opening) === 0) return null;
    const points = (Number(value) / Math.abs(Number(opening))) * 100;
    return Math.abs(points) < 0.005 ? null : `${points > 0 ? "+" : ""}${points.toFixed(2)}%`;
  };
  const residual = sameDay
    ? decimalSum([
        cents(total),
        negate(cents(data.price_effect_usd)),
        negate(cents(data.quantity_effect_usd)),
      ])
    : null;
  const rows = data.assets
    .filter((row) => filter === "all" || row.accounts.some((part) => part.connection_id === filter))
    .map((row) => {
      const parts = row.accounts.filter(
        (part) => filter === "all" || part.connection_id === filter,
      );
      const known = parts.filter((part) => part.price_effect_usd != null);
      const moved = parts.filter((part) => listed(part.price_effect_usd, part.quantity_effect_usd));
      return {
        ...row,
        // Several small parts can add up to a listed row; then all of them are its breakdown.
        accounts: moved.length ? moved : parts,
        partial: parts.some((part) => part.price_effect_usd == null),
        price_effect_usd: decimalSum(known.map((part) => part.price_effect_usd)),
        quantity_effect_usd: decimalSum(known.map((part) => part.quantity_effect_usd)),
      };
    });
  const shown = rows
    .filter((row) => listed(row.price_effect_usd, row.quantity_effect_usd))
    .sort(
      (one, two) =>
        size(two.price_effect_usd) - size(one.price_effect_usd) ||
        size(two.quantity_effect_usd) - size(one.quantity_effect_usd),
    );
  const largest = Math.max(0, ...shown.map((row) => size(row.price_effect_usd)));
  const accounts = data.accounts.filter(
    (row) =>
      (filter === "all" || row.connection_id === filter) &&
      listed(row.observed_change_usd, row.unexplained_usd),
  );
  const faint = <span className="text-muted-foreground/50 font-normal">—</span>;
  const up = size(data.gains_usd);
  const down = size(data.losses_usd);
  return (
    <section aria-label="今日变化归因" className="flex min-h-0 flex-col text-sm">
      <header className="shrink-0 space-y-3 px-5 pb-4 pt-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-muted-foreground text-xs font-medium tracking-wide">
            今日净值变化明细
          </h3>
          <p className="text-muted-foreground text-xs tabular-nums">{clock(data.end)} 更新</p>
        </div>
        <div>
          <p className="sr-only">净值变化</p>
          <p className={`text-3xl font-semibold tabular-nums tracking-tight ${tone(total)}`}>
            {signed(total)}
          </p>
        </div>
        {!hidden && up + down > 0 && (
          <div aria-hidden className="bg-muted flex h-1.5 gap-0.5 overflow-hidden rounded-full">
            <span className="bg-success min-w-1 rounded-full" style={{ flexGrow: up }} />
            <span className="bg-destructive min-w-1 rounded-full" style={{ flexGrow: down }} />
          </div>
        )}
        <div className="flex justify-between gap-3 text-xs tabular-nums">
          <p>
            <span className="text-muted-foreground">上涨 </span>
            <span className={tone(data.gains_usd)}>{signed(data.gains_usd)}</span>
          </p>
          <p>
            <span className="text-muted-foreground">下跌 </span>
            <span className={tone(data.losses_usd)}>{signed(data.losses_usd)}</span>
          </p>
        </div>
        {!sameDay && (
          <p role="status" className="text-warning text-xs">
            卡片是 {date ?? "尚未生成"} 的日线，明细是 {day(data.start) ?? "未知"}{" "}
            的快照（温哥华）；日期对齐前不算差额和占比。
          </p>
        )}
      </header>
      <div className="bg-muted/40 grid shrink-0 grid-cols-3 divide-x border-y">
        {[
          ["价格影响", data.price_effect_usd, "持仓涨跌"],
          ["数量影响", data.quantity_effect_usd, "买卖和转入转出"],
          ["其余差额", residual, "没法算到单个资产的部分"],
        ].map(([label, value, meaning]) => (
          <div key={label} className="px-5 py-3">
            <p className="text-muted-foreground text-xs">{label}</p>
            <p className={`mt-1 font-medium tabular-nums ${tone(value)}`}>{signed(value)}</p>
            <p className="text-muted-foreground mt-1 text-[11px]">{meaning}</p>
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="bg-popover sticky top-0 z-10 px-5 pb-2 pt-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium">
              主要变动
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                共 {shown.length} 项
              </span>
            </p>
            <select
              aria-label="归因账户"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="text-muted-foreground hover:text-foreground max-w-44 cursor-pointer truncate rounded-md border bg-transparent px-2 py-1 text-xs"
            >
              <option value="all">全部账户</option>
              {data.accounts.map((row) => (
                <option key={row.connection_id} value={row.connection_id}>
                  {name(row.account)}
                </option>
              ))}
            </select>
          </div>
          <div className={`${COLUMNS} text-muted-foreground mt-3 text-right text-[11px]`}>
            <span className="whitespace-nowrap pl-6 text-left">资产</span>
            <span>价格影响</span>
            <span>占净值</span>
            <span>数量影响</span>
          </div>
        </div>
        <div className="space-y-0.5 px-2 pb-2">
          {shown.map((row) => (
            <details key={row.asset} className="group">
              <summary
                className={`${COLUMNS} hover:bg-muted/60 relative cursor-pointer list-none overflow-hidden rounded-md px-3 py-2 text-right tabular-nums [&::-webkit-details-marker]:hidden`}
              >
                {!hidden && largest > 0 && listed(row.price_effect_usd) && (
                  <span
                    aria-hidden
                    className={`bg-linear-to-r absolute inset-y-0 left-0 min-w-1 to-transparent ${Number(row.price_effect_usd) < 0 ? "from-destructive/25" : "from-success/25"}`}
                    style={{ width: `${(size(row.price_effect_usd) / largest) * 100}%` }}
                  />
                )}
                <p className="relative flex min-w-0 items-center gap-2 text-left">
                  <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90" />
                  <span className="truncate font-medium" title={name(row.symbol)}>
                    {name(row.symbol)}
                  </span>
                  {row.partial && (
                    <span className="text-muted-foreground shrink-0 rounded border px-1 text-[10px]">
                      部分待核对
                    </span>
                  )}
                </p>
                <p className={`relative font-medium ${tone(row.price_effect_usd)}`}>
                  {listed(row.price_effect_usd) ? signed(row.price_effect_usd) : faint}
                </p>
                <p className="text-muted-foreground relative text-xs">
                  {share(row.price_effect_usd) ?? ""}
                </p>
                <p className="relative">
                  {listed(row.quantity_effect_usd) ? signed(row.quantity_effect_usd) : faint}
                </p>
              </summary>
              <div className="mb-2 ml-5 mt-1 space-y-2 border-l py-1 pl-4 pr-3 text-xs">
                {row.accounts.map((part) => (
                  <div
                    key={`${part.connection_id}:${part.source_asset}`}
                    className={`${COLUMNS} text-right tabular-nums`}
                  >
                    <div className="min-w-0 text-left">
                      <p className="truncate">{name(part.account)}</p>
                      <p className="text-muted-foreground truncate text-[11px]">
                        单价{" "}
                        {hidden
                          ? "••••"
                          : decimal(part.change_pct) == null
                            ? "—"
                            : `${Number(part.change_pct).toFixed(2)}%`}
                        {part.activity_count > 0 && ` · ${part.activity_count} 笔活动`}
                        {part.reason && ` · ${part.reason}`}
                      </p>
                    </div>
                    <p className={tone(part.price_effect_usd)}>{signed(part.price_effect_usd)}</p>
                    <p />
                    <p>
                      {listed(part.quantity_effect_usd) ? signed(part.quantity_effect_usd) : faint}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          ))}
          {!shown.length && (
            <p className="text-muted-foreground px-3 py-6 text-center">
              没有超过 ${FLOOR} 的变动。
            </p>
          )}
        </div>
        <footer className="text-muted-foreground space-y-2 border-t px-5 py-3 text-xs">
          {rows.length > shown.length && (
            <p>
              另有 {rows.length - shown.length} 项不足 ${FLOOR} 或无法逐项比较，未列出。
            </p>
          )}
          <details>
            <summary className="hover:text-foreground cursor-pointer">账户与口径</summary>
            <div className="mt-2 space-y-2">
              <p>
                可比较 {data.comparable_accounts}/{data.counted_accounts} 个账户 · 明细更新于{" "}
                {stamp(data.end)}（温哥华）。{data.partial && "部分账户不可比，其变化留在差额。"}
                {data.basis_changed && "账户范围有变化。"}
              </p>
              {accounts.map((row) => (
                <div key={row.connection_id} className="border-t pt-2">
                  <p className="text-foreground tabular-nums">
                    {name(row.account)} · 资产增减 {money(row.observed_change_usd)} · 价格{" "}
                    {money(row.price_effect_usd)} · 数量 {money(row.quantity_effect_usd)} · 其余{" "}
                    {money(row.unexplained_usd)}
                  </p>
                  <p>
                    {stamp(row.observed_start)} → {stamp(row.observed_end)} ·{" "}
                    {row.reasons.join("；") || "快照可比较"}
                  </p>
                </div>
              ))}
              <p className="border-t pt-2">
                匹配到 {data.internal_transfers.length} 笔跨账户转账 · {data.account_transfers}{" "}
                笔账户内划转 · {data.unmatched_movements} 笔资金流去向未确认。
                {data.truncated && "活动超过读取上限，计数不完整。"}
              </p>
              <p>{data.note}净值变化含充值与提现；差额也包含卡片日线与账户观察时间的差异。</p>
            </div>
          </details>
        </footer>
      </div>
    </section>
  );
}
