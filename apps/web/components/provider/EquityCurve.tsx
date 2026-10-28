"use client";

import { AreaSeries, ColorType, createChart, LineStyle, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { alpha, chartColors, onThemeChange } from "@/lib/chart-theme";

/** Cumulative R over time. The container has a fixed height so nothing shifts while the chart loads. */
export function EquityCurve({ points }: { points: { time: number; value: number }[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || points.length < 2) return;
    const chart = createChart(el, { autoSize: true, handleScroll: false, handleScale: false });
    const series = chart.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    series.setData(points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    const zero = series.createPriceLine({ price: 0, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });

    const paint = () => {
      const c = chartColors();
      const up = (points.at(-1)?.value ?? 0) >= 0;
      const line = up ? c.win : c.loss;
      chart.applyOptions({
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c.text, fontFamily: c.mono, attributionLogo: false },
        grid: { vertLines: { visible: false }, horzLines: { color: c.border } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false },
        crosshair: { vertLine: { color: c.text }, horzLine: { color: c.text } },
      });
      series.applyOptions({ lineColor: line, topColor: alpha(line, 0.28), bottomColor: alpha(line, 0) });
      zero.applyOptions({ color: c.void });
    };
    paint();
    chart.timeScale().fitContent();
    const off = onThemeChange(paint);
    return () => {
      off();
      chart.remove();
    };
  }, [points]);

  if (points.length < 2) {
    return <div className="grid h-24 place-items-center rounded-xl border border-dashed border-border text-sm text-muted">Not enough settled signals for a curve yet.</div>;
  }
  return <div ref={ref} className="h-56 w-full" role="img" aria-label={`Cumulative R: ${points.at(-1)!.value}R over ${points.length} signals`} />;
}
