import { useEffect, useRef, useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@wealthfolio/ui/components/ui/popover";
import { readAsset, usd } from "./client";
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
interface Attribution {
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

/** Hover, keyboard focus and touch all expose the same breakdown. */
export function DailyAttribution({
  asOf,
  hidden,
  date,
  total,
  close,
  children,
}: {
  asOf: string;
  hidden: boolean;
  date: string | null;
  total: string | null;
  close: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ asOf: string; data: Attribution | null; error: boolean }>({
    asOf,
    data: null,
    error: false,
  });
  const data = result.asOf === asOf ? result.data : null;
  const error = result.asOf === asOf && result.error;
  const pinned = useRef(false);
  const [filter, setFilter] = useState("all");
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const enter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    if (error && !open) setAttempt((value) => value + 1);
    setRequested(true);
    setOpen(true);
  };
  const pin = () => {
    pinned.current = true;
    enter();
  };
  const changeOpen = (value: boolean) => {
    if (!value) pinned.current = false;
    setOpen(value);
  };
  const leave = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      const focused = document.activeElement;
      if (
        !pinned.current &&
        !triggerRef.current?.contains(focused) &&
        !contentRef.current?.contains(focused)
      )
        setOpen(false);
    }, 200);
  };
  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    },
    [],
  );
  useEffect(() => {
    setResult({ asOf, data: null, error: false });
    setFilter("all");
    if (!requested || !asOf) return;
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    readAsset<Attribution>("attribution", controller.signal)
      .then((found) => {
        if (!Array.isArray(found.assets) || !Array.isArray(found.accounts))
          throw new Error("Invalid attribution");
        if (active && !controller.signal.aborted) setResult({ asOf, data: found, error: false });
      })
      .catch(() => {
        if (active) setResult({ asOf, data: null, error: true });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [asOf, requested, attempt]);
  const money = (value: unknown) => (hidden ? "••••" : usd(decimal(value)));
  // Manual crypto symbols can themselves be private account names.
  const name = (value: string) => (hidden ? "••••" : value);
  const tone = (value: string | null) =>
    hidden || value == null
      ? ""
      : Number(value) < 0
        ? "text-red-600"
        : Number(value) > 0
          ? "text-emerald-600"
          : "";
  const sameDay = data != null && date === day(data.start);
  const opening = sameDay ? decimalSum([close, negate(total)]) : null;
  const share = (value: string | null) => {
    if (hidden) return "••••";
    return decimal(value) != null && opening != null && Number(opening) !== 0
      ? `${((Number(value) / Math.abs(Number(opening))) * 100).toFixed(2)} 个百分点`
      : "—";
  };
  const residual =
    data && sameDay
      ? decimalSum([
          cents(total),
          negate(cents(data.price_effect_usd)),
          negate(cents(data.quantity_effect_usd)),
        ])
      : null;
  const shown =
    data?.assets
      .filter(
        (row) => filter === "all" || row.accounts.some((part) => part.connection_id === filter),
      )
      .map((row) => {
        const parts = row.accounts.filter(
          (part) => filter === "all" || part.connection_id === filter,
        );
        const known = parts.filter((part) => part.price_effect_usd != null);
        return {
          ...row,
          accounts: parts,
          partial: parts.some((part) => part.price_effect_usd == null),
          price_effect_usd: decimalSum(known.map((part) => part.price_effect_usd)),
          quantity_effect_usd: decimalSum(known.map((part) => part.quantity_effect_usd)),
        };
      })
      .sort(
        (one, two) =>
          Math.abs(Number(two.price_effect_usd)) - Math.abs(Number(one.price_effect_usd)),
      ) ?? [];
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger
        asChild
        onClick={(event) => {
          event.preventDefault();
          pin();
        }}
      >
        <div
          ref={triggerRef}
          role="button"
          tabIndex={0}
          aria-label="查看今日净值变化明细"
          className="cursor-pointer rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2"
          onMouseEnter={enter}
          onMouseLeave={leave}
          onFocus={enter}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              pin();
            }
          }}
        >
          {children}
        </div>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="end"
        collisionPadding={16}
        className="max-h-[min(75vh,var(--radix-popover-content-available-height))] w-[min(48rem,calc(100vw-2rem))] overflow-auto"
        onMouseEnter={enter}
        onMouseLeave={leave}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {error ? (
          <div role="status">
            今日明细未读取成功，移开后重新打开即可重试。
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => setAttempt((value) => value + 1)}
            >
              重试
            </button>
          </div>
        ) : !data ? (
          <p role="status">正在核对今日资产变化…</p>
        ) : (
          <section aria-label="今日变化归因" className="space-y-4">
            <h3 className="font-semibold">今日净值变化明细</h3>
            {!sameDay && (
              <p role="status" className="text-muted-foreground text-sm">
                卡片日线日期 {date ?? "尚未生成"}，快照明细日期 {day(data.start) ?? "未知"}
                （温哥华）。跨日后卡片可能仍保留上一日的读取结果；先显示可比较的快照价格与数量影响。日期对齐前，其余差额和对总资产贡献暂不计算。
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {[
                [sameDay ? "净值变化（同卡片）" : "卡片变化（日期未对齐）", total],
                ["价格影响", data.price_effect_usd],
                ["数量影响", data.quantity_effect_usd],
                ["其余差额", residual],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-muted-foreground text-xs">{label}</p>
                  <p className={`mt-1 font-semibold tabular-nums ${tone(value)}`}>{money(value)}</p>
                </div>
              ))}
            </div>
            <p className="text-sm">
              价格上涨贡献 {money(data.gains_usd)} · 下跌贡献 {money(data.losses_usd)}
            </p>
            <p className="text-muted-foreground text-xs">
              可比较 {data.comparable_accounts}/{data.counted_accounts} 个账户 · 明细更新时间{" "}
              {stamp(data.end)}（温哥华）。{data.partial && "部分账户不可比，其变化保留在差额。"}
              {data.basis_changed && "账户范围有变化。"}
            </p>
            <label className="text-sm">
              资产明细账户{" "}
              <select
                aria-label="归因账户"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                className="bg-background rounded border p-1"
              >
                <option value="all">全部账户</option>
                {data.accounts.map((row) => (
                  <option key={row.connection_id} value={row.connection_id}>
                    {name(row.account)}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-muted-foreground text-xs">
              总数始终为全部账户；筛选仅影响下方明细。
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    {["资产 / 账户", "价格影响", "对总资产贡献", "数量影响"].map((label) => (
                      <th key={label} className="p-2 font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr key={row.asset} className="border-t align-top">
                      <td className="p-2">
                        <details>
                          <summary className="cursor-pointer">
                            {name(row.symbol)}
                            {row.partial && "（部分待核对）"}
                          </summary>
                          {row.accounts.map((part) => (
                            <p
                              key={`${part.connection_id}:${part.source_asset}`}
                              className="text-muted-foreground mt-2 text-xs"
                            >
                              {name(part.account)}：价格 {money(part.price_effect_usd)} · 数量{" "}
                              {money(part.quantity_effect_usd)} · 单位估值变化{" "}
                              {hidden
                                ? "••••"
                                : decimal(part.change_pct) == null
                                  ? "—"
                                  : `${Number(part.change_pct).toFixed(2)}%`}
                              {part.activity_count > 0 && ` · 有 ${part.activity_count} 笔活动`}
                              {part.reason && ` · ${part.reason}`}
                            </p>
                          ))}
                        </details>
                      </td>
                      <td
                        className={`whitespace-nowrap p-2 tabular-nums ${tone(row.price_effect_usd)}`}
                      >
                        {money(row.price_effect_usd)}
                      </td>
                      <td className="whitespace-nowrap p-2">{share(row.price_effect_usd)}</td>
                      <td className="whitespace-nowrap p-2 tabular-nums">
                        {money(row.quantity_effect_usd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!shown.length && <p className="text-sm">暂无可比较持仓，请查看账户明细。</p>}
            <details>
              <summary className="cursor-pointer text-sm font-medium">账户明细与快照时间</summary>
              {data.accounts
                .filter((row) => filter === "all" || row.connection_id === filter)
                .map((row) => (
                  <div key={row.connection_id} className="mt-2 border-t pt-2 text-sm">
                    <p>
                      {name(row.account)} · 资产增减 {money(row.observed_change_usd)} · 价格{" "}
                      {money(row.price_effect_usd)} · 数量 {money(row.quantity_effect_usd)} · 其余{" "}
                      {money(row.unexplained_usd)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {stamp(row.observed_start)} → {stamp(row.observed_end)} ·{" "}
                      {row.reasons.join("；") || "快照可比较"}
                    </p>
                  </div>
                ))}
            </details>
            <p className="text-muted-foreground text-xs">
              匹配到 {data.internal_transfers.length} 笔跨账户转账 · {data.account_transfers}{" "}
              笔账户内划转 · {data.unmatched_movements} 笔资金流去向未确认。
              {data.truncated && "活动超过读取上限，计数不完整。"}
            </p>
            <p className="text-muted-foreground text-xs">
              {data.note}净值变化含充值与提现；差额也包含卡片日线与账户观察时间的差异。
            </p>
          </section>
        )}
      </PopoverContent>
    </Popover>
  );
}
