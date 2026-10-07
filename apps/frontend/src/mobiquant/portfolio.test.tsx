import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Portfolio } from "./portfolio";
import type { Account, Context } from "./client";

function context(): Context {
  const owned: Account = {
    id: "owned",
    label: "My Binance",
    provider: "binance",
    ownership: "owned",
    enabled: true,
    included: true,
    stale: false,
    status: "ready",
    error_code: null,
    snapshot: {
      net_usd: "123.45",
      source_time: "2026-10-05T12:00:00Z",
      holdings: [
        {
          asset: "btc",
          symbol: "BTC",
          quantity: "1",
          usd_value: "123.45",
          scope: "spot",
          kind: "token",
        },
      ],
      positions: [],
      balances_complete: true,
      missing: [],
    },
  };
  return {
    overview: {
      known_net_usd: "123.45",
      included_accounts: 1,
      valued_accounts: 1,
      complete: true,
      accounts: [
        owned,
        { ...owned, id: "watch", label: "Other wallet", ownership: "watch", included: false },
      ],
      issues: [],
      as_of: "2026-10-05T12:00:00Z",
    },
    allocation: {
      holdings_usd: "123.45",
      by_platform: [{ provider: "binance", accounts: 1, usd: "123.45", share: "1.0000" }],
      by_asset: [
        {
          asset: "btc",
          symbol: "BTC",
          class: "major",
          quantity: "1",
          usd: "123.45",
          share: "1.0000",
          sources: [
            {
              account: "My Binance",
              provider: "binance",
              scope: "spot",
              quantity: "1",
              usd: "123.45",
            },
          ],
        },
      ],
      by_class: [{ class: "major", usd: "123.45", share: "1.0000" }],
      unpriced: [],
      observations: [{ kind: "asset_concentration", subject: "BTC", share: "1.0000" }],
    },
    recent_events: [],
    reconciliation: {
      observed_change_usd: "23.45",
      daily_pnl_usd: null,
      reason: "资金流不是收益",
      activity_window: "测试窗口",
    },
  };
}

describe("private Portfolio", () => {
  it("keeps authoritative balances available when the ledger fails, without including watch wallets or inventing profit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("wealthfolio/status")) return Promise.reject(new Error("ledger offline"));
        return Promise.resolve(new Response(JSON.stringify(context()), { status: 200 }));
      }),
    );
    render(<Portfolio />);
    await screen.findByText("My Binance");
    expect(screen.queryByText("Other wallet")).not.toBeInTheDocument();
    expect(screen.getByText("暂不可计算")).toBeInTheDocument();
    expect(screen.getAllByText("$123.45")).toHaveLength(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "隐藏金额" }));
    await waitFor(() => expect(screen.queryByText("$123.45")).not.toBeInTheDocument());
    expect(screen.queryByText("My Binance")).not.toBeInTheDocument();
  });

  it("renders external names as text and preserves the last snapshot after a failed refresh", async () => {
    const data = context();
    const label = '<img src=x onerror="alert(1)">';
    data.overview.accounts[0].label = label;
    let failed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (failed) return Promise.reject(new Error("network failed"));
        return Promise.resolve(
          new Response(
            JSON.stringify(url.endsWith("wealthfolio/status") ? { available: false } : data),
            { status: 200 },
          ),
        );
      }),
    );
    const { container } = render(<Portfolio />);
    await screen.findByText(label);
    expect(container.querySelector("img")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
    failed = true;
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByRole("alert");
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getAllByText("$123.45")).toHaveLength(2);
  });

  it("shows allocation as shares of observed holdings and keeps the history a balance series", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const body = url.endsWith("wealthfolio/status")
          ? { available: true, accounts: 1 }
          : url.endsWith("history")
            ? {
                points: [
                  { date: "2026-10-04", net_usd: "100", valued_accounts: 1, complete: true },
                  { date: "2026-10-05", net_usd: "123.45", valued_accounts: 1, complete: true },
                ],
                included_accounts: 1,
                note: "净资产历史包含充值、提现和行情变化，不代表投资收益。",
              }
            : context();
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }),
    );
    render(<Portfolio />);
    expect(await screen.findByRole("img", { name: "净资产历史曲线" })).toBeTruthy();
    expect(screen.getByText(/不代表投资收益/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "资产分布" }));
    expect(await screen.findByText(/BTC 占已估值持仓 100.00%/)).toBeTruthy();
    // One view at a time: the pie by category first, the others on request.
    expect(screen.getByRole("img", { name: "资产大类占比" })).toBeTruthy();
    expect(screen.getAllByText("主流币").length).toBeGreaterThan(0);
    expect(screen.queryByText("Binance · 1 个账户")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "按平台" }));
    expect(screen.getByText("Binance · 1 个账户")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "跨账户合并持仓" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索资产" }), {
      target: { value: "eth" },
    });
    expect(screen.getByText(/0 \/ 1 行/)).toBeTruthy();
  });

  it("shows grouped accounts as one row that opens to its members", async () => {
    const data = context();
    const main = data.overview.accounts[0];
    const sub = { ...main, id: "sub", label: "OKX sub", group: "OKX" };
    data.overview.accounts = [{ ...main, label: "OKX main", group: "OKX" }, sub];
    data.groups = [
      {
        name: "OKX",
        accounts: ["owned", "sub"],
        included_accounts: 2,
        net_usd: "246.90",
        complete: true,
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(url.endsWith("wealthfolio/status") ? { available: false } : data),
            { status: 200 },
          ),
        ),
      ),
    );
    render(<Portfolio />);
    expect(await screen.findByText("$246.90")).toBeTruthy();
    expect(screen.getByText("2 个账户")).toBeTruthy();
    expect(screen.queryByText("OKX sub")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /OKX/ }));
    expect(await screen.findByText("OKX sub")).toBeTruthy();
    expect(screen.getByText("OKX main")).toBeTruthy();
  });

  it("opens an account to its positions, cash and leverage", async () => {
    const data = context();
    const account = data.overview.accounts[0];
    account.label = "IBKR";
    account.provider = "ibkr";
    account.snapshot!.missing = ["valued_at_last_close"];
    account.snapshot!.holdings = [
      {
        asset: "ibkr:stk:1",
        symbol: "AAPL",
        quantity: "10",
        usd_value: "180",
        scope: "stk",
        kind: "token",
      },
      {
        asset: "ibkr:cash",
        symbol: "USD",
        quantity: "-56.55",
        usd_value: "-56.55",
        scope: "cash",
        kind: "token",
      },
    ];
    data.account_summaries = {
      owned: {
        net_usd: "123.45",
        cash_usd: "-56.55",
        invested_usd: "180",
        gross_exposure_usd: "180",
        borrowed_usd: "56.55",
        leverage: "1.46",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(url.endsWith("wealthfolio/status") ? { available: false } : data),
            { status: 200 },
          ),
        ),
      ),
    );
    render(<Portfolio />);
    fireEvent.click(await screen.findByRole("button", { name: "IBKR 明细" }));
    expect(await screen.findByText("1.46×")).toBeTruthy();
    expect(screen.getByText("AAPL")).toBeTruthy();
    expect(screen.getByText("$56.55")).toBeTruthy();
    expect(screen.getAllByText("-$56.55").length).toBe(2);
    expect(screen.getByText(/价格仍为上一交易日收盘价/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "IBKR 明细" }));
    await waitFor(() => expect(screen.queryByText("1.46×")).toBeNull());
  });

  it("shows what was bought and sold per instrument, and whose profit figure it is", async () => {
    const data = context();
    const trades = {
      total: 1,
      fills: [
        {
          connection_id: "owned",
          account: "My Binance",
          source_id: "fill:1",
          occurred_at: "2026-10-05T12:00:00Z",
          asset: "BTCUSDT",
          amount: "-0.50000000",
          price: "60000.10",
          quote: "USDT",
          fee: "3",
          pnl: "125.5",
          scope: "linear",
        },
      ],
      summary: [
        {
          connection_id: "owned",
          account: "My Binance",
          instrument: "BTCUSDT",
          scope: "linear",
          quote: "USDT",
          fills: 2,
          first: "2026-10-01T12:00:00Z",
          last: "2026-10-05T12:00:00Z",
          bought: "0.5",
          average_buy: "59749.1",
          sold: "0.5",
          average_sell: "60000.1",
          net_position: "0",
          average_cost: null,
          fees: "6",
          realized: "125.5",
          basis: "source",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.endsWith("wealthfolio/status")
                ? { available: false }
                : url.includes("trades")
                  ? trades
                  : data,
            ),
            { status: 200 },
          ),
        ),
      ),
    );
    render(<Portfolio />);
    fireEvent.click(await screen.findByRole("button", { name: "交易流水" }));
    expect(await screen.findByText("125.50 USDT（平台）")).toBeTruthy();
    expect(screen.getByText("0.5 @ 59,749.1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "成交明细" }));
    expect(await screen.findByText("60,000.1 USDT")).toBeTruthy();
    expect(screen.getAllByText("卖出").length).toBe(2);
    fireEvent.change(screen.getByRole("combobox", { name: "方向" }), {
      target: { value: "卖出" },
    });
    expect(screen.getByText(/1 \/ 1 行/)).toBeTruthy();
    expect(screen.getByText("125.50 USDT")).toBeTruthy();
  });

  it("shows net assets in the chosen currency and each day's change on the curve", async () => {
    const data = context();
    data.fx = { USD: "1.000000", CAD: "1.421400" };
    data.net_by_currency = { USD: "123.450000", CAD: "175.471830" };
    const past = {
      points: [
        { date: "2026-10-05", net_usd: "100", valued_accounts: 1, complete: true },
        {
          date: "2026-10-06",
          net_usd: "123.45",
          valued_accounts: 1,
          complete: true,
          change_usd: "23.45",
          change_pct: "23.45",
        },
      ],
      included_accounts: 1,
      note: "不代表投资收益。",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.endsWith("wealthfolio/status")
                ? { available: false }
                : url.endsWith("history")
                  ? past
                  : data,
            ),
            { status: 200 },
          ),
        ),
      ),
    );
    render(<Portfolio />);
    fireEvent.click(await screen.findByRole("button", { name: "CAD" }));
    expect(await screen.findByText("175.47 CAD")).toBeTruthy();
    expect(screen.getByText("1 USD = 1.4214 CAD")).toBeTruthy();
    // Today's change against yesterday's close heads the page.
    expect(screen.getAllByText("$23.45").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "资产曲线" }));
    expect(await screen.findByText("23.45%")).toBeTruthy();
    expect(screen.getByText("2026-10-05")).toBeTruthy();
  });
});
