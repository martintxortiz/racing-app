"use client";

import { LineChart, ScatterChart } from "echarts/charts";
import {
  AxisPointerComponent,
  DataZoomInsideComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

echarts.use([
  LineChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  AxisPointerComponent,
  MarkLineComponent,
  MarkAreaComponent,
  DataZoomInsideComponent,
  CanvasRenderer,
]);

export type EChartsInstance = echarts.ECharts;
export type EChartsOption = echarts.EChartsCoreOption;

/**
 * Thin ECharts wrapper: init on mount, dispose on unmount, ResizeObserver → resize() on rAF.
 * `option` is applied with replaceMerge on series so cursor ticks never rebuild the chart.
 */
export function EChart({
  option,
  onReady,
  onResize,
  className,
  children,
}: {
  option: EChartsOption;
  onReady?: (chart: EChartsInstance) => void | (() => void);
  onResize?: (chart: EChartsInstance) => void;
  className?: string;
  children?: React.ReactNode;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsInstance | null>(null);
  const onResizeRef = useRef(onResize);
  useEffect(() => {
    onResizeRef.current = onResize;
  });

  useEffect(() => {
    const node = el.current!;
    const c = echarts.init(node, undefined, { renderer: "canvas" });
    chart.current = c;
    const cleanup = onReady?.(c);
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (c.isDisposed()) return;
        c.resize();
        onResizeRef.current?.(c);
      });
    });
    ro.observe(node);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (typeof cleanup === "function") cleanup();
      c.dispose();
      chart.current = null;
    };
    // onReady is intentionally mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { replaceMerge: ["series", "grid", "xAxis", "yAxis"], lazyUpdate: false });
    if (chart.current) onResizeRef.current?.(chart.current);
  }, [option]);

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      {children}
    </div>
  );
}

/**
 * The one chart look, from the design tokens: 11 px Plex labels in the tertiary text colour,
 * hairline grid, no ticks. `line: false` drops the axis line (value axes on the left).
 */
export function axisStyle(p: { grid: string; axis: string; text2: string; text3: string; font: string }, opts: { line?: boolean } = {}) {
  return {
    axisLine: { show: opts.line ?? true, lineStyle: { color: p.axis, width: 1 } },
    axisTick: { show: false },
    splitLine: { show: true, lineStyle: { color: p.grid, width: 1 } },
    axisLabel: { color: p.text3, fontSize: 11, fontFamily: p.font, hideOverlap: true, margin: 6 },
    nameTextStyle: { color: p.text3, fontSize: 11, fontFamily: p.font },
  };
}

/** Chart margins in px, the same in every chart: room for 5-character y labels and one row of x labels. */
export const CHART_GRID = { left: 44, right: 12, top: 12, bottom: 22 } as const;
