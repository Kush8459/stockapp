export interface Portfolio {
  id: string;
  userId: string;
  name: string;
  baseCcy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Holding {
  id: string;
  portfolioId: string;
  ticker: string;
  assetType: "stock" | "mf";
  quantity: string;
  avgBuyPrice: string;
  currentPrice: string;
  currentValue: string;
  invested: string;
  pnl: string;
  pnlPercent: string;
  dayChangePct: string;
  updatedAt: string;
}

export interface Summary {
  portfolioId: string;
  invested: string;
  currentValue: string;
  pnl: string;
  pnlPercent: string;
  dayChange: string;
  holdingCount: number;
}

export type TxnSource = "manual" | "sip" | "alert" | "rebalance";

export interface Transaction {
  id: string;
  userId: string;
  portfolioId: string;
  ticker: string;
  assetType: string;
  side: "buy" | "sell";
  quantity: string;
  price: string;
  /** Legacy gross + fees. New code should prefer netAmount + brokerage + statutory. */
  totalAmount: string;
  fees: string;
  /** Brokerage charge for this leg. Zero on MFs and pre-wallet rows. */
  brokerage?: string;
  /** Statutory charges + GST. Zero on MFs and pre-wallet rows. */
  statutory?: string;
  /**
   * Cash that hit the wallet:
   *   buy:  qty*price + brokerage + statutory  (debit)
   *   sell: qty*price − brokerage − statutory  (credit)
   * Zero on rows from before the wallet was introduced.
   */
  netAmount?: string;
  note?: string | null;
  source: TxnSource;
  sourceId?: string | null;
  executedAt: string;
}

export interface LedgerEntry {
  id: number;
  account: string;
  direction: "debit" | "credit";
  amount: string;
  currency: string;
  createdAt: string;
}

export interface AuditRow {
  id: number;
  action: string;
  entityType: string;
  entityId?: string | null;
  payload: unknown;
  ip?: string | null;
  createdAt: string;
}

export interface TransactionDetail {
  transaction: Transaction;
  ledgerEntries: LedgerEntry[];
  auditEntries: AuditRow[];
}
