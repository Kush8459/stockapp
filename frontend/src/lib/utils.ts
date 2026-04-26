import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format an INR currency value (locale grouping with ₹ prefix). */
export function formatCurrency(value: number, opts: { maxFractionDigits?: number } = {}) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: opts.maxFractionDigits ?? 2,
  }).format(Number.isFinite(value) ? value : 0);
}

/**
 * Format a compact INR value using Indian numbering (Lakh / Crore / Lakh-Crore).
 * Drops decimals once the integer part is 4+ digits so axis labels don't blow
 * out their column.
 *   1.2k, 3.4Cr, 19LCr (= 19 lakh crore)
 */
export function formatCompact(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const fmt = (n: number, unit: string) => {
    // 12.34Cr is fine, but 1234.56Cr has too many digits — drop decimals
    // once the integer part already has 4+ digits.
    const digits = n >= 1000 ? 0 : 2;
    return `${sign}₹${n.toFixed(digits)}${unit}`;
  };
  if (abs >= 1e12) return fmt(abs / 1e12, "LCr"); // lakh-crore (₹1 trillion)
  if (abs >= 1e7) return fmt(abs / 1e7, "Cr");
  if (abs >= 1e5) return fmt(abs / 1e5, "L");
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}k`;
  return `${sign}₹${abs.toFixed(2)}`;
}

export function formatPercent(value: number, digits = 2) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${(Number.isFinite(value) ? value : 0).toFixed(digits)}%`;
}

export function toNum(v: string | number | undefined | null): number {
  if (v === undefined || v === null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
