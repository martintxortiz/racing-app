"use client";

import { useMemo, useRef } from "react";

import { lapSeries, type LapSeriesMode } from "@/lib/workbench/analysis";
import { fmtLap, fmtSigned } from "@/lib/workbench/format";
import { referenceOf, slotOf } from "@/lib/workbench/selection";
import { useEntityStyles, usePalette } from "../colors";
import { axisStyle, CHART_GRID, EChart, type EChartsInstance, type EChartsOption } from "../EChart";
import { cfg, check, entityMenuItems, openPanelMenu, patch, radio } from "../menus";
import { focusEntity, toggleCompare, useWB, type MenuItem } from "../state";
import { Empty, Readout, Skeleton, useThrottledT, usePanelEntities, useTopicState, type PanelDef, type PanelProps } from "./common";

const MODES: { value: LapSeriesMode | "auto"; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "gap", label: "Gap to leader" },
  { value: "interval", label: "Interval to car ahead" },
  { value: "position", label: "Position" },
  { value: "pace", label: "Lap time" },
  { value: "delta", label: "Lap time vs reference" },
];

/** Auto: gaps in races, pace everywhere else. */
export function resolveMode(mode: string, kind: string | undefined): LapSeriesMode {
  if (mode === "auto" || !MODES.some((m) => m.value === mode)) return kind === "race" ? "gap" : "pace";
  return mode as LapSeriesMode;
}

function GapChart({ id, panel }: PanelProps) {
  const p = usePalette();
  const styles = useEntityStyles();
  const derived = useWB((s) => s.derived);
  const session = useWB((s) => s.session);
  const store = useWB((s) => s.store);
  const sel = useWB((s) => s.sel);
  const shown = usePanelEntities(panel.config, "field");
  const state = useTopicState(panel.bindings.laps ?? "/timing/laps");
  const t = useThrottledT(1);
  const upTo = panel.config.cursor !== false;
  const mode = resolveMode(String(panel.config.mode ?? "auto"), session?.kind);
  const toRef = panel.config.ref === "reference";
  const ref = referenceOf(sel);
  const chart = useRef<EChartsInstance | null>(null);

  const series = useMemo(() => {
    if (!derived) return new Map<string, [number, number | null][]>();
    return lapSeries(derived.lapsByEntity, mode, {
      ref: mode === "delta" || toRef ? ref : null,
      classification: store.get(panel.bindings.order ?? "/timing/classification"),
      entities: shown,
      t: upTo ? t : undefined,
    });
  }, [derived, mode, toRef, ref, store, panel.bindings.order, shown, upTo, t]);

  const option = useMemo<EChartsOption>(() => {
    const ax = axisStyle(p);
    // Clip outliers so slow laps and pit stops do not flatten the chart.
    const vals: number[] = [];
    for (const pts of series.values()) for (const [, v] of pts) if (v !== null) vals.push(v);
    vals.sort((a, b) => a - b);
    const q = (f: number) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor((vals.length - 1) * f))] : 0);
    const clip = panel.config.clip !== false;
    let min: number | undefined;
    let max: number | undefined;
    if (clip && vals.length > 10) {
      if (mode === "pace") [min, max] = [Math.floor(vals[0] - 0.5), Math.ceil(vals[0] * 1.07)];
      else if (mode === "gap" || mode === "interval") [min, max] = [0, Math.ceil(q(0.95) * 1.1)];
      else if (mode === "delta") [min, max] = [Math.floor(q(0.03)), Math.ceil(q(0.97))];
    }
    const maxLap = Math.max(1, ...[...series.values()].flatMap((pts) => pts.map(([n]) => n)));
    const anyPicked = sel.compare.length > 0;
    const sparse = mode === "pace" || mode === "delta";
    const fmtV = (v: number) => (mode === "pace" ? fmtLap(v) : mode === "position" ? `P${v}` : mode === "delta" ? fmtSigned(v, 2) : `+${v.toFixed(1)}`);
    // Axis labels: no trailing ".0" on whole seconds.
    const fmtAxis = (v: number) => (mode === "pace" ? fmtLap(v).replace(/\.?0+$/, "") : mode === "gap" || mode === "interval" ? `+${+v.toFixed(1)}` : fmtV(v));
    return {
      animation: false,
      grid: { ...CHART_GRID, left: mode === "pace" ? 44 : 40, right: 40 },
      xAxis: { type: "value", min: 1, max: maxLap, minInterval: 1, ...ax, splitLine: { show: false } },
      yAxis: {
        type: "value",
        inverse: mode === "gap" || mode === "interval" || mode === "position",
        min: mode === "position" ? 1 : min,
        max: mode === "position" ? Math.max(shown.length, 1) : max,
        minInterval: mode === "position" ? 1 : undefined,
        ...axisStyle(p, { line: false }),
        axisLabel: { ...ax.axisLabel, formatter: fmtAxis, showMaxLabel: false },
      },
      tooltip: {
        trigger: "item",
        confine: true,
        borderWidth: 0,
        padding: 0,
        backgroundColor: "transparent",
        extraCssText: "box-shadow:none",
        formatter: (x: { seriesId?: string; value?: unknown[] }) => {
          if (!Array.isArray(x.value) || typeof x.value[1] !== "number") return "";
          const code = (derived?.entityById.get(String(x.seriesId)) ?? { code: x.seriesId }).code;
          return `<div class="pw-tooltip"><b>${String(code).replace(/[<>&]/g, "")}</b> lap ${x.value[0]} · ${fmtV(x.value[1] as number)}</div>`;
        },
      },
      series: shown.map((e) => {
        const slot = slotOf(sel, e);
        const picked = slot >= 0;
        // With a comparison the rest of the field turns grey context; without one, team colours.
        const colour = picked ? p.series[slot % p.series.length] : anyPicked ? p.text3 : (styles.get(e)?.colour ?? p.text3);
        const pts = series.get(e) ?? [];
        return {
          id: e,
          type: "line",
          data: pts.map(([n, v]) => [n, v === null || (max !== undefined && v > max) ? null : v]),
          // Lap-time modes are sparse in practice and qualifying: draw points and bridge out laps.
          connectNulls: sparse,
          showSymbol: sparse || (picked && pts.length < 80),
          symbolSize: sparse && !picked ? 3 : 4,
          lineStyle: { color: colour, width: picked ? 2 : 1.25, opacity: anyPicked && !picked ? (sparse ? 0.15 : 0.3) : 0.9, type: styles.get(e)?.second && !picked && !anyPicked ? "dashed" : "solid" },
          itemStyle: { color: colour, opacity: anyPicked && !picked ? 0.35 : 1 },
          emphasis: { focus: "series", lineStyle: { width: 2.5 } },
          endLabel: { show: picked || (!anyPicked && shown.length <= 6), formatter: derived?.entityById.get(e)?.code ?? e, color: colour, fontFamily: p.font, fontSize: 11, fontWeight: 600, distance: 4 },
          labelLayout: { moveOverlap: "shiftY" },
          z: picked ? 3 : 2,
        };
      }),
    };
  }, [series, sel, shown, p, styles, mode, derived, panel.config.clip]);

  if (state === "loading" && !derived?.laps.length) return <Skeleton rows={6} />;
  if (!derived?.laps.length) return <Empty title="No laps yet" />;

  const label = MODES.find((m) => m.value === mode)?.label;
  return (
    <>
      <Readout>
        <span>
          {label}
          {toRef && ref && mode === "gap" ? ` · to ${derived.entityById.get(ref)?.code ?? ref}` : ""}
        </span>
      </Readout>
      <EChart
        option={option}
        onReady={(c) => {
          chart.current = c;
          type Ev = { seriesId?: string; value?: unknown; event?: { event?: Event } };
          c.on("click", (e: Ev) => {
            if (!e.seriesId) return;
            const ev = e.event?.event as MouseEvent | undefined;
            if (ev?.shiftKey || ev?.metaKey || ev?.ctrlKey) toggleCompare(e.seriesId);
            else focusEntity(e.seriesId);
          });
          c.on("contextmenu", (e: Ev) => {
            const ev = e.event?.event as MouseEvent | undefined;
            if (!e.seriesId || !ev) return;
            ev.preventDefault();
            const n = Array.isArray(e.value) ? Number(e.value[0]) : undefined;
            const ent = e.seriesId;
            openPanelMenu(id, ev.clientX, ev.clientY, () => entityMenuItems(ent, { lapNumber: n }));
          });
          return () => {
            chart.current = null;
          };
        }}
      />
    </>
  );
}

function gapMenu(id: string): MenuItem[] {
  return [
    radio("Show", MODES, cfg<string>(id, "mode", "auto"), (v) => patch(id, { mode: v })),
    radio("Gap to", [{ value: "leader", label: "Leader" }, { value: "reference", label: "Reference driver" }], cfg<string>(id, "ref", "leader"), (v) => patch(id, { ref: v })),
    check("Only laps up to cursor", cfg<boolean>(id, "cursor", true), (v) => patch(id, { cursor: v })),
    check("Clip outliers", cfg<boolean>(id, "clip", true), (v) => patch(id, { clip: v })),
  ];
}

export const gapChart: PanelDef = {
  type: "gap-chart",
  title: "Gaps",
  description: "Lap-by-lap gap to the leader, interval, position, lap time or delta to a reference.",
  icon: "chart-multi-line",
  primary: "laps",
  entities: "field",
  needs: ["/timing/laps"],
  slots: {
    laps: { schemas: ["rtc.laps"], required: true, default: "/timing/laps" },
    order: { schemas: ["rtc.classification"], required: false, default: "/timing/classification" },
  },
  defaultConfig: { mode: "auto", drivers: "field", ref: "leader", cursor: true, clip: true },
  menu: ({ id }) => gapMenu(id),
  Component: GapChart,
};
