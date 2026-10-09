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
      by_denomination: [
        {
          denomination: "HKD",
          usd: "300",
          share: "0.7500",
          classes: [{ class: "securities", usd: "300" }],
          items: [{ symbol: "1 A", usd: "300" }],
        },
        {
          denomination: "crypto",
          usd: "100",
          share: "0.2500",
          classes: [{ class: "major", usd: "100" }],
          items: [{ symbol: "BTC", usd: "100" }],
        },
      ],
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
    // Pointing at a category lists what is in it.
    fireEvent.mouseEnter(screen.getByRole("button", { name: /主流币/ }));
    expect(screen.getByText(/BTC · \$123\.45/)).toBeTruthy();
    expect(screen.getAllByText("主流币").length).toBeGreaterThan(0);
    expect(screen.queryByText("Binance · 1 个账户")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "按币种" }));
    expect(screen.getByRole("img", { name: "币种占比" })).toBeTruthy();
    fireEvent.mouseEnter(screen.getByRole("button", { name: /港元资产/ }));
    expect(screen.getByText(/股票与证券合计 · \$300\.00/)).toBeTruthy();
    // A click holds the slice: passing over another on the way to the list
    // changes nothing, and leaving the chart does not clear it.
    fireEvent.click(screen.getByRole("button", { name: /港元资产/ }));
    fireEvent.mouseEnter(screen.getByRole("button", { name: /加密货币/ }));
    fireEvent.mouseLeave(screen.getByRole("img", { name: "币种占比" }).parentElement!);
    expect(screen.getByText(/股票与证券合计 · \$300\.00/)).toBeTruthy();
    expect(screen.getByText(/已固定/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /港元资产/ }));
    expect(screen.queryByText(/已固定/)).toBeNull();
    fireEvent.mouseEnter(screen.getByRole("button", { name: /港元资产/ }));
    expect(screen.getByText(/1 A · \$300\.00/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "按平台" }));
    expect(screen.getAllByText("Binance · 1 个账户").length).toBeGreaterThan(0);
    fireEvent.mouseEnter(screen.getByRole("button", { name: /Binance · 1 个账户/ }));
    expect(screen.getByText(/My Binance · \$123\.45/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "跨账户合并持仓" }));
    // The merged view leads with each asset's share and where it is held.
    expect(screen.getByRole("img", { name: "各资产占比" })).toBeTruthy();
    fireEvent.mouseEnter(screen.getByRole("button", { name: /^BTC/ }));
    expect(screen.getByText(/My Binance · \$123\.45/)).toBeTruthy();
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
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        asked.push(url);
        return Promise.resolve(
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
        );
      }),
    );
    const tradeReads = () => asked.filter((url) => url.includes("trades")).length;
    render(<Portfolio />);
    // A year of fills is not read with the page: only when its tab is opened.
    const tradesTab = await screen.findByRole("button", { name: "交易流水" });
    expect(tradeReads()).toBe(0);
    fireEvent.click(tradesTab);
    expect(await screen.findByText("125.50 USDT（平台）")).toBeTruthy();
    expect(tradeReads()).toBe(1);
    // Looking at another tab and coming back does not read them again; a refresh does.
    fireEvent.click(screen.getByRole("button", { name: "收益" }));
    fireEvent.click(screen.getByRole("button", { name: "交易流水" }));
    expect(await screen.findByText("125.50 USDT（平台）")).toBeTruthy();
    expect(tradeReads()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /刷新/ }));
    await waitFor(() => expect(tradeReads()).toBe(2));
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

  it("says so when the trades could not be read, and reads them again after a refresh", async () => {
    const data = context();
    let fail = true;
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("trades")) reads += 1;
        if (url.includes("trades") && fail)
          return Promise.resolve(new Response("{}", { status: 502 }));
        const body = url.endsWith("wealthfolio/status")
          ? { available: false }
          : url.includes("trades")
            ? { total: 0, fills: [], summary: [] }
            : data;
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }),
    );
    render(<Portfolio />);
    fireEvent.click(await screen.findByRole("button", { name: "交易流水" }));
    expect((await screen.findByRole("alert")).textContent).toContain("成交没有读到");
    // The cash movements beside them come with the page and are not held up by the trades.
    fireEvent.click(screen.getByRole("button", { name: "资金流水" }));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "按标的汇总" }));
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: /刷新/ }));
    await waitFor(() => expect(reads).toBe(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByRole("status")).toBeNull();
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
                : url.includes("history")
                  ? past
                  : data,
            ),
            { status: 200 },
          ),
        ),
      ),
    );
    render(<Portfolio />);
    fireEvent.change(await screen.findByRole("combobox", { name: "计价币种" }), {
      target: { value: "CAD" },
    });
    expect(await screen.findByText("175.47 CAD")).toBeTruthy();
    expect(screen.getByText("1 USD = 1.4214 CAD")).toBeTruthy();
    // Today's change against yesterday's close heads the page.
    expect(screen.getAllByText("$23.45").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "资产曲线" }));
    expect(await screen.findByText("23.45%")).toBeTruthy();
    // The reading follows the pointer: the left edge is the first day.
    const chart = screen.getAllByRole("img", { name: "净资产历史曲线" })[0];
    chart.getBoundingClientRect = () => ({ left: 0, width: 800 }) as DOMRect;
    fireEvent.mouseMove(chart, { clientX: 0 });
    expect(screen.getByText("2026-10-05 收盘")).toBeTruthy();
    fireEvent.mouseLeave(chart);
    expect(screen.getByText("2026-10-06 收盘")).toBeTruthy();
    // Two points are too few to zoom into: scrolling leaves the curve whole.
    fireEvent.wheel(chart, { deltaY: -100, clientX: 400 });
    expect(screen.queryByText(/已放大/)).toBeNull();
    // Other bar sizes are read on request, from the same endpoint.
    fireEvent.click(screen.getByRole("button", { name: "1 小时" }));
    await waitFor(() =>
      expect(
        (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.some(([url]) =>
          url.endsWith("history?interval=1h"),
        ),
      ).toBe(true),
    );
    expect(screen.getAllByText("2026-10-05").length).toBeGreaterThan(0);
  });

  it("lists what earns interest and saves a rate the owner enters", async () => {
    const data = context();
    const income = {
      rows: [
        {
          connection_id: "owned",
          account: "My Binance",
          asset: "USDC",
          scope: "spot",
          class: "stablecoin",
          usd: "1200",
          apy: "5.00",
          source: "auto",
          updated_at: null,
          monthly_usd: "5.00",
        },
      ],
      unset: [
        {
          connection_id: "owned",
          account: "My Binance",
          asset: "USDT",
          scope: "spot",
          class: "stablecoin",
          usd: "300",
        },
      ],
      earning_usd: "1200",
      weighted_apy: "5.00",
      monthly_usd: "5.00",
      yearly_usd: "60.00",
      idle_usd: "300",
    };
    const calls: { url: string; method?: string; body?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method, body: init?.body as string });
        return Promise.resolve(
          new Response(
            JSON.stringify(
              url.endsWith("wealthfolio/status")
                ? { available: false }
                : url.endsWith("yields")
                  ? init?.method === "PUT"
                    ? { ok: true }
                    : income
                  : data,
            ),
            { status: 200 },
          ),
        );
      }),
    );
    vi.stubGlobal("prompt", () => " 4.2% ");
    render(<Portfolio />);
    fireEvent.click(await screen.findByRole("button", { name: "收益" }));
    expect((await screen.findAllByText("5.00%")).length).toBe(2);
    expect(screen.getByText("平台")).toBeTruthy();
    expect(screen.getByText("$60.00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "设置年化" }));
    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    expect(JSON.parse(calls.find((call) => call.method === "PUT")!.body!)).toEqual({
      connection_id: "owned",
      asset: "USDT",
      apy: "4.2",
    });
  });

  it("shows the long view and records a new cash-out", async () => {
    const data = context();
    const long = {
      points: [
        {
          date: "2025-12-31",
          net_usd: "1000",
          cashout_usd: "0",
          generated_usd: "1000",
          source: "manual",
        },
        {
          date: "2026-10-06",
          net_usd: "1500",
          cashout_usd: "575",
          generated_usd: "2075",
          source: "synced",
        },
      ],
      monthly: [],
      yearly: [
        {
          period: "2025",
          close_date: "2025-12-31",
          close_usd: "1000",
          cashout_usd: "0",
          change_usd: null,
          result_usd: null,
          basis_changed: false,
        },
        {
          period: "2026",
          close_date: "2026-10-06",
          close_usd: "1500",
          cashout_usd: "575",
          change_usd: "500",
          result_usd: "1075",
          basis_changed: true,
        },
      ],
      destinations: [
        {
          destination: "china",
          moved_usd: "500",
          share: "0.8696",
          held_usd: "350",
          difference_usd: "-150",
          places: [{ place: "okx", usd: "500" }],
        },
        {
          destination: "card",
          moved_usd: "75",
          share: "0.1304",
          held_usd: null,
          difference_usd: null,
          places: [{ place: "bitget", usd: "75" }],
        },
      ],
      by_year: [{ year: "2026", china: "500", card: "75" }],
      cashout_total_usd: "575",
      kept_usd: "350",
      note: "历史为手工记录。",
    };
    const calls: { url: string; method?: string; body?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method, body: init?.body as string });
        return Promise.resolve(
          new Response(
            JSON.stringify(
              url.endsWith("wealthfolio/status")
                ? { available: false }
                : url.endsWith("finance")
                  ? long
                  : url.endsWith("cashouts")
                    ? { ok: true }
                    : data,
            ),
            { status: url.endsWith("cashouts") ? 201 : 200 },
          ),
        );
      }),
    );
    render(<Portfolio />);
    fireEvent.click(await screen.findByRole("button", { name: "财务全景" }));
    // The year that spans the switch from hand-kept to synced figures is marked.
    expect(await screen.findByText("$1,075.00 *")).toBeTruthy();
    expect(screen.getByText("$2,075.00")).toBeTruthy();
    expect(screen.getByText("已花掉")).toBeTruthy();
    expect(screen.getByText("-$150.00")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("出金日期"), { target: { value: "2026-10-07" } });
    fireEvent.change(screen.getByLabelText("经由"), { target: { value: "bylls" } });
    fireEvent.change(screen.getByLabelText("美元金额"), { target: { value: "1,200" } });
    fireEvent.change(screen.getByLabelText("去向"), { target: { value: "canada" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(JSON.parse(calls.find((call) => call.method === "POST")!.body!)).toEqual({
      day: "2026-10-07",
      place: "bylls",
      usd: "1200",
      destination: "canada",
    });
  });

  it("zooms the curve with the wheel, moves the window and returns to the whole", async () => {
    const data = context();
    const past = {
      points: Array.from({ length: 40 }, (_, index) => ({
        date: `2026-09-${String(index + 1).padStart(2, "0")}`
          .replace("2026-09-3", "2026-10-0")
          .replace("2026-09-4", "2026-10-1"),
        net_usd: String(1000 + index * 10),
        valued_accounts: 1,
        complete: true,
        change_usd: index ? "10" : null,
        change_pct: null,
      })),
      included_accounts: 1,
      note: "",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.endsWith("wealthfolio/status")
                ? { available: false }
                : url.includes("history")
                  ? past
                  : data,
            ),
            { status: 200 },
          ),
        ),
      ),
    );
    render(<Portfolio />);
    fireEvent.click(await screen.findByRole("button", { name: "资产曲线" }));
    const chart = await screen.findByRole("img", { name: "净资产历史曲线" });
    const frame = chart.parentElement!.parentElement!;
    frame.getBoundingClientRect = () => ({ left: 0, width: 800 }) as DOMRect;
    expect(screen.getByText(/向上滚动放大/)).toBeTruthy();
    // Scrolling up at the right edge keeps the latest days and drops early ones.
    fireEvent.wheel(frame, { deltaY: -100, clientX: 800 });
    expect(screen.getByText(/已放大：2026-09-09 至 2026-10-10/)).toBeTruthy();
    // Dragging the chart to the right by a quarter of its width brings earlier
    // days in: a quarter of the 31-day window, eight days.
    fireEvent.mouseDown(frame, { clientX: 300 });
    fireEvent.mouseMove(frame, { clientX: 500 });
    fireEvent.mouseUp(frame);
    expect(screen.getByText(/已放大：2026-09-01 至/)).toBeTruthy();
    // Once released, moving the pointer no longer drags.
    fireEvent.mouseMove(frame, { clientX: 100 });
    expect(screen.getByText(/已放大：2026-09-01 至/)).toBeTruthy();
    fireEvent.mouseDown(frame, { clientX: 500 });
    fireEvent.mouseMove(frame, { clientX: 300 });
    fireEvent.mouseUp(frame);
    expect(screen.getByText(/已放大：2026-09-09 至/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "← 往前" }));
    expect(screen.getByText(/已放大：2026-09-01 至/)).toBeTruthy();
    // Scrolling down far enough shows everything again.
    fireEvent.wheel(frame, { deltaY: 100, clientX: 400 });
    fireEvent.wheel(frame, { deltaY: 100, clientX: 400 });
    expect(screen.queryByText(/已放大/)).toBeNull();
  });
});
