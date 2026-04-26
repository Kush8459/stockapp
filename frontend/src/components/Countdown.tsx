import { useEffect, useState } from "react";

/** Ticks once a second until the target time, then yields a render with 0. */
export function useCountdown(target: Date) {
  const [ms, setMs] = useState(() => target.getTime() - Date.now());
  useEffect(() => {
    const id = window.setInterval(() => {
      setMs(target.getTime() - Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [target]);
  return ms;
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "running now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
