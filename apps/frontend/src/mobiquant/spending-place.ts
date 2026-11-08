import type { SpendingRecord } from "./client";

// Where a row was spent: a country and a city. A row on a trip takes the trip's place
// (read from the trip's name: 上海（2023-05） is 中国 / 上海, 丽江+大理 is 中国 / 丽江+大理);
// a trip across countries (泰国+越南) places each row by its currency. A row on no trip
// was spent at home: Wuxi for yuan, Kelowna for Canadian dollars (Vancouver before the
// owner moved away on 2021-05-04), and 不分地点 for what names no place (US-dollar
// subscriptions, crypto payments). A card swipe that names no place is placed by the
// day it was made (placesFor).

export interface Place {
  country: string;
  city: string;
}

export const NOWHERE = "不分地点";
const LEFT_VANCOUVER = "2021-05-04";

// A word of a trip's name and the place it names.
const PLACES: Record<string, Place> = {
  香港: { country: "中国香港", city: "香港" },
  港澳: { country: "中国香港", city: "香港" },
  澳门: { country: "中国澳门", city: "澳门" },
  台湾: { country: "中国台湾", city: "台湾" },
  日本: { country: "日本", city: "日本" },
  韩国: { country: "韩国", city: "韩国" },
  泰国: { country: "泰国", city: "泰国" },
  越南: { country: "越南", city: "越南" },
  佛罗里达: { country: "美国", city: "佛罗里达" },
  夏威夷: { country: "美国", city: "夏威夷" },
  温哥华: { country: "加拿大", city: "温哥华" },
  惠斯勒: { country: "加拿大", city: "惠斯勒" },
  多伦多: { country: "加拿大", city: "多伦多" },
  尼亚加拉: { country: "加拿大", city: "尼亚加拉" },
  纽芬兰自驾: { country: "加拿大", city: "纽芬兰" },
  房车露营: { country: "加拿大", city: "BC 房车露营" },
};
const CURRENCY: Record<string, string> = {
  CNY: "中国",
  HKD: "中国香港",
  MOP: "中国澳门",
  TWD: "中国台湾",
  JPY: "日本",
  KRW: "韩国",
  THB: "泰国",
  VND: "越南",
  USD: "美国",
  CAD: "加拿大",
};
// Place words in a row's text that name its country, for trips across countries where
// the currency does not tell (a hotel in Da Nang booked in yuan on Ctrip).
const PLACE_WORDS: [RegExp, string][] = [
  [/曼谷|普吉|清迈|BANGKOK|PHUKET|CHIANG MAI|THAILAND/i, "泰国"],
  [/胡志明|西贡|会安|岘港|巴拿山|河内|HO CHI MINH|SAIGON|HOI AN|DA ?NANG|HANOI|VIETNAM/i, "越南"],
  [/大阪|京都|东京|東京|関西|OSAKA|KYOTO|TOKYO|JAPAN/i, "日本"],
  [/香港|HONG ?KONG/i, "中国香港"],
  [/澳门|MACAU|MACAO/i, "中国澳门"],
];
// Rows that come from Chinese platforms are spent in yuan even when no currency is given.
const CHINESE_SOURCES = new Set([
  "alipay",
  "wechat",
  "cmb",
  "jd",
  "pdd",
  "douyin",
  "meituan",
  "eleme",
  "ctrip",
]);

// A trip's places, one per word of its name (the part before any bracket, split on +).
export function tripPlaces(name: string): Place[] {
  const base = name.replace(/（.*?）/g, "").trim();
  return base.split("+").map((word) => PLACES[word] ?? { country: "中国", city: word });
}

const currencyCountry = (row: SpendingRecord) => {
  const currency = row.orig_currency?.toUpperCase() ?? "";
  if (CURRENCY[currency]) return CURRENCY[currency];
  return CHINESE_SOURCES.has(row.source ?? "") ? "中国" : "";
};

export function placeOf(row: SpendingRecord): Place {
  const trip = (row.tags ?? []).find((tag) => tag.kind === "旅行" && tag.value)?.value;
  if (trip) {
    const places = tripPlaces(trip);
    const countries = [...new Set(places.map((place) => place.country))];
    if (countries.length === 1) {
      const city = places.length === 1 ? places[0].city : trip.replace(/（.*?）/g, "").trim();
      return { country: countries[0], city };
    }
    // Across countries: a place named in the row, else its currency, picks the country.
    const text = `${row.label ?? ""} ${row.description}`;
    const named = PLACE_WORDS.find(([pattern]) => pattern.test(text))?.[1];
    const country = named && countries.includes(named) ? named : currencyCountry(row);
    const match = places.find((place) => place.country === country) ?? places[0];
    return { country: match.country, city: match.city };
  }
  // Gift cards and phone top-ups bought with crypto (JD cards …) are spent in China,
  // wherever the owner was when buying them.
  if (row.source === "crypto" && row.category === "礼品卡与话费")
    return { country: "中国", city: "无锡（家）" };
  const country = currencyCountry(row);
  if (country === "中国") return { country, city: "无锡（家）" };
  if (country === "加拿大")
    return { country, city: row.day < LEFT_VANCOUVER ? "温哥华（家）" : "基洛纳（家）" };
  if (!country || country === "美国") return { country: NOWHERE, city: NOWHERE };
  return { country, city: country };
}

export const placeKey = (place: Place) => `${place.country}\u0000${place.city}`;

// Card payments that name no place (a Bitget swipe has no merchant) were made wherever
// the owner was that day: the place most of that day's other rows were spent in, or the
// day before or after. Subscriptions stay 不分地点.
const CARD_SOURCES = new Set(["bitget", "plasma", "solayer", "etherfi"]);
const ONLINE_CATEGORIES = new Set(["订阅与软件", "公司事务", "卡费用"]);

export function placesFor(records: SpendingRecord[]): Map<string, Place> {
  const found = new Map<string, Place>();
  const byDay = new Map<string, Map<string, { place: Place; count: number }>>();
  for (const row of records) {
    const place = placeOf(row);
    found.set(row.id, place);
    if (place.country === NOWHERE) continue;
    const day = byDay.get(row.day) ?? new Map<string, { place: Place; count: number }>();
    const seen = day.get(placeKey(place)) ?? { place, count: 0 };
    day.set(placeKey(place), { place, count: seen.count + 1 });
    byDay.set(row.day, day);
  }
  const shift = (day: string, by: number) => {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + by);
    return date.toISOString().slice(0, 10);
  };
  for (const row of records) {
    if (found.get(row.id)?.country !== NOWHERE) continue;
    if (!CARD_SOURCES.has(row.source ?? "") || ONLINE_CATEGORIES.has(row.category)) continue;
    for (const day of [row.day, shift(row.day, -1), shift(row.day, 1)]) {
      const there = [...(byDay.get(day)?.values() ?? [])].sort((a, b) => b.count - a.count)[0];
      if (there) {
        found.set(row.id, there.place);
        break;
      }
    }
  }
  return found;
}

// A card's name as the owner knows it: the crypto cards' exports name them by a code
// (plasma, 5522, 1861), so the page says which card that is.
export function cardName(row: SpendingRecord): string {
  const card = row.card ?? "";
  if (row.source === "plasma") return "Plasma 卡";
  if (row.source === "solayer") return card ? `Solayer 卡 ${card}` : "Solayer 卡";
  if (row.source === "etherfi") return card ? `ether.fi 卡 ${card}` : "ether.fi 卡";
  return card || row.source || "";
}
