import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DailyAttribution } from "./attribution";
import { cents, decimalSum, negate } from "./attribution-money";

const fixture = () => ({
  start: "2026-10-11T07:00:00Z",
  end: "2026-10-11T08:00:00Z",
  price_effect_usd: "10",
  quantity_effect_usd: "5",
  gains_usd: "10",
  losses_usd: "0",
  unmatched_movements: 1,
  internal_transfers: [],
  account_transfers: 2,
  basis_changed: false,
  partial: false,
  comparable_accounts: 2,
  counted_accounts: 2,
  truncated: false,
  note: "这是快照拆解，不是成交盈亏。",
  assets: [
    {
      asset: "stock:US:AAPL",
      symbol: "AAPL",
      price_effect_usd: "10",
      quantity_effect_usd: "5",
      partial: false,
      accounts: [
        {
          connection_id: "one",
          source_asset: "ibkr:stk:1",
          account: "Private Binance",
          price_effect_usd: "20",
          quantity_effect_usd: "5",
          change_pct: "2",
          activity_count: 1,
          reason: "",
        },
        {
          connection_id: "two",
          source_asset: "futu:stk:US.AAPL",
          account: "Private Backpack",
          price_effect_usd: "-10",
          quantity_effect_usd: "0",
          change_pct: "-1",
          activity_count: 0,
          reason: "",
        },
      ],
    },
    {
      asset: "manual:crypto:secret",
      symbol: "Private Manual Account",
      price_effect_usd: null,
      quantity_effect_usd: null,
      partial: true,
      accounts: [
        {
          connection_id: "one",
          source_asset: "manual:crypto:secret",
          account: "Private Binance",
          price_effect_usd: null,
          quantity_effect_usd: null,
          change_pct: null,
          activity_count: 0,
          reason: "手填金额",
        },
      ],
    },
  ],
  accounts: ["one", "two"].map((id) => ({
    connection_id: id,
    account: id === "one" ? "Private Binance" : "Private Backpack",
    observed_start: "2026-10-11T06:55:00Z",
    observed_end: "2026-10-11T08:00:00Z",
    observed_change_usd: id === "one" ? "25" : "-10",
    price_effect_usd: id === "one" ? "20" : "-10",
    quantity_effect_usd: id === "one" ? "5" : "0",
    unexplained_usd: "0",
    reasons: [],
  })),
});
const props = { asOf: "first", date: "2026-10-11", total: "20", close: "1020", hidden: false };
function mock() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(fixture()) }),
  );
}
function view(overrides = {}) {
  return (
    <DailyAttribution {...props} {...overrides}>
      <p>今日净值变化</p>
    </DailyAttribution>
  );
}
async function hover() {
  fireEvent.mouseEnter(screen.getByRole("button", { name: "查看今日净值变化明细" }));
  return screen.findByRole("region", { name: "今日变化归因" });
}

describe("exact residual arithmetic", () => {
  it.each([null, undefined, 10, {}, [], "", "NaN", "1e2", "1.2.3", "9".repeat(161)])(
    "returns null for malformed money %j",
    (value) => {
      expect(cents(value)).toBeNull();
      expect(negate(value)).toBeNull();
      expect(decimalSum(["1", value])).toBeNull();
    },
  );
  it("keeps fractional and large dollar values exact", () => {
    expect(decimalSum(["9007199254740993.01", "-9007199254740993", "0.09"])).toBe("0.10");
    expect(decimalSum(["20", "-10", "-5"])).toBe("5");
    expect(decimalSum(["1", null])).toBeNull();
    expect(decimalSum([cents("0.008"), `-${cents("0.004")}`, `-${cents("0.004")}`])).toBe("0.01");
    expect(cents("-0.005")).toBe("-0.01");
  });
});
describe("daily card attribution", () => {
  it("waits for the overview asOf before requesting a breakdown", async () => {
    mock();
    const { rerender } = render(view({ asOf: "" }));
    fireEvent.mouseEnter(screen.getByRole("button", { name: "查看今日净值变化明细" }));
    expect(fetch).not.toHaveBeenCalled();
    rerender(view());
    await screen.findByRole("region", { name: "今日变化归因" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("reuses successful data after closing and fetches again for a new asOf", async () => {
    mock();
    const { rerender } = render(view());
    await hover();
    const trigger = screen.getByRole("button", { name: "查看今日净值变化明细" });
    fireEvent.mouseLeave(trigger);
    await waitFor(() => expect(screen.queryByText("今日净值变化明细")).not.toBeInTheDocument());
    await hover();
    expect(fetch).toHaveBeenCalledTimes(1);
    rerender(view({ asOf: "second" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await screen.findByText("今日净值变化明细");
  });
  it("lets an in-flight request finish after a hover closes", async () => {
    let finish!: (response: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    );
    render(view());
    const trigger = screen.getByRole("button", { name: "查看今日净值变化明细" });
    fireEvent.mouseEnter(trigger);
    await screen.findByText("正在核对今日资产变化…");
    fireEvent.mouseLeave(trigger);
    await waitFor(() =>
      expect(screen.queryByText("正在核对今日资产变化…")).not.toBeInTheDocument(),
    );
    finish({ ok: true, json: () => Promise.resolve(fixture()) });
    await hover();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not cache a failed request and supports retry", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(fixture()) });
    vi.stubGlobal("fetch", fetcher);
    render(view());
    fireEvent.mouseEnter(screen.getByRole("button", { name: "查看今日净值变化明细" }));
    await screen.findByRole("button", { name: "重试" });
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("region", { name: "今日变化归因" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(["oops", 20, null, {}, "1.2.3"])(
    "shows a dash instead of throwing for malformed total %j",
    async (total) => {
      mock();
      render(view({ total }));
      const region = await hover();
      expect(within(region).getByText("净值变化（同卡片）").nextElementSibling).toHaveTextContent(
        "—",
      );
      expect(within(region).getByText("其余差额").nextElementSibling).toHaveTextContent("—");
    },
  );
  it.each(["oops", 10, null, {}, "9".repeat(161)])(
    "shows a dash for malformed API money %j",
    async (value) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              ...fixture(),
              price_effect_usd: value,
              quantity_effect_usd: value,
            }),
        }),
      );
      render(view());
      const region = await hover();
      expect(
        within(region).getByText("价格影响", { selector: "p" }).nextElementSibling,
      ).toHaveTextContent("—");
      expect(within(region).getByText("其余差额").nextElementSibling).toHaveTextContent("—");
    },
  );
  it("opens on hover, uses card total and exposes all assets directly", async () => {
    mock();
    render(view());
    expect(fetch).not.toHaveBeenCalled();
    const region = await hover();
    expect(within(region).getByText("$20.00")).toBeInTheDocument();
    expect(within(region).getByText("其余差额").nextElementSibling).toHaveTextContent("$5.00");
    expect(within(region).getByText("AAPL")).toBeVisible();
    expect(within(region).getByText("Private Manual Account（部分待核对）")).toBeVisible();
    expect(within(region).queryByText(/投资盈亏/)).not.toBeInTheDocument();
  });
  it("supports keyboard focus and clicking", async () => {
    mock();
    render(view());
    const trigger = screen.getByRole("button", { name: "查看今日净值变化明细" });
    fireEvent.focus(trigger);
    await screen.findByText("今日净值变化明细");
    fireEvent.click(trigger);
    expect(screen.getByText("今日净值变化明细")).toBeVisible();
  });
  it("keeps the popover open when its account filter has keyboard focus", async () => {
    mock();
    render(view());
    await hover();
    const select = screen.getByLabelText("归因账户");
    select.focus();
    fireEvent.mouseLeave(select.closest('[data-state="open"]')!);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(screen.getByText("今日净值变化明细")).toBeVisible();
  });
  it("masks manual symbols as well as values and account names", async () => {
    mock();
    render(view({ hidden: true }));
    const region = await hover();
    expect(region.textContent).not.toContain("Private");
    expect(region.textContent).not.toContain("$20");
    expect(region.textContent).not.toContain("百分点");
  });
  it("filters contributions without changing the card total", async () => {
    mock();
    render(view());
    const region = await hover();
    fireEvent.change(screen.getByLabelText("归因账户"), { target: { value: "two" } });
    const row = within(region).getByText("AAPL").closest("tr")!;
    expect(row.textContent).toContain("-$10.00");
    expect(within(region).getByText("净值变化（同卡片）").nextElementSibling).toHaveTextContent(
      "$20.00",
    );
    expect(
      within(region).queryByText("Private Manual Account（部分待核对）"),
    ).not.toBeInTheDocument();
  });
  it("removes the old summary after failed refresh", async () => {
    mock();
    const { rerender } = render(view());
    await hover();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unavailable")));
    rerender(view({ asOf: "second" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("未读取成功"));
    expect(screen.queryByText("今日净值变化明细")).not.toBeInTheDocument();
  });
  it("does not combine different Vancouver days", async () => {
    mock();
    render(view({ date: "2026-10-10" }));
    fireEvent.click(screen.getByRole("button", { name: "查看今日净值变化明细" }));
    const region = await screen.findByRole("region", { name: "今日变化归因" });
    expect(screen.getByRole("status")).toHaveTextContent("上一日的读取结果");
    expect(
      within(region).getByText("价格影响", { selector: "p" }).nextElementSibling,
    ).toHaveTextContent("$10.00");
    expect(within(region).getByText("其余差额").nextElementSibling).toHaveTextContent("—");
    expect(region.textContent).not.toMatch(/\d+\.\d+ 个百分点/);
    expect(region.textContent).not.toContain("请刷新");
  });
});
