import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DailyAttribution } from "./attribution";

const fixture = () => ({
  start: "2026-10-11T07:00:00Z", end: "2026-10-11T08:00:00Z",
  daily_pnl_usd: null, daily_pnl_pct: null, observed_change_usd: "10",
  recorded_net_flow_usd: null, valuation_effect_usd: "10", unexplained_usd: "0",
  gains_usd: "10", losses_usd: "0", unmatched_movements: 1,
  internal_transfers: [], basis_changed: false, note: "估值贡献不是已实现盈亏。",
  assets: [{
    asset: "BP", symbol: "BP", effect_usd: "10", contribution_pct: "0.1", partial: false,
    accounts: [
      { connection_id: "one", account: "Private Binance", effect_usd: "20", change_pct: "2", reason: "" },
      { connection_id: "two", account: "Private Backpack", effect_usd: "-10", change_pct: "-1", reason: "" },
    ],
  }],
  accounts: ["one", "two"].map((id) => ({
    connection_id: id, account: id === "one" ? "Private Binance" : "Private Backpack",
    observed_start: "2026-10-11T06:55:00Z", observed_end: "2026-10-11T08:00:00Z",
    observed_change_usd: id === "one" ? "20" : "-10", recorded_net_flow_usd: null,
    daily_pnl_usd: null, valuation_effect_usd: id === "one" ? "20" : "-10",
    unexplained_usd: "0", reasons: ["资金流水未核对"],
  })),
});

function mock() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => fixture() }));
}

describe("daily attribution", () => {
  it("withholds profit while displaying valuation contributions", async () => {
    mock();
    render(<DailyAttribution asOf="first" hidden={false} />);
    await screen.findByText("今天赚亏在哪里");
    expect(screen.getByText("待核对", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/资金流去向待核对/)).toBeInTheDocument();
  });
  it("masks amounts, percentages and account names", async () => {
    mock();
    const { container } = render(<DailyAttribution asOf="first" hidden />);
    await screen.findByText("今天赚亏在哪里");
    expect(container.textContent).not.toContain("Private");
    expect(container.textContent).not.toContain("$10");
    expect(container.textContent).not.toContain("0.10");
  });
  it("filters asset contribution to the selected account", async () => {
    mock();
    render(<DailyAttribution asOf="first" hidden={false} />);
    await screen.findByText("今天赚亏在哪里");
    fireEvent.change(screen.getByLabelText("归因账户"), { target: { value: "two" } });
    const summary = screen.getByText("BP ·", { exact: false }).closest("summary");
    expect(summary?.textContent).toContain("-$10.00");
    expect(summary?.textContent).not.toContain("总资产贡献");
  });
  it("removes the prior summary after a failed refresh", async () => {
    mock();
    const { rerender } = render(<DailyAttribution asOf="first" hidden={false} />);
    await screen.findByText("今天赚亏在哪里");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unavailable")));
    rerender(<DailyAttribution asOf="second" hidden={false} />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("未读取成功"));
    expect(screen.queryByText("今天赚亏在哪里")).not.toBeInTheDocument();
  });
});
