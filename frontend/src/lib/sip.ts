export type Frequency = "daily" | "weekly" | "monthly";

export function periodsPerYear(f: Frequency): number {
  switch (f) {
    case "daily":
      return 365;
    case "weekly":
      return 52;
    case "monthly":
      return 12;
  }
}

/** Annualized contribution at this cadence. */
export function annualContribution(amount: number, f: Frequency): number {
  return amount * periodsPerYear(f);
}

/**
 * Future value of an ordinary SIP (fixed contribution at the end of each
 * period) compounded at `annualRate`.
 *   FV = A * ((1 + r)^n − 1) / r      where r = annualRate / periodsPerYear
 */
export function sipFutureValue(
  amount: number,
  f: Frequency,
  years: number,
  annualRate: number,
): number {
  if (amount <= 0 || years <= 0) return 0;
  const ppy = periodsPerYear(f);
  const r = annualRate / ppy;
  const n = years * ppy;
  if (r === 0) return amount * n;
  return (amount * (Math.pow(1 + r, n) - 1)) / r;
}

/** Cumulative invested amount across `years`. */
export function sipInvested(amount: number, f: Frequency, years: number): number {
  return amount * periodsPerYear(f) * years;
}

/** Build {year, invested, value} series for an area chart. */
export function sipSeries(
  amount: number,
  f: Frequency,
  maxYears: number,
  annualRate: number,
): Array<{ year: number; invested: number; value: number }> {
  const out: Array<{ year: number; invested: number; value: number }> = [];
  for (let y = 0; y <= maxYears; y++) {
    out.push({
      year: y,
      invested: sipInvested(amount, f, y),
      value: sipFutureValue(amount, f, y, annualRate),
    });
  }
  return out;
}

export const nextRunDates = (from: Date, f: Frequency, count: number): Date[] => {
  const out: Date[] = [];
  let t = new Date(from);
  for (let i = 0; i < count; i++) {
    if (f === "daily") t = new Date(t.getTime() + 86_400_000);
    else if (f === "weekly") t = new Date(t.getTime() + 7 * 86_400_000);
    else {
      t = new Date(t);
      t.setMonth(t.getMonth() + 1);
    }
    out.push(t);
  }
  return out;
};
