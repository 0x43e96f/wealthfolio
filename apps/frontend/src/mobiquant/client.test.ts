import { describe, expect, it } from "vitest";
import { convert, ownedAccounts, usd, type Context } from "./client";

describe("financial display and authoritative inclusion", () => {
  it.each([20, {}, [], undefined, "1.2.3", "9".repeat(161)])(
    "masks malformed API money %j without throwing",
    (value) => {
      expect(usd(value)).toBe("—");
    },
  );
  it("rounds exact decimals without losing large integer precision", () => {
    expect(usd("9007199254740993.125")).toBe("$9,007,199,254,740,993.13");
    expect(usd("-0.005")).toBe("-$0.01");
    expect(usd("0.004")).toBe("$0.00");
    expect(usd(null)).toBe("—");
    expect(usd("NaN")).toBe("—");
  });
  it("turns a dollar figure into another currency exactly", () => {
    expect(convert("23.45", "1.421400")).toBe("33.33183000");
    expect(convert("-100", "7.1")).toBe("-710.0");
    expect(convert("9007199254740993.1", "2")).toBe("18014398509481986.2");
    expect(convert("-0", "7.1")).toBe("0.0");
    expect(convert(null, "7.1")).toBeNull();
    expect(convert("1", "abc")).toBeNull();
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
