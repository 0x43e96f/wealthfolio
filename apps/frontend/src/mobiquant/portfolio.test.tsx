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
});
