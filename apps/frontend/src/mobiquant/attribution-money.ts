/** API values are untrusted even when the TypeScript interface says string. */
export function decimal(value: unknown): string | null {
  return typeof value === "string" && value.length <= 160 && /^-?\d+(?:\.\d+)?$/.test(value)
    ? value
    : null;
}

/** Exact decimal sum: keep the card total and residual out of floating point. */
export function decimalSum(values: unknown[]): string | null {
  if (!values.length || values.some((value) => decimal(value) == null)) return null;
  const valid = values as string[];
  const scale = Math.max(...valid.map((value) => value.split(".")[1]?.length ?? 0));
  const total = valid.reduce((sum, value) => {
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
    const integer = BigInt(whole + fraction.padEnd(scale, "0"));
    return sum + (negative ? -integer : integer);
  }, 0n);
  const digits = (total < 0n ? -total : total).toString().padStart(scale + 1, "0");
  return `${total < 0n ? "-" : ""}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`;
}

export function negate(value: unknown): string | null {
  const valid = decimal(value);
  return valid == null ? null : valid.startsWith("-") ? valid.slice(1) : `-${valid}`;
}

/** Match usd's half-away-from-zero rounding before reconciling displayed cents. */
export function cents(value: unknown): string | null {
  const valid = decimal(value);
  if (valid == null) return null;
  const negative = valid.startsWith("-");
  const [whole, fraction = ""] = (negative ? valid.slice(1) : valid).split(".");
  const padded = fraction.padEnd(3, "0");
  let result = BigInt(whole) * 100n + BigInt(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) result += 1n;
  return `${negative && result !== 0n ? "-" : ""}${result / 100n}.${(result % 100n).toString().padStart(2, "0")}`;
}
