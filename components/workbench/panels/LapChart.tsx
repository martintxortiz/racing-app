"use client";

import { useEffect, useMemo, useRef } from "react";

import { fmtClock, fmtLap } from "@/lib/workbench/format";
import { slotOf } from "@/lib/workbench/selection";
import type { Lap } from "@/lib/workbench/types";
import { useEntityStyles, usePalette } from "../colors";
import { axisStyle, CHART_GRID, EChart, type EChartsInstance, type EChartsOption } from "../EChart";
import { cfg, check, entityMenuItems, openPanelMenu, patch, radio } from "../menus";
import { focusEntity, setT, showLap, toggleCompare, useWB, type MenuItem } from "../state";
import { Empty, Readout, Skeleton, useThrottledT, usePanelEntities, useTopicState, type PanelDef, type PanelProps } from "./common";

const CROSS = "path://M0,0L10,10M10,0L0,10";

function LapChart({ id, panel }: PanelProps) {
  const p = usePalette();
  const styles = useEntityStyles();
  const derived = useWB((s) => s.derived);
  const sel = useWB((s) => s.sel);
  const shown = usePanelEntities(panel.config, "field");
  const xMode = panel.config.x === "lap" ? "lap" : "time";
  const band = String(panel.config.band ?? "107");
  const hoverEntity = useWB((s) => s.hoverEntity);
  const t = useThrottledT(4);
  const state = useTopicState(panel.bindings.laps ?? "/timing/laps");
  const filter = String(panel.config.filter ?? "timed");
  const chart = useRef<EChartsInstance | null>(null);
  const cursorEl = useRef<HTMLDivElement>(null);
  const xModeRef = useRef(xMode);
  useEffect(() => {
    xModeRef.current = xMode;
  });

  const { laps, yRange, pbs } = useMemo(() => {
    const show = new Set(shown);
    const all = (derived?.laps ?? []).filter((l) => l.time !== null && l.t1 !== null && show.has(l.entity));
    const laps = all.filter((l) => (filter === "all" ? true : !l.outLap && (l.timed || l.deleted)));
    // Y range from timed laps: fastest − 0.5 s to a band above it (slow laps get clipped at the top).
    const times = laps.filter((l) => l.timed && !l.deleted).map((l) => l.time!);
    const min = times.length ? Math.min(...times) : 0;
    const max = times.length ? Math.max(...times) : 1;
    const top = band === "all" ? max + 0.5 : min * (band === "110" ? 1.1 : band === "103" ? 1.03 : 1.07);
    const pbs = new Set<Lap>();
    for (const ls of derived?.lapsByEntity.values() ?? []) {
      let best: Lap | null = null;
      for (const l of ls) if (l.timed && !l.deleted && l.time !== null && (!best || l.time < best.time!)) best = l;
      if (best) pbs.add(best);
    }
    return { laps, yRange: [Math.floor((min - 0.5) * 2) / 2, Math.ceil(top)], pbs };
  }, [derived, filter, shown, band]);

  const option = useMemo<EChartsOption>(() => {
    if (!derived) return {};
    const ax = axisStyle(p);
    const [w0, w1] = useWB.getState().session?.window ?? [0, 1];
    const X = (l: Lap) => (xMode === "lap" ? l.n : l.t1!);
    const point = (l: Lap) => {
      const slot = slotOf(sel, l.entity);
      const role = slot >= 0;
      const st = styles.get(l.entity);
      const dim = panel.config.dimOthers !== false && sel.compare.length > 0 && !role && l.entity !== hoverEntity;
      const future = l.t1! > t;
      // With a comparison, the rest of the field is quiet grey context; without one, team colours.
      const colour = role ? p.series[slot % p.series.length] : dim ? p.text3 : (st?.colour ?? p.text3);
      const opacity = (future ? 0.15 : 1) * (dim ? 0.35 : 1);
      return {
        value: [X(l), Math.min(l.time!, yRange[1]), l.entity, l.n],
        symbol: l.deleted ? CROSS : "circle",
        symbolSize: l.deleted ? 6 : role ? 7 : dim ? 4 : 5,
        itemStyle: l.deleted
          ? { color: "transparent", borderColor: colour, borderWidth: 1.5, opacity }
          : pbs.has(l)
            ? { color: colour, borderColor: p.text1, borderWidth: 1.5, opacity }
            : { color: st?.second && !role && !dim ? p.bg : colour, borderColor: colour, borderWidth: st?.second && !role && !dim ? 1.25 : 0, opacity },
        z: role ? 4 : 2,
      };
    };
    const lineFor = (e: string, colour: string, id: string) => ({
      id,
      type: "line",
      // Join compared drivers' clean laps; laps above the band break the line instead of spiking.
      // Up to the cursor only: later laps stay as faint points.
      data: laps.filter((l) => l.entity === e && l.timed && !l.deleted && l.t1! <= t).map((l) => (l.time! < yRange[1] ? [X(l), l.time] : [X(l), null])),
      connectNulls: false,
      showSymbol: false,
      silent: true,
      lineStyle: { color: colour, width: 1.5, opacity: 0.85 },
      z: 3,
    });
    const segs = derived.segments;
    const maxLap = Math.max(1, ...laps.map((l) => l.n));
    return {
      animation: false,
      grid: { ...CHART_GRID, top: segs.length > 1 && xMode !== "lap" ? 26 : CHART_GRID.top },
      xAxis:
        xMode === "lap"
          ? { type: "value", min: 0, max: maxLap + 1, minInterval: 1, ...ax, splitLine: { show: false }, name: "lap", nameLocation: "end", nameGap: 4 }
          : {
              type: "value",
              min: w0,
              max: w1,
              ...ax,
              splitLine: { show: false },
              axisLabel: {
                ...ax.axisLabel,
                formatter: (v: number) => {
                  const s = [...segs].reverse().find((x) => v >= x.t0);
                  return s && segs.length > 1 ? `${s.id} ${fmtClock(v - s.t0, false)}` : fmtClock(s ? v - s.t0 : v, false);
                },
              },
            },
      yAxis: {
        type: "value",
        min: yRange[0],
        max: yRange[1],
        ...axisStyle(p, { line: false }),
        axisLabel: { ...ax.axisLabel, formatter: (v: number) => fmtLap(v).replace(/\.?0+$/, "") },
      },
      tooltip: {
        trigger: "item",
        confine: true,
        borderWidth: 0,
        padding: 0,
        backgroundColor: "transparent",
        extraCssText: "box-shadow:none",
        formatter: (x: { value?: unknown[] }) => {
          if (!Array.isArray(x.value) || x.value.length < 4) return "";
          const l = derived.lapsByEntity.get(String(x.value[2]))?.find((q) => q.n === x.value![3]);
          if (!l) return "";
          const code = derived.entityById.get(l.entity)?.code ?? l.entity;
          const s = l.sectors.map((v) => (v === null ? "—" : v.toFixed(3))).join(" · ");
          return `<div class="pw-tooltip"><b>${code}</b> L${l.n} ${fmtLap(l.time)}${l.deleted ? " <s>deleted</s>" : ""}${pbs.has(l) ? " · PB" : ""}<br/><span class="pw-faint">${s}</span>${l.deletedReason ? `<br/><span class="pw-faint">${escapeHtml(l.deletedReason)}</span>` : ""}</div>`;
        },
      },
      series: [
        {
          id: "bands",
          type: "line",
          data: [],
          silent: true,
          markArea: {
            silent: true,
            itemStyle: { color: p.chrome, opacity: 0.6 },
            label: { show: true, position: "top", distance: 4, color: p.text3, fontSize: 11, fontFamily: p.font },
            data: xMode === "lap" || segs.length < 2 ? [] : segs.map((s) => [{ xAxis: s.t0, name: s.id }, { xAxis: s.t1 ?? w1 }]),
          },
        },
        { id: "points", type: "scatter", data: laps.map(point), cursor: "pointer" },
        ...sel.compare
          .filter((e) => shown.includes(e))
          .map((e, i) => lineFor(e, p.series[slotOf(sel, e) % p.series.length], `line-${i}`)),
      ],
    };
  }, [derived, laps, yRange, pbs, sel, shown, hoverEntity, t, p, styles, panel.config.dimOthers, xMode]);

  useEffect(() => {
    const place = () => {
      const el = cursorEl.current;
      const c = chart.current;
      if (!el || !c) return;
      const x = xModeRef.current === "lap" ? NaN : c.convertToPixel({ xAxisIndex: 0 }, useWB.getState().t);
      el.style.display = Number.isFinite(x) ? "block" : "none";
      el.style.transform = `translateX(${x}px)`;
    };
    place();
    let raf = 0;
    const unsub = useWB.subscribe((s, prev) => {
      if (s.t === prev.t) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    });
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
  }, [option]);

  if (state === "loading" && !laps.length) return <Skeleton rows={6} />;
  if (!laps.length) return <Empty title="No laps yet">{shown.length ? null : "No drivers shown. Right-click › Drivers."}</Empty>;

  return (
    <>
      <Readout>
        <span>
          {laps.length} laps · {shown.length === (derived?.entities.length ?? 0) ? "whole field" : `${shown.length} drivers`}
        </span>
      </Readout>
      <EChart
        option={option}
        onReady={(c) => {
          chart.current = c;
          type Ev = { seriesId?: string; value?: unknown; event?: { event?: Event } };
          const lapOf = (e: Ev) => (e.seriesId === "points" && Array.isArray(e.value) ? { entity: String(e.value[2]), n: Number(e.value[3]) } : null);
          c.on("click", (e: Ev) => {
            const l = lapOf(e);
            if (!l) return;
            const ev = e.event?.event as MouseEvent | undefined;
            if (ev?.shiftKey || ev?.metaKey || ev?.ctrlKey) toggleCompare(l.entity);
            else {
              focusEntity(l.entity);
              showLap(l.entity, { n: l.n });
            }
          });
          c.on("contextmenu", (e: Ev) => {
            const l = lapOf(e);
            const ev = e.event?.event as MouseEvent | undefined;
            if (!l || !ev) return;
            ev.preventDefault();
            const lap = useWB.getState().derived?.lapsByEntity.get(l.entity)?.find((q) => q.n === l.n);
            openPanelMenu(id, ev.clientX, ev.clientY, () => [
              ...entityMenuItems(l.entity, { lapNumber: l.n }),
              { separator: true },
              { label: `Cursor to start of lap ${l.n}`, disabled: !lap, onSelect: () => lap && setT(lap.t0) },
              { label: `Cursor to end of lap ${l.n}`, disabled: !lap?.t1, onSelect: () => lap?.t1 && setT(lap.t1) },
            ]);
          });
          c.on("mouseover", (e: Ev) => {
            const l = lapOf(e);
            if (l) useWB.setState({ hoverEntity: l.entity });
          });
          c.on("mouseout", () => useWB.setState({ hoverEntity: null }));
          return () => {
            chart.current = null;
          };
        }}
      >
        <div ref={cursorEl} className="wb-vline wb-vline--cursor" style={{ top: 10, bottom: 24 }} />
      </EChart>
    </>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function lapMenu(id: string): MenuItem[] {
  return [
    radio("X axis", [{ value: "time", label: "Session time" }, { value: "lap", label: "Lap number" }], cfg<string>(id, "x", "time"), (v) => patch(id, { x: v })),
    radio("Laps", [{ value: "timed", label: "Timed and deleted" }, { value: "all", label: "All, incl. in/out laps" }], cfg<string>(id, "filter", "timed"), (v) => patch(id, { filter: v })),
    radio("Y range", [
      { value: "103", label: "Fastest + 3%" },
      { value: "107", label: "Fastest + 7%" },
      { value: "110", label: "Fastest + 10%" },
      { value: "all", label: "All laps" },
    ], cfg<string>(id, "band", "107"), (v) => patch(id, { band: v })),
    check("Dim drivers not compared", cfg<boolean>(id, "dimOthers", true), (v) => patch(id, { dimOthers: v })),
  ];
}

export const lapChart: PanelDef = {
  type: "lap-chart",
  title: "Lap times",
  description: "Every lap over session time or lap number. Deleted laps are crosses, personal bests ringed.",
  icon: "analytics",
  primary: "laps",
  entities: "field",
  needs: ["/timing/laps"],
  slots: {
    laps: { schemas: ["rtc.laps"], required: true, default: "/timing/laps" },
    events: { schemas: ["rtc.events"], required: false, default: "/session/events" },
  },
  defaultConfig: { filter: "timed", dimOthers: true, drivers: "field", x: "time", band: "107" },
  menu: ({ id }) => lapMenu(id),
  Component: LapChart,
};
