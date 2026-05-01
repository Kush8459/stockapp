import { useState } from "react";
import { motion } from "framer-motion";
import { Bell, BellOff, Plus, Trash2 } from "lucide-react";
import { useAlerts, useDeleteAlert, type Alert } from "@/hooks/useAlerts";
import { AlertForm } from "@/components/AlertForm";
import { useAlertEvents } from "@/store/alertEvents";
import { useLivePrices } from "@/hooks/useLivePrices";
import { cn, formatCurrency, formatPercent, toNum } from "@/lib/utils";

export function AlertsPage() {
  const { data = [], isLoading } = useAlerts();
  const del = useDeleteAlert();
  const [showForm, setShowForm] = useState(false);
  const { quotes } = useLivePrices();
  const recent = useAlertEvents((s) => s.recent);

  const active = data.filter((a) => !a.triggered);
  const fired = data.filter((a) => a.triggered);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-fg-muted">Notifications</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Price alerts</h1>
          <p className="mt-1 text-sm text-fg-muted">
            We watch the live feed and ping you the moment the price crosses your target.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4" /> New alert
        </button>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Metric label="Active" value={active.length} tone="brand" />
        <Metric label="Triggered today" value={fired.length} tone="success" />
        <Metric label="Total" value={data.length} />
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <div className="label">Active</div>
          <div className="text-xs text-fg-muted">{active.length} watching</div>
        </div>
        {isLoading ? (
          <div className="py-10 text-center text-sm text-fg-muted">Loading…</div>
        ) : active.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y divide-border/40">
            {active.map((a, i) => (
              <AlertRow
                key={a.id}
                alert={a}
                livePrice={quotes[a.ticker] ? toNum(quotes[a.ticker].price) : undefined}
                index={i}
                onDelete={() => del.mutate(a.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {(fired.length > 0 || recent.length > 0) && (
        <section className="card overflow-hidden">
          <div className="border-b border-border px-5 py-4">
            <div className="label">Triggered</div>
            <div className="text-xs text-fg-muted">
              {fired.length} total
              {recent.length > 0 && ` · ${recent.length} this session`}
            </div>
          </div>
          <ul className="divide-y divide-border/40">
            {fired.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between px-5 py-3 text-sm"
              >
                <div className="flex items-center gap-3">
                  <BellOff className="h-4 w-4 text-fg-muted" />
                  <div>
                    <div className="font-medium">{a.ticker}</div>
                    <div className="text-xs text-fg-muted">
                      {a.direction} {formatCurrency(toNum(a.targetPrice))}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-fg-muted">
                  {a.triggeredAt ? new Date(a.triggeredAt).toLocaleString() : "—"}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AlertForm open={showForm} onOpenChange={setShowForm} />
    </div>
  );
}

function AlertRow({
  alert,
  livePrice,
  index,
  onDelete,
}: {
  alert: Alert;
  livePrice?: number;
  index: number;
  onDelete: () => void;
}) {
  const target = toNum(alert.targetPrice);
  const distance = livePrice ? ((target - livePrice) / livePrice) * 100 : null;

  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 10) * 0.03 }}
      className="flex items-center justify-between gap-4 px-5 py-4"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/15 text-brand">
          <Bell className="h-4 w-4" />
        </div>
        <div>
          <div className="flex items-center gap-2 font-medium">
            {alert.ticker}
            <span
              className={cn(
                "chip text-[10px] uppercase",
                alert.direction === "above"
                  ? "border-success/30 text-success"
                  : "border-danger/30 text-danger",
              )}
            >
              {alert.direction === "above" ? "goes above" : "drops below"}
            </span>
          </div>
          <div className="num text-xs text-fg-muted">
            target {formatCurrency(target)}
            {livePrice && (
              <>
                {" · now "}
                <span className="text-fg">{formatCurrency(livePrice)}</span>
                {distance !== null && (
                  <span className="ml-1">({formatPercent(distance)})</span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="rounded-md p-2 text-fg-muted hover:bg-overlay/5 hover:text-danger"
        aria-label="Delete alert"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </motion.li>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "brand" | "success" }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div
        className={cn(
          "num mt-2 text-2xl font-semibold",
          tone === "brand" && "text-brand",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="px-6 py-12 text-center">
      <Bell className="mx-auto h-8 w-8 text-fg-subtle" />
      <p className="mt-3 text-sm text-fg-muted">No active alerts yet.</p>
    </div>
  );
}
