"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineStyle,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { ApiCandle } from "@nundina/shared";
import { api } from "@/lib/api";
import { alpha, chartColors, onThemeChange } from "@/lib/chart-theme";

export interface ChartLevels {
  entry: string | null;
  takeProfit: string | null;
  stopLoss: string | null;
}

/** Picks a candle size that gives roughly 60–300 candles for the window. */
export function intervalFor(spanMs: number) {
  const h = spanMs / 3_600_000;
  if (h <= 8) return "1m";
  if (h <= 36) return "5m";
  if (h <= 96) return "15m";
  if (h <= 24 * 14) return "1h";
  return "4h";
}

/**
 * Price around the signal: commit marker, touch marker, and entry/TP/SL lines only once the
 * levels are public (`levels` is null before reveal, so nothing leaks).
 */
export function PriceChart({
  market,
  from,
  to,
  committedAt,
  touchAt,
  touchWin,
  levels,
}: {
  market: string;
  from: number;
  to: number;
  committedAt: number;
  touchAt: number | null;
  touchWin: boolean | null;
  levels: ChartLevels | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const interval = intervalFor(to - from);
  const { data, isError } = useQuery({
    queryKey: ["prices", market, interval, from, to],
    queryFn: () => api.prices({ market, interval, from, to }),
    staleTime: 60_000,
  });

  useEffect(() => {
    const el = ref.current;
    const candles = data?.candles ?? [];
    if (!el || !candles.length) return;
    const chart = createChart(el, { autoSize: true, timeScale: { timeVisible: true, secondsVisible: false } });
    const series = chart.addSeries(CandlestickSeries, { priceLineVisible: false });
    series.setData(candles.map(toBar));
    const markers = createSeriesMarkers(series, []);

    const paint = () => {
      const c = chartColors();
      chart.applyOptions({
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c.text, fontFamily: c.mono, attributionLogo: false },
        grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false },
      });
      series.applyOptions({
        upColor: alpha(c.win, 0.85),
        downColor: alpha(c.loss, 0.85),
        wickUpColor: c.win,
        wickDownColor: c.loss,
        borderVisible: false,
      });
      for (const l of series.priceLines()) series.removePriceLine(l);
      if (levels) {
        const line = (price: string | null, color: string, title: string, style = LineStyle.Solid) =>
          price && series.createPriceLine({ price: Number(price), color, title, lineWidth: 1, lineStyle: style, axisLabelVisible: true });
        line(levels.entry, c.fg, "Entry", LineStyle.Dashed);
        line(levels.takeProfit, c.win, "TP");
        line(levels.stopLoss, c.loss, "SL");
      }
      const m: SeriesMarker<UTCTimestamp>[] = [
        { time: snap(candles, committedAt), position: "belowBar", shape: "arrowUp", color: c.accent, text: "Committed" },
      ];
      if (touchAt) {
        m.push({
          time: snap(candles, touchAt),
          position: touchWin ? "aboveBar" : "belowBar",
          shape: "circle",
          color: touchWin ? c.win : c.loss,
          text: touchWin ? "TP touched" : "Decided",
        });
      }
      markers.setMarkers(m.sort((a, b) => a.time - b.time));
    };
    paint();
    chart.timeScale().fitContent();
    const off = onThemeChange(paint);
    return () => {
      off();
      chart.remove();
    };
  }, [data, levels, committedAt, touchAt, touchWin]);

  return (
    <div className="relative h-72 w-full sm:h-96">
      <div ref={ref} className="absolute inset-0" role="img" aria-label={`${market} price chart around the signal`} />
      {!data && !isError ? <div className="absolute inset-0 animate-pulse rounded-xl bg-surface-2/60" aria-hidden /> : null}
      {isError || data?.candles.length === 0 ? (
        <p className="absolute inset-0 grid place-items-center text-sm text-muted">Price data unavailable for this window.</p>
      ) : null}
    </div>
  );
}

function toBar(k: ApiCandle) {
  return { time: Math.floor(k.t / 1000) as UTCTimestamp, open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c) };
}

/** Markers must sit on an existing bar: the last candle that opened at or before `ms`. */
function snap(candles: ApiCandle[], ms: number): UTCTimestamp {
  let t = candles[0]!.t;
  for (const k of candles) {
    if (k.t > ms) break;
    t = k.t;
  }
  return Math.floor(t / 1000) as UTCTimestamp;
}
