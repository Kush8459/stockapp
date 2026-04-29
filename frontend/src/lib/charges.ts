/**
 * Mirrors backend charges model so trade dialogs can preview brokerage +
 * statutory before the user submits. Backend recomputes authoritatively;
 * the UI just shows what the wallet will see.
 *
 * Stocks (delivery):
 *   - Brokerage: min(0.1% × turnover, ₹20)
 *   - Statutory: 0.1% on sell-side / 0.015% on buy-side  (STT + stamp)
 *   - GST 18% on brokerage
 * Mutual funds (Direct plans):
 *   - All charges zero (we don't model exit load)
 */
export interface Charges {
  brokerage: number;
  statutory: number;
  total: number;
}

export function computeCharges(
  assetType: string,
  side: "buy" | "sell",
  qty: number,
  price: number,
): Charges {
  const turnover = qty * price;
  if (!Number.isFinite(turnover) || turnover <= 0) {
    return { brokerage: 0, statutory: 0, total: 0 };
  }
  if (assetType === "mf") {
    return { brokerage: 0, statutory: 0, total: 0 };
  }
  const brokerageRaw = Math.min(turnover * 0.001, 20);
  const gst = brokerageRaw * 0.18;
  const stat = side === "sell" ? turnover * 0.001 : turnover * 0.00015;
  const brokerage = round2(brokerageRaw);
  const statutory = round2(stat + gst);
  return { brokerage, statutory, total: round2(brokerage + statutory) };
}

/**
 * The cash that leaves (buy) or enters (sell) the wallet.
 *   buy:  qty*price + total
 *   sell: qty*price − total
 */
export function netAmount(
  side: "buy" | "sell",
  qty: number,
  price: number,
  charges: Charges,
): number {
  const gross = qty * price;
  if (side === "sell") return Math.max(0, round2(gross - charges.total));
  return round2(gross + charges.total);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
