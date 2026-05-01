import { useMemo, useState } from "react";
import { Calculator, CalendarClock, Wallet2 } from "lucide-react";
import { cn, formatCompact, formatCurrency, toNum } from "@/lib/utils";
import {
  annualContribution,
  lumpsumFutureValue,
  sipFutureValue,
  sipInvested,
  type Frequency,
} from "@/lib/sip";

interface MfReturnCalculatorProps {
  /** Suggested annual return (e.g., the fund's 5y CAGR if available). */
  suggestedRate?: number;
}

type Mode = "lumpsum" | "sip";

const yearsPresets = [3, 5, 10, 15, 20, 25];
const frequencies: Array<{ value: Frequency; label: string }> = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

export function MfReturnCalculator({ suggestedRate }: MfReturnCalculatorProps) {
  const [mode, setMode] = useState<Mode>("sip");
  const defaultRate = suggestedRate && suggestedRate > 0 ? Math.min(Math.max(suggestedRate, 4), 20) : 12;
  const [amount, setAmount] = useState(mode === "lumpsum" ? "100000" : "5000");
  const [years, setYears] = useState(10);
  const [rate, setRate] = useState(defaultRate);
  const [frequency, setFrequency] = useState<Frequency>("monthly");

  const amountNum = toNum(amount);

  const result = useMemo(() => {
    if (mode === "lumpsum") {
      const fv = lumpsumFutureValue(amountNum, years, rate / 100);
      return {
        invested: amountNum,
        futureValue: fv,
        gain: fv - amountNum,
      };
    }
    const fv = sipFutureValue(amountNum, frequency, years, rate / 100);
    const invested = sipInvested(amountNum, frequency, years);
    return { invested, futureValue: fv, gain: fv - invested };
  }, [mode, amountNum, years, rate, frequency]);

  const annual = mode === "sip" ? annualContribution(amountNum, frequency) : 0;

  return (
    <section className="card p-5">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="label flex items-center gap-2">
            <Calculator className="h-3.5 w-3.5" />
            Return calculator
          </div>
          <div className="mt-1.5 text-xs text-fg-muted">
            Project a what-if scenario at any expected return
            {suggestedRate ? ` (default ${defaultRate.toFixed(2)}% — fund's recent CAGR)` : ""}.
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-soft p-0.5">
          <ModeBtn
            active={mode === "lumpsum"}
            onClick={() => {
              setMode("lumpsum");
              if (toNum(amount) < 10000) setAmount("100000");
            }}
            icon={<Wallet2 className="h-3.5 w-3.5" />}
            label="Lumpsum"
          />
          <ModeBtn
            active={mode === "sip"}
            onClick={() => {
              setMode("sip");
              if (toNum(amount) > 50000) setAmount("5000");
            }}
            icon={<CalendarClock className="h-3.5 w-3.5" />}
            label="SIP"
          />
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {/* Inputs */}
        <div className="space-y-4">
          <div>
            <label className="label">{mode === "lumpsum" ? "Investment" : "SIP amount per run"}</label>
            <div className="relative mt-1.5">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted">
                ₹
              </span>
              <input
                className="input num pl-7 text-lg"
                type="number"
                step="any"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>

          {mode === "sip" && (
            <div>
              <label className="label">Frequency</label>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {frequencies.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFrequency(f.value)}
                    className={cn(
                      "rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
                      frequency === f.value
                        ? "border-brand bg-brand/10 text-fg"
                        : "border-border bg-bg-soft text-fg-muted hover:border-border-strong",
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between">
              <label className="label">Investment horizon</label>
              <span className="num text-xs font-medium text-brand">{years} years</span>
            </div>
            <input
              type="range"
              min={1}
              max={30}
              step={1}
              value={years}
              onChange={(e) => setYears(parseInt(e.target.value, 10))}
              className="mt-1.5 w-full accent-brand"
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {yearsPresets.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => setYears(y)}
                  className={cn(
                    "num rounded-full border px-2 py-0.5 text-[11px]",
                    years === y
                      ? "border-brand bg-brand/10 text-fg"
                      : "border-border text-fg-muted hover:border-border-strong",
                  )}
                >
                  {y}y
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="label">Expected return p.a.</label>
              <span className="num text-xs font-medium text-brand">{rate.toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min={4}
              max={25}
              step={0.5}
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              className="mt-1.5 w-full accent-brand"
            />
          </div>
        </div>

        {/* Result */}
        <div className="flex flex-col justify-center rounded-xl border border-border bg-bg-soft/40 p-5">
          <div className="label">Estimated future value</div>
          <div className="num mt-1 text-3xl font-semibold">
            {formatCurrency(result.futureValue)}
          </div>
          <div className="num mt-0.5 text-[11px] text-fg-muted">
            ≈ {formatCompact(result.futureValue)}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <Stat label="Invested" value={formatCompact(result.invested)} />
            <Stat
              label="Wealth gained"
              value={formatCompact(result.gain)}
              tone={result.gain >= 0 ? "pos" : "neg"}
            />
          </div>

          {mode === "sip" && annual > 0 && (
            <div className="mt-3 text-[11px] text-fg-subtle">
              Commitment: <span className="text-fg">{formatCompact(annual)}</span>/year
              · {formatCompact(amountNum)}/{frequency.replace(/ly$/, "")}
            </div>
          )}

          <p className="mt-4 text-[11px] text-fg-subtle">
            Compounding assumes the chosen rate is realised every year — actual
            returns vary year-to-year. SIP uses end-of-period contributions.
          </p>
        </div>
      </div>
    </section>
  );
}

function ModeBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
        active ? "bg-overlay/10 text-fg" : "text-fg-muted hover:text-fg",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div>
      <div className="label">{label}</div>
      <div
        className={cn(
          "num mt-0.5 text-base font-semibold",
          tone === "pos" && "pos",
          tone === "neg" && "neg",
        )}
      >
        {value}
      </div>
    </div>
  );
}
