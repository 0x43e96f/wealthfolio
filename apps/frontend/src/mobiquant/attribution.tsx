import { useEffect, useState } from "react";
import { readAsset, usd } from "./client";

interface Contribution {
  connection_id: string;
  account: string;
  effect_usd: string | null;
  change_pct: string | null;
  before_usd: string | null;
  after_usd: string | null;
  reason: string;
}
interface Attribution {
  start: string;
  end: string;
  daily_pnl_usd: string | null;
  daily_pnl_pct: string | null;
  observed_change_usd: string | null;
  recorded_net_flow_usd: string | null;
  valuation_effect_usd: string;
  unexplained_usd: string | null;
  gains_usd: string;
  losses_usd: string;
  unmatched_movements: number;
  internal_transfers: unknown[];
  basis_changed: boolean;
  assets: {
    asset: string;
    symbol: string;
    effect_usd: string | null;
    contribution_pct: string | null;
    partial: boolean;
    accounts: Contribution[];
  }[];
  accounts: {
    connection_id: string;
    account: string;
    observed_start: string | null;
    observed_end: string | null;
    observed_change_usd: string | null;
    recorded_net_flow_usd: string | null;
    daily_pnl_usd: string | null;
    valuation_effect_usd: string | null;
    unexplained_usd: string | null;
    reasons: string[];
  }[];
  note: string;
}

/** Read separately: a failed attribution never holds up the account overview. */
export function DailyAttribution({ asOf, hidden }: { asOf: string; hidden: boolean }) {
  const [data, setData] = useState<Attribution | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    setData(null);
    setError(false);
    readAsset<Attribution>("attribution", controller.signal)
      .then((found) => {
        if (!Array.isArray(found.assets) || !Array.isArray(found.accounts))
          throw new Error("Invalid attribution");
        if (!controller.signal.aborted) setData(found);
      })
      .catch(() => { if (active) setError(true); })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [asOf]);
  const money = (value: string | null) => hidden ? "••••" : usd(value);
  const name = (value: string) => hidden ? "••••" : value;
  const pct = (value: string | null) => hidden ? "••••" : value == null ? "—" : `${Number(value).toFixed(2)}%`;
  const tone = (value: string | null) => hidden || value == null ? "" : Number(value) < 0 ? "text-red-600" : Number(value) > 0 ? "text-emerald-600" : "";
  if (error) return <p role="status" className="text-muted-foreground mb-6 text-sm">今日归因未读取成功，点页面“刷新”重试。资产总览仍可查看。</p>;
  if (!data) return <p role="status" className="text-muted-foreground mb-6 text-sm">正在核对今日资产变化…</p>;
  const gainers = data.assets.filter((row) => Number(row.effect_usd) > 0);
  const losers = data.assets.filter((row) => Number(row.effect_usd) < 0);
  const shown = data.assets.filter((row) => filter === "all" || row.accounts.some((part) => part.connection_id === filter)).map((row) => {
    if (filter === "all") return row;
    const part = row.accounts.find((item) => item.connection_id === filter)!;
    return { ...row, effect_usd: part.effect_usd, contribution_pct: null, partial: part.effect_usd == null };
  }).sort((one, two) => Math.abs(Number(two.effect_usd)) - Math.abs(Number(one.effect_usd)));
  const leaders = (rows: Attribution["assets"]) => rows.slice(0, 3).map((row) => `${row.symbol} ${money(row.effect_usd)}${row.partial ? "（部分）" : ""}`).join("、") || "暂无可确认贡献";
  return <section aria-label="今日变化归因" className="mb-6 space-y-4 rounded-lg border p-4">
    <div>
      <h3 className="font-semibold">今天赚亏在哪里</h3>
      <p className="text-muted-foreground mt-1 text-xs">昨日最后观察与当前快照比较 · 更新时间 {new Date(data.end).toLocaleString("zh-CN", { timeZone: "America/Vancouver" })}（温哥华）</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <div><p className="text-muted-foreground text-xs">投资盈亏（资金流核对后）</p><p className={`mt-1 text-xl font-semibold ${tone(data.daily_pnl_usd)}`}>{data.daily_pnl_usd == null ? "待核对" : money(data.daily_pnl_usd)}</p>{data.daily_pnl_usd != null && <p>{pct(data.daily_pnl_pct)}</p>}</div>
      <div><p className="text-muted-foreground text-xs">等量持仓估值贡献</p><p className={`mt-1 text-xl font-semibold ${tone(data.valuation_effect_usd)}`}>{money(data.valuation_effect_usd)}</p></div>
      <div><p className="text-muted-foreground text-xs">其余净值变化（待核对）</p><p className="mt-1 text-xl font-semibold">{money(data.unexplained_usd)}</p></div>
    </div>
    <p className="text-sm">上涨贡献 {money(data.gains_usd)}；下跌贡献 {money(data.losses_usd)}。<br />主要上涨：{leaders(gainers)}<br />主要下跌：{leaders(losers)}</p>
    <p className="text-muted-foreground text-xs">净值变化 {money(data.observed_change_usd)} · 已记录净资金流 {money(data.recorded_net_flow_usd)}（可能不完整） · 匹配到 {data.internal_transfers.length} 笔内部转账 · {data.unmatched_movements} 笔资金流去向待核对。{data.basis_changed && "账户范围有变化，总体盈亏暂不计算。"}</p>
    <details>
      <summary className="cursor-pointer text-sm font-medium">展开资产贡献与账户明细</summary>
      <div className="mt-3 space-y-3">
        <label className="text-sm">查看账户 <select aria-label="归因账户" value={filter} onChange={(event) => setFilter(event.target.value)} className="bg-background rounded border p-1"><option value="all">全部账户</option>{data.accounts.map((row) => <option key={row.connection_id} value={row.connection_id}>{name(row.account)}</option>)}</select></label>
        {!shown.length && <p className="text-muted-foreground text-sm">缺少可比较的持仓基准，请查看下方账户核对说明。</p>}
        {shown.map((row) => <details key={row.asset} className="rounded border p-3">
          <summary className="cursor-pointer text-sm">{row.symbol} · <span className={tone(row.effect_usd)}>{row.effect_usd == null ? "待核对" : money(row.effect_usd)}</span>{row.partial && "（部分持仓待核对）"}{row.contribution_pct != null && ` · 总资产贡献 ${hidden ? "••••" : `${Number(row.contribution_pct).toFixed(2)} 个百分点`}`}</summary>
          <p className="text-muted-foreground mt-2 break-all text-xs">资产标识：{row.asset}</p>
          {row.accounts.filter((part) => filter === "all" || part.connection_id === filter).map((part) => <p key={part.connection_id} className="mt-2 text-sm">{name(part.account)}：{part.effect_usd == null ? "待核对" : money(part.effect_usd)} · 估值涨跌 {pct(part.change_pct)}{part.reason && ` · ${part.reason}`}</p>)}
        </details>)}
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["账户", "资产增减", "已记录净资金流", "估值贡献", "其余变化", "核对情况"].map((text) => <th key={text} className="p-2 font-medium">{text}</th>)}</tr></thead><tbody>{data.accounts.filter((row) => filter === "all" || row.connection_id === filter).map((row) => <tr key={row.connection_id} className="border-t"><td className="p-2">{name(row.account)}</td>{[row.observed_change_usd, row.recorded_net_flow_usd, row.valuation_effect_usd, row.unexplained_usd].map((value, index) => <td key={index} className="p-2 tabular-nums">{money(value)}</td>)}<td className="p-2">{row.reasons.join("；") || "已核对"}<br />{[row.observed_start, row.observed_end].map((value) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "America/Vancouver" }) : "缺少快照").join(" → ")}</td></tr>)}</tbody></table></div>
      </div>
    </details>
    <p className="text-muted-foreground text-xs">{data.note}</p>
  </section>;
}
