"use client";

import { useMemo } from "react";

import { fieldMeta, numericFields, valueAt } from "@/lib/workbench/analysis";
import { timeOfDay } from "@/lib/workbench/format";
import { usePalette } from "../colors";
import { axisStyle, CHART_GRID, EChart, type EChartsOption } from "../EChart";
import { cfg, check, patch } from "../menus";
import { useWB, type MenuItem } from "../state";
import { Empty, Skeleton, useThrottledT, useTopicState, type PanelDef, type PanelProps } from "./common";

const WEATHER = "/session/weather";
const PREFERRED = ["air_temperature_c", "track_temperature_c", "humidity_pct", "wind_speed_mps", "wind_direction_deg", "rainfall", "pressure_mbar"];

function fieldsOf(topic: string): string[] {
  const d = useWB.getState().store.get(topic);
  const all = numericFields(d);
  return [...PREFERRED.filter((k) => all.includes(k)), ...all.filter((k) => !PREFERRED.includes(k))];
}

function fmt(key: string, v: number | null): string {
  if (v === null) return "—";
  if (key === "rainfall") return v > 0 ? "Rain" : "Dry";
  const m = fieldMeta(key);
  return `${v.toFixed(m.digits)}${m.unit ? (m.unit === "%" || m.unit.startsWith("°") ? m.unit : ` ${m.unit}`) : ""}`;
}

function Weather({ panel }: PanelProps) {
  const p = usePalette();
  const topic = panel.bindings.weather ?? WEATHER;
  const state = useTopicState(topic);
  const store = useWB((s) => s.store);
  const version = useWB((s) => s.version);
  const session = useWB((s) => s.session);
  const t = useThrottledT(2);
  const d = store.get(topic);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fields = useMemo(() => fieldsOf(topic), [store, version, topic]);
  const hide = new Set((panel.config.hide as string[]) ?? []);
  const shown = fields.filter((f) => !hide.has(f));
  const chartFields = ((panel.config.chart as string[]) ?? ["air_temperature_c", "track_temperature_c"]).filter((f) => fields.includes(f));
  const showChart = panel.config.showChart !== false && chartFields.length > 0;
  const chartKey = chartFields.join();

  const option = useMemo<EChartsOption>(() => {
    if (!d || !showChart || !session) return {};
    const ax = axisStyle(p);
    // Data extent plus the cursor: sparse feeds stay readable instead of a sliver of the session.
    const x0 = Math.min(d.t[0], t);
    const x1 = Math.max(d.t[d.length - 1], t);
    const padX = Math.max(30, (x1 - x0) * 0.03);
    // Ticks on round local clock times (every 10, 15, 30 or 60 min), labelled hh:mm.
    const wall0 = Number(BigInt(session.startNs) / BigInt(1000000)) / 1000 + session.utcOffsetSec;
    const span = x1 - x0 + 2 * padX;
    const step = [300, 600, 900, 1800, 3600, 7200].find((st) => span / st <= 5) ?? 7200;
    const ticks: number[] = [];
    for (let w = Math.ceil((wall0 + x0 - padX) / step) * step; w <= wall0 + x1 + padX; w += step) ticks.push(w - wall0);
    return {
      animation: false,
      grid: { ...CHART_GRID, left: 32, top: 24 },
      legend: { show: true, top: 2, left: 32, itemWidth: 10, itemHeight: 2, itemGap: 12, textStyle: { color: p.text2, fontFamily: p.font, fontSize: 11 }, icon: "rect" },
      xAxis: {
        type: "value",
        min: x0 - padX,
        max: x1 + padX,
        ...ax,
        splitLine: { show: false },
        axisLabel: { ...ax.axisLabel, customValues: ticks, formatter: (v: number) => timeOfDay(v, session.startNs, session.utcOffsetSec).slice(0, 5) },
        axisTick: { show: false, customValues: ticks },
      },
      yAxis: { type: "value", scale: true, ...axisStyle(p, { line: false }), splitNumber: 3 },
      tooltip: { trigger: "axis", confine: true, className: "pw-tooltip", borderWidth: 0, padding: [4, 8], backgroundColor: p.inverseBg, textStyle: { color: p.inverseText, fontFamily: p.font, fontSize: 12 }, valueFormatter: (v: unknown) => (typeof v === "number" ? v.toFixed(1) : "") },
      series: [
        ...chartFields.map((f, i) => ({
          type: "line" as const,
          name: fieldMeta(f).label,
          showSymbol: d.length < 40,
          symbolSize: 4,
          step: fieldMeta(f).step ? ("end" as const) : undefined,
          lineStyle: { width: 1.5, color: p.series[i % p.series.length] },
          itemStyle: { color: p.series[i % p.series.length] },
          data: Array.from({ length: d.length }, (_, k) => [d.t[k], d.cols[f]?.[k] ?? (d.rows[k]?.[f] as number) ?? null]),
        })),
        { type: "line" as const, data: [], silent: true, markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: p.crosshair, width: 1, type: "solid" as const }, data: [{ xAxis: t }] } },
      ],
    };
  }, [d, version, showChart, session, p, chartKey, t]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === "loading") return <Skeleton rows={4} />;
  if (state === "missing" || !d) return <Empty title="No weather data">This recording has no {topic} topic.</Empty>;

  const dir = valueAt(d, "wind_direction_deg", t);
  return (
    <div className="wb-weather">
      <dl className="wb-readouts">
        {shown.map((f) => (
          <div key={f} className="wb-readouts__item">
            <dt>{fieldMeta(f).label}</dt>
            <dd>
              {f === "wind_direction_deg" && dir !== null ? (
                <span className="wb-wind" style={{ transform: `rotate(${dir + 180}deg)` }} aria-hidden>
                  ↑
                </span>
              ) : null}
              {fmt(f, valueAt(d, f, t))}
            </dd>
          </div>
        ))}
      </dl>
      {showChart ? (
        <div className="wb-weather__chart">
          <EChart option={option} />
        </div>
      ) : null}
    </div>
  );
}

function weatherMenu(id: string, topic: string): MenuItem[] {
  const fields = fieldsOf(topic);
  const toggle = (key: string, f: string, fallback: string[]) => {
    const cur = cfg<string[]>(id, key, fallback);
    patch(id, { [key]: cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f] });
  };
  return [
    {
      label: "Readouts",
      disabled: !fields.length,
      submenu: () => fields.map((f) => ({ label: fieldMeta(f).label, hint: fieldMeta(f).unit, checked: !cfg<string[]>(id, "hide", []).includes(f), keepOpen: true, onSelect: () => toggle("hide", f, []) })),
    },
    {
      label: "Chart channels",
      disabled: !fields.length,
      submenu: () =>
        fields.map((f) => ({
          label: fieldMeta(f).label,
          hint: fieldMeta(f).unit,
          checked: cfg<string[]>(id, "chart", ["air_temperature_c", "track_temperature_c"]).includes(f),
          keepOpen: true,
          onSelect: () => toggle("chart", f, ["air_temperature_c", "track_temperature_c"]),
        })),
    },
    check("Show chart", cfg<boolean>(id, "showChart", true), (v) => patch(id, { showChart: v })),
  ];
}

export const weather: PanelDef = {
  type: "weather",
  title: "Weather",
  description: "Current conditions at the cursor and how they changed over the session.",
  icon: "temperature",
  primary: "weather",
  needs: [WEATHER],
  slots: { weather: { schemas: ["rtc.weather"], required: true, default: WEATHER } },
  defaultConfig: { hide: ["pressure_mbar"], chart: ["air_temperature_c", "track_temperature_c"], showChart: true },
  menu: ({ id, panel }) => weatherMenu(id, panel.bindings.weather ?? WEATHER),
  Component: Weather,
};
