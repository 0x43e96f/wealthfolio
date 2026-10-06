import { describe, expect, it } from "vitest";
import { ownedAccounts, usd, type Context } from "./client";

describe("financial display and authoritative inclusion", () => {
  it("rounds exact decimals without losing large integer precision", () => {
    expect(usd("9007199254740993.125")).toBe("$9,007,199,254,740,993.13");
    expect(usd("-0.005")).toBe("-$0.01");
    expect(usd("0.004")).toBe("$0.00");
    expect(usd(null)).toBe("—");
    expect(usd("NaN")).toBe("—");
  });
  it("excludes watch, disconnected and duplicate accounts", () => {
    const accounts = [
      { id: "owned", included: true, enabled: true, ownership: "owned" },
      { id: "watch", included: true, enabled: true, ownership: "watch" },
      { id: "duplicate", included: false, enabled: true, ownership: "owned" },
      { id: "disabled", included: true, enabled: false, ownership: "owned" },
    ];
    const context = { overview: { accounts } } as unknown as Context;
    expect(ownedAccounts(context).map((account) => account.id)).toEqual(["owned"]);
  });
});
