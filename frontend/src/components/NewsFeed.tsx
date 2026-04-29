import { motion } from "framer-motion";
import { ExternalLink, Newspaper, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { useNews, type NewsArticle, type NewsError, type Sentiment } from "@/hooks/useNews";
import { cn } from "@/lib/utils";

interface NewsFeedProps {
  ticker: string;
}

/** News card for the stock detail page. */
export function NewsFeed({ ticker }: NewsFeedProps) {
  const { data, isLoading, error } = useNews(ticker);

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-fg-muted" />
          <span className="label">News</span>
        </div>
        <span className="num text-xs text-fg-muted">
          {data ? `${data.length} items · cached 30m` : "—"}
        </span>
      </div>

      {isLoading ? (
        <Skeleton />
      ) : error ? (
        <ErrorState err={error as unknown as NewsError} />
      ) : !data || data.length === 0 ? (
        <Empty />
      ) : (
        <ul className="divide-y divide-border/40">
          {data.map((a, i) => (
            <Row key={a.url} article={a} index={i} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ article, index }: { article: NewsArticle; index: number }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 10) * 0.03 }}
    >
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex gap-3 px-5 py-4 transition-colors hover:bg-overlay/[0.03]"
      >
        <div className="flex-1 min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-fg-muted">
            <span className="rounded-full border border-border bg-bg-soft px-2 py-0.5 font-medium text-fg">
              {article.source}
            </span>
            <SentimentChip tag={article.sentiment} />
            <span className="num">{timeAgo(article.publishedAt)}</span>
          </div>
          <div className="text-sm font-medium leading-tight group-hover:text-brand">
            {article.title}
          </div>
          {article.description && (
            <div className="mt-1 line-clamp-2 text-xs text-fg-muted">
              {article.description}
            </div>
          )}
        </div>
        <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-fg-subtle transition-colors group-hover:text-fg" />
      </a>
    </motion.li>
  );
}

function SentimentChip({ tag }: { tag: Sentiment }) {
  const meta = {
    positive: {
      className: "border-success/30 text-success",
      icon: <TrendingUp className="h-2.5 w-2.5" />,
      label: "Positive",
    },
    negative: {
      className: "border-danger/30 text-danger",
      icon: <TrendingDown className="h-2.5 w-2.5" />,
      label: "Negative",
    },
    neutral: {
      className: "border-border text-fg-muted",
      icon: <Minus className="h-2.5 w-2.5" />,
      label: "Neutral",
    },
  }[tag];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-medium",
        meta.className,
      )}
      title={`${meta.label} sentiment (keyword score)`}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}

function Skeleton() {
  return (
    <ul className="divide-y divide-border/40">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="animate-pulse px-5 py-4">
          <div className="mb-2 flex gap-2">
            <div className="h-3 w-16 rounded-full bg-overlay/5" />
            <div className="h-3 w-16 rounded-full bg-overlay/5" />
          </div>
          <div className="h-3.5 w-[80%] rounded bg-overlay/5" />
          <div className="mt-1.5 h-3 w-[60%] rounded bg-overlay/5" />
        </li>
      ))}
    </ul>
  );
}

function Empty() {
  return (
    <div className="px-6 py-10 text-center">
      <Newspaper className="mx-auto h-7 w-7 text-fg-subtle" />
      <p className="mt-3 text-sm text-fg-muted">
        No recent news for this ticker.
      </p>
    </div>
  );
}

function ErrorState({ err }: { err: NewsError }) {
  if (err.kind === "disabled") {
    return (
      <div className="px-6 py-10 text-center text-sm text-fg-muted">
        <p>
          News feed is off.{" "}
          <span className="text-fg">Set <code className="kbd">NEWSAPI_KEY</code> in <code className="kbd">.env</code></span>{" "}
          and restart the API to enable it.
        </p>
      </div>
    );
  }
  return (
    <div className="px-6 py-10 text-center text-sm text-fg-muted">
      News provider is temporarily unavailable. Try again shortly.
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
