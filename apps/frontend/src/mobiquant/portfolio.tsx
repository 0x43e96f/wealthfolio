import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@wealthfolio/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@wealthfolio/ui/components/ui/card";
import { RefreshCw, ShieldCheck, Wallet, Eye, EyeOff } from "lucide-react";
import {
  ownedAccounts,
  percent,
  readAsset,
  usd,
  type Context,
  type History,
  type LedgerStatus,
} from "./client";

const tabs = ["资产总览", "资产分布", "持仓明细", "衍生品", "交易流水", "每日对账"] as const;
const classes: Record<string, string> = {
  btc: "BTC 类",
  eth: "ETH 类",
  stablecoin: "稳定币",
  other: "其他代币",
};
const providers: Record<string, string> = {
  binance: "Binance",
  okx: "OKX",
  bybit: "Bybit",
  debank: "EVM / DeBank",
  solana: "Solana",
};
const issues: Record<string, string> = {
  missing_or_stale_snapshot: "快照过期或尚未同步",
  incomplete_coverage: "资产覆盖不完整",
  duplicate_account: "重复账户已排除",
  account_identity_unverified: "账户身份待核验",
};
const eventNames: Record<string, string> = {
  trade: "成交",
  deposit: "充值",
  withdrawal: "提现",
  account_transfer: "账户划转",
  account_change: "账户变动",
  funding_fee: "资金费",
  settlement: "结算",
};
function date(value: string | undefined) {
  return value ? new Date(value).toLocaleString("zh-CN") : "尚未同步";
}

function Bars({ rows }: { rows: { label: string; value: string; share: string | null }[] }) {
  if (!rows.length) return <p className="text-muted-foreground text-sm">暂无数据。</p>;
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="mb-1 flex justify-between gap-4 text-sm">
            <span>{row.label}</span>
            <span className="text-muted-foreground tabular-nums">
              {row.value} · {percent(row.share)}
            </span>
          </div>
          <div className="bg-muted h-2 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, Number(row.share ?? 0) * 100))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
// Geometry only: the labels beside the line are formatted from the exact strings.
function Trend({ points }: { points: History["points"] }) {
  const values = points.map((point) => Number(point.net_usd));
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  const step = points.length > 1 ? 600 / (points.length - 1) : 0;
  const line = values
    .map(
      (value, index) =>
        `${(index * step).toFixed(1)},${(110 - ((value - low) / span) * 100).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg viewBox="0 0 600 120" className="h-32 w-full" role="img" aria-label="净资产历史曲线">
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
function Rows({ headers, rows }: { headers: string[]; rows: (string | null | undefined)[][] }) {
  if (!rows.length)
    return (
      <p className="text-muted-foreground py-10 text-center">暂无数据。连接只读账户后开始同步。</p>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} className="text-muted-foreground border-b px-4 py-3 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b last:border-0">
              {row.map((cell, column) => (
                <td key={column} className="whitespace-nowrap px-4 py-3">
                  {cell ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Portfolio() {
  const [context, setContext] = useState<Context | null>(null);
  const [ledger, setLedger] = useState<LedgerStatus>({ available: false });
  const [history, setHistory] = useState<History | null>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]>("资产总览");
  const [hidden, setHidden] = useState(false);
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
      const [data, status, past] = await Promise.all([
        readAsset<Context>("context", current.signal),
        readAsset<LedgerStatus>("wealthfolio/status", current.signal).catch(() => ({
          available: false,
        })),
        readAsset<History>("history", current.signal).catch(() => null),
      ]);
      if (current.signal.aborted) return;
      if (!Array.isArray(data.overview?.accounts) || !Array.isArray(data.recent_events))
        throw new Error("Invalid asset context");
      setContext(data);
      setLedger(status);
      if (past && Array.isArray(past.points)) setHistory(past);
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
    (account.snapshot?.holdings ?? []).map((holding) => ({ ...holding, account: account.label })),
  );
  const positions = accounts.flatMap((account) =>
    (account.snapshot?.positions ?? []).map((position) => ({
      ...position,
      account: account.label,
    })),
  );
  const allocation = context?.allocation;
  const exposure = context?.exposure;
  const trend = history?.points ?? [];
  const observation = (item: NonNullable<typeof allocation>["observations"][number]) =>
    item.kind === "platform_concentration"
      ? `${providers[item.subject ?? ""] ?? item.subject} 占已知净资产 ${percent(item.share)}，单一平台占比过半。`
      : item.kind === "asset_concentration"
        ? `${item.subject} 占已估值持仓 ${percent(item.share)}，单一非稳定币资产占比过半。`
        : `有 ${item.count} 项持仓缺少报价，未计入分布。`;
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
              <a href="/connections?tab=connections">账户连接</a>
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
              <CardTitle className="text-muted-foreground text-sm font-medium">
                已知净资产 · USD
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">
                {money(context?.overview.known_net_usd)}
              </p>
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
              <CardTitle className="text-muted-foreground text-sm font-medium">今日收益</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">暂不可计算</p>
              <p className="text-muted-foreground mt-2 text-xs">需要完整资金流水及历史估值</p>
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
                {!hidden && <Trend points={trend} />}
                <p className="text-muted-foreground mt-2 text-xs">
                  {history?.note}
                  {trend.some((point) => !point.complete) && " 部分日期尚有账户未同步，数值偏低。"}
                </p>
              </div>
            )}
            {tab === "资产分布" && (
              <div className="space-y-8">
                {(allocation?.observations ?? []).length > 0 && (
                  <ul className="border-border space-y-1 rounded-lg border p-3 text-sm">
                    {allocation?.observations.map((item) => (
                      <li key={item.kind}>{observation(item)}</li>
                    ))}
                  </ul>
                )}
                <section>
                  <h3 className="mb-3 text-sm font-medium">按平台 · 已知净资产</h3>
                  <Bars
                    rows={(allocation?.by_platform ?? []).map((row) => ({
                      label: `${providers[row.provider] ?? row.provider} · ${row.accounts} 个账户`,
                      value: money(row.usd),
                      share: row.share,
                    }))}
                  />
                </section>
                <section>
                  <h3 className="mb-3 text-sm font-medium">按大类 · 已估值持仓</h3>
                  <Bars
                    rows={(allocation?.by_class ?? []).map((row) => ({
                      label: classes[row.class] ?? row.class,
                      value: money(row.usd),
                      share: row.share,
                    }))}
                  />
                </section>
                <section>
                  <h3 className="mb-3 text-sm font-medium">跨账户合并持仓</h3>
                  <Rows
                    headers={["资产", "大类", "合计数量", "估值", "占比", "来源"]}
                    rows={(allocation?.by_asset ?? []).map((row) => [
                      row.symbol,
                      classes[row.class] ?? row.class,
                      privateText(row.quantity),
                      money(row.usd),
                      percent(row.share),
                      privateText(
                        [...new Set(row.sources.map((source) => source.account))].join("、"),
                      ),
                    ])}
                  />
                </section>
                <p className="text-muted-foreground text-xs">
                  占比按已有报价的代币持仓计算；协议仓位已包含在钱包净值中，不重复拆分。链上同名代币按各自合约分开统计。
                </p>
              </div>
            )}
            {tab === "资产总览" && (
              <Rows
                headers={["账户", "平台", "已知净值", "快照时间", "同步与覆盖"]}
                rows={accounts.map((account) => [
                  privateText(account.label),
                  providers[account.provider] ?? account.provider,
                  money(account.snapshot?.net_usd),
                  date(account.snapshot?.source_time),
                  account.stale
                    ? "快照过期或尚未同步"
                    : account.snapshot?.balances_complete
                      ? "余额已同步"
                      : "覆盖不完整",
                ])}
              />
            )}
            {tab === "持仓明细" && (
              <Rows
                headers={["资产", "账户", "数量", "估值", "账户范围"]}
                rows={holdings.map((holding) => [
                  holding.symbol,
                  privateText(holding.account),
                  privateText(holding.quantity),
                  money(holding.usd_value),
                  holding.scope,
                ])}
              />
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
                  headers={["合约", "账户", "方向", "数量", "名义敞口", "未实现盈亏"]}
                  rows={positions.map((position) => [
                    position.instrument,
                    privateText(position.account),
                    position.side,
                    privateText(position.quantity),
                    money(position.notional_usd),
                    money(position.unrealized_pnl),
                  ])}
                />
              </>
            )}
            {tab === "交易流水" && (
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
            {tab === "每日对账" && (
              <div className="space-y-4">
                <p className="text-muted-foreground text-sm">
                  {context?.reconciliation.reason ?? "连接账户后开始积累对账基线。"}
                </p>
                <p>
                  可比较快照的资产变化：
                  <strong>{money(context?.reconciliation.observed_change_usd)}</strong>
                </p>
                <p className="text-muted-foreground text-sm">
                  资产变化包含充值和提现，不代表投资收益。
                </p>
                <Rows
                  headers={["账户", "待处理项"]}
                  rows={(context?.overview.issues ?? []).map((issue) => [
                    privateText(name(issue.connection_id)),
                    issues[issue.reason] ?? "数据覆盖需要核验",
                  ])}
                />
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
