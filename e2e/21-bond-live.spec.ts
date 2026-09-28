import { expect, test } from "@playwright/test";
import { BASE_URL, loginIfNeeded } from "./helpers";

// Run explicitly against an isolated, non-fixture web server: WF_BOND_LIVE_E2E=1.
test.skip(process.env.WF_BOND_LIVE_E2E !== "1", "requires live TreasuryDirect and quote providers");

test("real bonds enter holdings with correct identity, terms, and quote eligibility", async ({
  page,
}) => {
  test.setTimeout(360_000);
  await loginIfNeeded(page);
  const api = `${BASE_URL}/api/v1`;
  const post = async <T>(path: string, data: Record<string, unknown>): Promise<T> => {
    const response = await page.request.post(`${api}${path}`, { data });
    expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
    return response.json() as Promise<T>;
  };
  const getAssets = async (): Promise<
    Array<{
      id: string;
      instrumentSymbol?: string;
      instrumentType?: string;
      metadata?: {
        bond?: {
          treasuryType?: string;
          couponRate?: number;
          maturityDate?: string;
          couponFrequency?: string;
        };
      };
    }>
  > => {
    const response = await page.request.get(`${api}/assets`);
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const account = await post<{ id: string }>("/accounts", {
    id: `e2e-bond-${Date.now()}`,
    name: "Bond live E2E",
    accountType: "SECURITIES",
    group: null,
    currency: "USD",
    isDefault: false,
    isActive: true,
    isArchived: false,
    trackingMode: "TRANSACTIONS",
    platformId: null,
    accountNumber: null,
    meta: null,
    provider: null,
    providerAccountId: null,
  });

  const accountId = account.id;
  const securities = [
    { label: "bill", cusip: "912797VR5", type: "Bill", coupon: 0 },
    { label: "note", cusip: "91282CRF0", type: "Note", coupon: 0.04625 },
    { label: "bond", cusip: "912810UW6", type: "Bond", coupon: 0.05125 },
    { label: "tips", cusip: "91282CRE3", type: "TIPS" },
    { label: "frn", cusip: "91282CRD5", type: "FRN" },
    { label: "apple", cusip: "037833EZ9" },
  ] as const;
  const activityDate = new Date().toISOString();
  const assetIds: Record<string, string> = {};
  for (const [index, security] of securities.entries()) {
    const id = `${accountId}-${security.label}`;
    const activity = await post<{ assetId: string }>("/activities", {
      id,
      accountId,
      activityType: "BUY",
      activityDate,
      asset: {
        symbol: security.cusip,
        quoteMode: "MARKET",
        quoteCcy: "USD",
        instrumentType: "BOND",
      },
      quantity: 1000,
      unitPrice: 0.98,
      amount: 980,
      currency: "USD",
      fee: 0,
      tax: 0,
      idempotencyKey: id,
    });
    expect(activity.assetId, `${security.label} activity must link an asset`).toBeTruthy();
    assetIds[security.label] = activity.assetId;
    if (index === 0) {
      const assets = await getAssets();
      const bill = assets.find((asset) => asset.id === activity.assetId);
      expect(bill?.instrumentSymbol).toMatch(/^US912797VR5\d$/);
    }
  }

  // Same real Apple issue named by its authoritative ISIN must reuse its CUSIP asset.
  const appleIsin = "US037833EZ91";
  const appleAlias = await post<{ assetId: string }>("/activities", {
    id: `${accountId}-apple-isin`,
    accountId,
    activityType: "BUY",
    activityDate,
    asset: { symbol: appleIsin, quoteMode: "MARKET", quoteCcy: "USD", instrumentType: "BOND" },
    quantity: 500,
    unitPrice: 0.97,
    amount: 485,
    currency: "USD",
    fee: 0,
    tax: 0,
    idempotencyKey: `${accountId}-apple-isin`,
  });
  expect(appleAlias.assetId).toBe(assetIds.apple);

  await expect
    .poll(
      async () => {
        const assets = await getAssets();
        return securities.map((security) => {
          const asset = assets.find((item) => item.id === assetIds[security.label]);
          return {
            label: security.label,
            type: asset?.metadata?.bond?.treasuryType ?? null,
            coupon: asset?.metadata?.bond?.couponRate ?? null,
            maturity: asset?.metadata?.bond?.maturityDate ?? null,
          };
        });
      },
      { timeout: 150_000, intervals: [1000, 3000, 5000] },
    )
    .toEqual([
      expect.objectContaining({ label: "bill", type: "Bill", coupon: 0, maturity: "2027-08-05" }),
      expect.objectContaining({
        label: "note",
        type: "Note",
        coupon: 0.04625,
        maturity: "2036-08-15",
      }),
      expect.objectContaining({
        label: "bond",
        type: "Bond",
        coupon: 0.05125,
        maturity: "2056-08-15",
      }),
      expect.objectContaining({ label: "tips", type: "TIPS" }),
      expect.objectContaining({ label: "frn", type: "FRN" }),
      expect.objectContaining({ label: "apple", type: null, coupon: null }),
    ]);

  const refresh = await page.request.post(`${api}/market-data/sync`, {
    data: { assetIds: Object.values(assetIds), refetchAll: false },
  });
  expect(refresh.status()).toBe(204);
  const latestQuotes = async (): Promise<
    Record<string, { quote?: { close: number; currency: string; dataSource: string } | null }>
  > => {
    return post("/market-data/quotes/latest", { assetIds: Object.values(assetIds) });
  };
  await expect
    .poll(
      async () => {
        const snapshots = await latestQuotes();
        return ["bill", "note", "bond"].map(
          (label) => snapshots[assetIds[label]]?.quote?.dataSource ?? null,
        );
      },
      { timeout: 150_000, intervals: [1000, 3000, 5000] },
    )
    .toEqual(["US_TREASURY_CALC", "US_TREASURY_CALC", "US_TREASURY_CALC"]);
  const snapshots = await latestQuotes();
  for (const label of ["bill", "note", "bond"]) {
    const quote = snapshots[assetIds[label]]?.quote;
    expect(Number(quote?.close)).toBeGreaterThan(0);
    expect(quote?.currency).toBe("USD");
  }
  for (const label of ["tips", "frn", "apple"]) {
    expect(snapshots[assetIds[label]]?.quote?.dataSource).not.toBe("US_TREASURY_CALC");
  }

  const recalc = await page.request.post(`${api}/portfolio/recalculate`);
  expect(recalc.status()).toBe(202);
  await page.goto(`${BASE_URL}/holdings`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("table").first()).toBeVisible({ timeout: 30_000 });
  for (const security of securities) {
    const assets = await getAssets();
    const asset = assets.find((item) => item.id === assetIds[security.label]);
    expect(asset?.instrumentType).toBe("BOND");
    const symbol = asset?.instrumentSymbol;
    expect(symbol).toBeTruthy();
    await expect(page.getByRole("row").filter({ hasText: symbol! }).first()).toBeVisible({
      timeout: 60_000,
    });
  }
  await page.getByRole("button", { name: "Type" }).click();
  await expect(page.getByRole("option", { name: "BONDS 6" })).toBeVisible();
  const holdings = await page.request.get(
    `${api}/holdings/item?accountId=${accountId}&assetId=${assetIds.apple}`,
  );
  expect(holdings.ok()).toBeTruthy();
  expect(Number((await holdings.json()).quantity)).toBe(1500);
  await page.screenshot({ path: "/tmp/wealthfolio-bond-live-holdings.png", fullPage: true });
});
