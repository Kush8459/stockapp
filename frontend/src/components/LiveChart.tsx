import { useEffect, useRef } from "react";
import {
  AreaSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

export interface Point {
  time: number; // unix seconds
  value: number;
}

interface LiveChartProps {
  history: Point[];
  /** Latest tick appended as it arrives; use {@link Point} shape. */
  lastTick?: Point | null;
  height?: number;
}

/**
 * A price-line chart that seeds with historical ticks and appends live ones.
 *
 * The chart instance is created once per mount and kept alive across prop
 * changes — `history` replays through setData only when it meaningfully
 * differs, and `lastTick` uses the cheap `update` path.
 */
export function LiveChart({ history, lastTick, height = 260 }: LiveChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#8a95a6",
        fontFamily: "Inter, ui-sans-serif, system-ui",
        // lightweight-charts ≥ v5: hide the TradingView watermark.
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      rightPriceScale: {
        borderColor: "#1c2431",
        // Keep the price axis from squishing labels at narrow widths.
        scaleMargins: { top: 0.12, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "#1c2431",
        timeVisible: true,
        secondsVisible: true,
        // Auto-hide tick labels that can't fit — prevents overlap on resize.
        rightOffset: 4,
        barSpacing: 6,
      },
      crosshair: {
        vertLine: { color: "#06b6d4", width: 1, style: 2, labelBackgroundColor: "#06b6d4" },
        horzLine: { color: "#06b6d4", width: 1, style: 2, labelBackgroundColor: "#06b6d4" },
      },
      // Lock the chart in place — we want a fixed view of the selected
      // range, not a pan/zoom surface. Users switch ranges via the
      // RangeSelector pills above the chart.
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: false,
        horzTouchDrag: false,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: false,
        mouseWheel: false,
        pinch: false,
      },
      // autoSize makes the chart follow its container via ResizeObserver.
      autoSize: true,
      height,
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: "#06b6d4",
      topColor: "rgba(6,182,212,0.35)",
      bottomColor: "rgba(6,182,212,0.02)",
      lineWidth: 2,
      priceLineColor: "#06b6d4",
    });
    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      lastTimeRef.current = 0;
    };
  }, [height]);

  // Seed / reset history. lightweight-charts requires strictly-ascending times;
  // we dedupe and coerce any accidental collisions by bumping by 1s.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || history.length === 0) return;

    const cleaned: { time: UTCTimestamp; value: number }[] = [];
    let prev = 0;
    for (const p of history) {
      let t = p.time;
      if (t <= prev) t = prev + 1;
      cleaned.push({ time: t as UTCTimestamp, value: p.value });
      prev = t;
    }
    series.setData(cleaned);
    lastTimeRef.current = prev;
    chart.timeScale().fitContent();
  }, [history]);

  // Append a live tick — `update` is cheaper than setData and keeps the
  // viewport anchored.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !lastTick) return;
    let t = lastTick.time;
    if (t <= lastTimeRef.current) t = lastTimeRef.current + 1;
    series.update({ time: t as Time, value: lastTick.value });
    lastTimeRef.current = t;
  }, [lastTick]);

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}
