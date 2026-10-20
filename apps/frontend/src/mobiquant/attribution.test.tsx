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
  it("keeps its side while it fades out and is not reopened from under the pointer", async () => {
    mock();
    // As in a browser: the panel animates out, and stays in the page until that ends.
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = real(element);
      return new Proxy(style, {
        get: (target, key) =>
          key === "animationName" && element instanceof HTMLElement && element.dataset.state
            ? `fade-${element.dataset.state}`
            : (Reflect.get(target, key) as unknown),
      });
    });
    render(view());
    const trigger = screen.getByRole("button", { name: "查看今日净值变化明细" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(new DOMRect(800, 0, 300, 120));
    const content = (await hover()).closest<HTMLElement>("[data-side]")!;
    expect(content.dataset.side).toBe("left");
    fireEvent.mouseLeave(trigger);
    await waitFor(() => expect(content.dataset.state).toBe("closed"));
    // Moved under the card it would land under a pointer heading for the tabs.
    expect(content.dataset.side).toBe("left");
    fireEvent.mouseEnter(content);
    expect(content.dataset.state).toBe("closed");
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
      expect(within(region).getByText("净值变化").nextElementSibling).toHaveTextContent("—");
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
  it("opens on hover, uses card total and lists the assets that moved", async () => {
    mock();
    render(view());
    expect(fetch).not.toHaveBeenCalled();
    const region = await hover();
    expect(within(region).getByText("净值变化").nextElementSibling).toHaveTextContent("+$20.00");
    expect(within(region).getByText("其余差额").nextElementSibling).toHaveTextContent("+$5.00");
    expect(within(region).getByText("AAPL")).toBeVisible();
    expect(within(region).queryByText(/投资盈亏/)).not.toBeInTheDocument();
  });
  it("leaves out what moved less than ten dollars or cannot be compared, and says how many", async () => {
    const found = fixture();
    const small = (symbol: string, price: string, quantity: string) => ({
      ...found.assets[0],
      asset: symbol,
      symbol,
      accounts: [
        {
          ...found.assets[0].accounts[0],
          source_asset: symbol,
          price_effect_usd: price,
          quantity_effect_usd: quantity,
        },
      ],
    });
    const assets: unknown[] = found.assets;
    assets.push(
      small("DUST", "9.99", "-9.99"),
      small("EDGE", "-10", "0"),
      small("MOVED", "0.4", "-250"),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(found) }),
    );
    render(view());
    const region = await hover();
    expect(within(region).queryByText("DUST")).not.toBeInTheDocument();
    expect(within(region).queryByText("Private Manual Account")).not.toBeInTheDocument();
    expect(within(region).getByText("EDGE")).toBeVisible();
    // A change of quantity is money moved, not made: it lists nothing by itself.
    expect(within(region).queryByText("MOVED")).not.toBeInTheDocument();
    expect(region.textContent).not.toContain("250.00");
    expect(region.textContent).toContain("另有 3 项涨跌不足 $10 或无法逐项比较");
    // The totals above the list are still of everything.
    expect(
      within(region).getByText("价格影响", { selector: "p" }).nextElementSibling,
    ).toHaveTextContent("+$10.00");
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
    expect(region.textContent).not.toMatch(/\d%/);
  });
  it("filters contributions without changing the card total", async () => {
    mock();
    render(view());
    const region = await hover();
    fireEvent.change(screen.getByLabelText("归因账户"), { target: { value: "two" } });
    const row = within(region).getByText("AAPL").closest("summary")!;
    expect(row.textContent).toContain("-$10.00");
    expect(within(region).getByText("净值变化").nextElementSibling).toHaveTextContent("$20.00");
    expect(region.textContent).toContain("共 1 项");
  });
  it("says what a holding sold today made, sold out or in part, and in what currency", async () => {
    const found = fixture();
    const sale = (symbol: string, closed: object, price: string | null = "0") => ({
      ...found.assets[0],
      asset: symbol,
      symbol,
      price_effect_usd: price,
      accounts: [
        {
          ...found.assets[0].accounts[0],
          source_asset: symbol,
          price_effect_usd: price,
          quantity_effect_usd: price,
          closed: {
            flat: true,
            quote: "USD",
            change_pct: "-0.7",
            basis: "computed",
            average_buy: "1087",
            average_sell: "1079",
            quantity: "9",
            opened_at: "2026-10-09T10:00:42+00:00",
            ...closed,
          },
        },
      ],
    });
    const assets: unknown[] = found.assets;
    assets.push(
      sale("LITE", { realized: "-72", realized_usd: "-72" }, null),
      sale("PEPE", { realized: "310.5", realized_usd: "310.5", flat: false }, "-477"),
      sale("06651", { realized: "-5920", realized_usd: null, quote: "HKD" }),
      sale("PENNY", { realized: "3", realized_usd: "3" }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(found) }),
    );
    render(view());
    const region = await hover();
    const row = (symbol: string) => within(region).getByText(symbol).closest("summary")!;
    // Sold out in an account that is not split today: no price effect, the result all the same.
    expect(row("LITE").textContent).toContain("已清仓");
    expect(row("LITE").textContent).toContain("-$72.00");
    expect(row("PEPE").textContent).toContain("今日卖出");
    expect(row("PEPE").textContent).toContain("+$310.50");
    expect(row("06651").textContent).toContain("-5,920.00 HKD");
    expect(within(region).queryByText("PENNY")).not.toBeInTheDocument();
    expect(row("LITE").parentElement!.textContent).toContain(
      "买入均价 1,087 → 卖出均价 1,079 USD · 卖出 9 · 10-09 起 · 按成交均价算",
    );
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
    expect(screen.getByRole("status")).toHaveTextContent("日期对齐前不算差额和占比");
    expect(
      within(region).getByText("价格影响", { selector: "p" }).nextElementSibling,
    ).toHaveTextContent("$10.00");
    expect(within(region).getByText("其余差额").nextElementSibling).toHaveTextContent("—");
    expect(within(region).getByText("AAPL").closest("summary")!.textContent).not.toContain("%");
    expect(region.textContent).not.toContain("请刷新");
  });
});
