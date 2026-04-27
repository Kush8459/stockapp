// New SIPs are monthly or yearly only. The other two values stay in the
// type so legacy plans displayed in lists / detail panes still type-check;
// they're not surfaced as choices in any creation flow.
export type Frequency = "daily" | "weekly" | "monthly" | "yearly";

export function periodsPerYear(f: Frequency): number {
  switch (f) {
    case "daily":
      return 365;
    case "weekly":
      return 52;
    case "monthly":
      return 12;
    case "yearly":
      return 1;
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

/** Lumpsum future value: principal × (1 + r)^years, compounded annually. */
export function lumpsumFutureValue(
  principal: number,
  years: number,
  annualRate: number,
): number {
  if (principal <= 0 || years <= 0) return principal;
  return principal * Math.pow(1 + annualRate, years);
}

/** Today's date as YYYY-MM-DD in the user's local timezone (the format
 *  HTML `<input type="date">` consumes). */
export function todayLocalISODate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Converts a YYYY-MM-DD picked from the date input into an RFC3339 string
 * the backend can parse for `firstRunAt`. If the user picked today, fire
 * "now" so the SIP runs on the next scheduler tick; if they picked a
 * future date, anchor to local midnight on that day.
 */
export function startDateToFirstRunAt(yyyymmdd: string): string {
  if (!yyyymmdd) return new Date().toISOString();
  if (yyyymmdd === todayLocalISODate()) return new Date().toISOString();
  // T00:00:00 (no Z) is parsed as local midnight by the JS engine — what
  // we want, since the user chose a calendar day in their timezone.
  return new Date(`${yyyymmdd}T00:00:00`).toISOString();
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
    if (f === "daily") {
      t = new Date(t.getTime() + 86_400_000);
    } else if (f === "weekly") {
      t = new Date(t.getTime() + 7 * 86_400_000);
    } else if (f === "yearly") {
      t = new Date(t);
      t.setFullYear(t.getFullYear() + 1);
    } else {
      // monthly
      t = new Date(t);
      t.setMonth(t.getMonth() + 1);
    }
    out.push(t);
  }
  return out;
};
