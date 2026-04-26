import { useState } from "react";
import { motion } from "framer-motion";
import {
  Briefcase,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Info,
  Users,
} from "lucide-react";
import { useFundamentals } from "@/hooks/useFundamentals";

interface Props {
  ticker: string;
}

/**
 * Static company-profile card. Sector/industry, employees, website,
 * description. Drawn from Yahoo's summaryProfile module.
 */
export function AboutCard({ ticker }: Props) {
  const { data, isLoading } = useFundamentals(ticker);
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <section className="card p-5">
        <div className="label">About</div>
        <div className="mt-3 text-sm text-fg-muted">Loading…</div>
      </section>
    );
  }

  if (!data || (!data.description && !data.sector && !data.industry)) {
    return null; // hide silently if no profile data
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-5"
    >
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label inline-flex items-center gap-1.5">
            <Info className="h-3 w-3" /> About
          </div>
          {(data.sector || data.industry) && (
            <p className="mt-1 text-xs text-fg-muted">
              {[data.sector, data.industry].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        {data.website && (
          <a
            href={normalizeUrl(data.website)}
            target="_blank"
            rel="noreferrer"
            className="num inline-flex items-center gap-1 text-[11px] text-fg-muted hover:text-brand"
          >
            {prettyDomain(data.website)} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </header>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <Field label="Sector" value={data.sector} />
        <Field label="Industry" value={data.industry} />
        <Field
          label="Employees"
          value={
            data.fullTimeEmployees != null ? (
              <span className="num inline-flex items-center gap-1">
                <Users className="h-3 w-3 text-fg-subtle" />
                {data.fullTimeEmployees.toLocaleString("en-IN")}
              </span>
            ) : null
          }
        />
      </div>

      {data.description && (
        <div className="mt-4 border-t border-border/40 pt-4">
          <div className="label mb-2 inline-flex items-center gap-1.5">
            <Briefcase className="h-3 w-3" /> Business
          </div>
          <p className="text-sm leading-relaxed text-fg-muted">
            {expanded ? data.description : truncate(data.description, 320)}
          </p>
          {data.description.length > 320 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
            >
              {expanded ? (
                <>
                  Show less <ChevronUp className="h-3 w-3" />
                </>
              ) : (
                <>
                  Read more <ChevronDown className="h-3 w-3" />
                </>
              )}
            </button>
          )}
        </div>
      )}
    </motion.section>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  if (value == null || value === "") return null;
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n).replace(/\s+\S*$/, "") + "…";
}
function normalizeUrl(u: string): string {
  if (!u) return "#";
  if (!/^https?:\/\//i.test(u)) return "https://" + u;
  return u;
}
function prettyDomain(u: string): string {
  return u.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
