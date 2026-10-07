export interface Holding {
  asset: string;
  symbol: string;
  quantity: string;
  usd_value: string | null;
  scope: string;
  kind: string;
  currency?: string;
  native_value?: string | null;
  cost?: string | null;
  pnl?: string | null;
}
export interface Fill {
  connection_id: string;
  account: string;
  source_id: string;
  occurred_at: string;
  asset: string;
  amount: string;
  price: string;
  quote: string;
  fee: string;
  pnl: string | null;
  scope: string;
}
export interface TradeSummary {
  connection_id: string;
  account: string;
  instrument: string;
  scope: string;
  quote: string;
  fills: number;
  first: string;
  last: string;
  bought: string;
  average_buy: string | null;
  sold: string;
  average_sell: string | null;
  net_position: string;
  average_cost: string | null;
  fees: string;
  realized: string;
  basis: "source" | "computed" | "incomplete";
  opening_position?: string | null;
}
export interface Trades {
  fills: Fill[];
  total: number;
  summary: TradeSummary[];
}
// A price or size as the source gave it, trimmed of trailing zeros, never rounded
// through a float beyond eight decimals.
export function plain(value: string | null | undefined): string {
  if (value == null || !/^-?\d+(?:\.\d+)?$/.test(value)) return "—";
  const [whole, fraction = ""] = value.split(".");
  const kept = fraction.slice(0, 8).replace(/0+$/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return kept ? `${grouped}.${kept}` : grouped;
}
export interface Position {
  instrument: string;
  side: string;
  quantity: string;
  notional_usd: string | null;
  unrealized_pnl: string | null;
}
export interface Snapshot {
  net_usd: string | null;
  source_time: string;
  holdings: Holding[];
  positions: Position[];
  balances_complete: boolean;
  missing: string[];
}
export interface Account {
  id: string;
  label: string;
  provider: string;
  group?: string;
  ownership: string;
  enabled: boolean;
  included: boolean;
  stale: boolean;
  status: string;
  error_code: string | null;
  snapshot: Snapshot | null;
}
export interface Event {
  connection_id: string;
  source_id: string;
  occurred_at: string;
  kind: string;
  asset: string;
  amount: string;
  fee: string;
}
export interface AllocationSource {
  account: string;
  provider: string;
  scope: string;
  quantity: string;
  usd: string | null;
}
export interface Allocation {
  holdings_usd: string | null;
  by_platform: { provider: string; accounts: number; usd: string; share: string | null }[];
  by_asset: {
    asset: string;
    symbol: string;
    class: string;
    quantity: string;
    usd: string;
    share: string | null;
    sources: AllocationSource[];
  }[];
  by_class: { class: string; usd: string; share: string | null }[];
  unpriced: (AllocationSource & { symbol: string })[];
  observations: { kind: string; subject?: string; share?: string; count?: number }[];
}
export interface Exposure {
  long_usd: string;
  short_usd: string;
  net_usd: string;
  gross_usd: string;
  gross_to_net_assets: string | null;
  unvalued_positions: number;
  by_instrument: { instrument: string; long_usd: string; short_usd: string; net_usd: string }[];
}
export interface History {
  points: {
    date: string;
    net_usd: string;
    valued_accounts: number;
    complete: boolean;
    change_usd?: string | null;
    change_pct?: string | null;
  }[];
  included_accounts: number;
  note: string;
}
export interface Group {
  name: string;
  accounts: string[];
  included_accounts: number;
  net_usd: string | null;
  complete: boolean;
}
export interface AccountSummary {
  net_usd: string | null;
  cash_usd: string;
  invested_usd: string;
  gross_exposure_usd: string;
  borrowed_usd: string;
  leverage: string | null;
  by_currency?: { currency: string; native: string; usd: string }[];
}
export interface Context {
  groups?: Group[];
  account_summaries?: Record<string, AccountSummary>;
  fx?: Record<string, string>;
  net_by_currency?: Record<string, string>;
  allocation?: Allocation;
  exposure?: Exposure;
  overview: {
    known_net_usd: string | null;
    included_accounts: number;
    valued_accounts: number;
    complete: boolean;
    accounts: Account[];
    issues: { connection_id: string; reason: string }[];
    as_of: string;
  };
  recent_events: Event[];
  reconciliation: {
    observed_change_usd: string | null;
    daily_pnl_usd: string | null;
    reason: string;
    activity_window: string;
  };
}
export interface LedgerStatus {
  available: boolean;
  accounts?: number;
}

// Format financial strings exactly. JavaScript floats never determine displayed money.
// An amount in its own currency, to two decimals, without going through a float.
export function amount(value: string | null | undefined, currency: string): string {
  const text = usd(value);
  return text === "—" ? text : text.replace("$", "") + " " + currency;
}

export function usd(value: string | null | undefined): string {
  if (value == null || !/^-?\d+(?:\.\d+)?$/.test(value) || value.length > 160) return "—";
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const padded = fraction.padEnd(3, "0");
  let cents = BigInt(whole) * 100n + BigInt(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) cents += 1n;
  const integer = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative && cents !== 0n ? "-" : ""}$${integer}.${(cents % 100n).toString().padStart(2, "0")}`;
}

// Shares are ratios, not money, so plain number formatting is acceptable here.
export function percent(share: string | null | undefined): string {
  if (share == null || !/^-?\d+(?:\.\d+)?$/.test(share)) return "—";
  return `${(Number(share) * 100).toFixed(2)}%`;
}

export function ownedAccounts(context: Context): Account[] {
  return context.overview.accounts.filter(
    (account) => account.included && account.enabled && account.ownership === "owned",
  );
}

export async function readAsset<T>(
  path: "context" | "wealthfolio/status" | "history" | "trades?days=365",
  signal: AbortSignal,
): Promise<T> {
  // Relative on purpose: the page carries a <base> for the path it is mounted under.
  const response = await fetch(`api/assets/${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (response.status === 401) {
    window.location.assign(new URL("login", document.baseURI).href);
    throw new Error("登录已过期");
  }
  if (!response.ok) throw new Error("数据暂不可用，稍后重试");
  return response.json() as Promise<T>;
}
