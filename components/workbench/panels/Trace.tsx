"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { fieldMeta } from "@/lib/workbench/analysis";
import { deltaTrace, interp, lapTrace, resolveLap, type LapTrace } from "@/lib/workbench/derive";
import { fmtLap, fmtSigned } from "@/lib/workbench/format";
import { topicFor } from "@/lib/workbench/layout";
import { lapOf, panelEntities, referenceOf } from "@/lib/workbench/selection";
import type { EntityId, Lap } from "@/lib/workbench/types";
import { colourOf, useEntityStyles, usePalette, type ColourBy } from "../colors";
import { axisStyle, EChart, type EChartsInstance, type EChartsOption } from "../EChart";
import { cfg, check, lapItems, openPanelMenu, patch, radio } from "../menus";
import { setReference, setT, useWB, type MenuItem } from "../state";
import { Empty, Readout, Skeleton, useThrottledT, usePanelEntities, type PanelDef, type PanelProps } from "./common";

/** Preferred channels, in order; whatever the recording has beyond these is offered in the menu. */
const PREFERRED = ["speed_kph", "throttle_pct", "brake_pct", "gear", "rpm", "steering_deg"];
const WEIGHT: Record<string, number> = { delta: 2, speed_kph: 4, throttle_pct: 2, brake_pct: 1, gear: 1.5, rpm: 2 };
const SKIP = new Set(["x_m", "y_m", "z_m", "lap_distance_m", "distance_m", "timestamp_ns", "driver_number"]);
/** Plot margins. Each channel gets a label strip of `strip` px above its plot; corner numbers sit in `top`. */
const PAD = { left: 44, right: 12, top: 14, bottom: 22, gap: 6, strip: 18 };
const TEL = "/vehicle/*/telemetry";

const metaOf = (ch: string) => (ch === "delta" ? { key: "delta", label: "Δ time", unit: "s", digits: 3 } : fieldMeta(ch));

interface Grid {
  ch: string;
  top: number;
  height: number;
}

function layoutGrids(channels: string[], height: number): Grid[] {
  const w = (c: string) => WEIGHT[c] ?? 2;
  const total = channels.reduce((s, c) => s + w(c), 0);
  const avail = Math.max(40, height - PAD.top - PAD.bottom - PAD.gap * (channels.length - 1) - PAD.strip * channels.length);
  let y = PAD.top;
  return channels.map((ch) => {
    const h = (avail * w(ch)) / total;
    const g = { ch, top: y + PAD.strip, height: h };
    y += PAD.strip + h + PAD.gap;
    return g;
  });
}

/** Channels available in the telemetry of the shown entities (union, preferred first). */
function availableChannels(cols: string[][]): string[] {
  const all = new Set(cols.flat().filter((c) => !SKIP.has(c)));
  return [...PREFERRED.filter((c) => all.has(c)), ...[...all].filter((c) => !PREFERRED.includes(c)).sort()];
}

function Trace({ id, panel }: PanelProps) {
  const p = usePalette();
  const styles = useEntityStyles();
  const derived = useWB((s) => s.derived);
  const store = useWB((s) => s.store);
  const version = useWB((s) => s.version);
  const status = useWB((s) => s.status);
  const sel = useWB((s) => s.sel);
  const entities = usePanelEntities(panel.config, "selection");
  const xMode = panel.config.x === "time" ? "time" : "distance";
  const colourBy = (panel.config.colourBy as ColourBy) ?? "slot";
  const showCorners = panel.config.corners !== false;
  const telPattern = panel.bindings.telemetry ?? TEL;
  const anyCursor = entities.some((e) => lapOf(sel, e) === "cursor");
  const t = useThrottledT(anyCursor ? 4 : 0.0001);
  const [height, setHeight] = useState(0);
  const chart = useRef<EChartsInstance | null>(null);
  const cursorEl = useRef<HTMLDivElement>(null);
  const hoverEl = useRef<HTMLDivElement>(null);
  const boxEl = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  // Reference: the selection's reference if shown here, else the first shown entity.
  const refId = useMemo(() => {
    const r = referenceOf(sel);
    return r && entities.includes(r) ? r : (entities[0] ?? null);
  }, [sel, entities]);

  const laps = useMemo(() => {
    const out = new Map<EntityId, Lap>();
    for (const e of entities) {
      const l = resolveLap(derived?.lapsByEntity.get(e), lapOf(sel, e), t);
      if (l && l.time !== null) out.set(e, l);
    }
    return out;
  }, [entities, derived, sel, t]);

  const traces = useMemo(() => {
    const L = derived?.lapLength ?? null;
    const out = new Map<EntityId, LapTrace>();
    for (const [e, lap] of laps) {
      const tel = store.get(topicFor(telPattern, TEL, e));
      const tr = tel ? lapTrace(tel, lap, L) : null;
      if (tr) out.set(e, tr);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, version, derived, laps, telPattern]);

  const ref = refId ? traces.get(refId) : undefined;
  const deltas = useMemo(() => {
    const out = new Map<EntityId, { d: Float64Array; delta: Float64Array }>();
    if (!ref) return out;
    for (const [e, tr] of traces) if (e !== refId) out.set(e, deltaTrace(ref, tr));
    return out;
  }, [traces, ref, refId]);

  const available = useMemo(() => availableChannels([...traces.values()].map((tr) => Object.keys(tr.channels))), [traces]);
  const configured = panel.config.channels as string[] | undefined;
  const channels = useMemo(() => {
    const base = configured ?? ["delta", ...available.filter((c) => PREFERRED.slice(0, 4).includes(c))];
    return base.filter((c) => (c === "delta" ? xMode === "distance" && traces.size > 1 : available.includes(c)));
  }, [configured, available, xMode, traces.size]);

  const shown = entities.filter((e) => traces.has(e));
  const live = useRef({ ref, refLap: refId ? laps.get(refId) : undefined, xMode });
  useEffect(() => {
    live.current = { ref, refLap: refId ? laps.get(refId) : undefined, xMode };
  });

  const chKey = channels.join(",");
  const grids = useMemo(() => (chKey ? layoutGrids(chKey.split(","), height) : []), [chKey, height]);
  const xOf = (tr: LapTrace, j: number) => (xMode === "distance" ? tr.d[j] / 1000 : tr.tau[j]);

  const option = useMemo<EChartsOption>(() => {
    if (!ref || !height || !grids.length) return {};
    const xMax = xMode === "distance" ? ref.length / 1000 : Math.max(...[...traces.values()].map((tr) => tr.lap.time ?? 0));
    const corners =
      showCorners && xMode === "distance"
        ? ((store.get(panel.bindings.corners ?? "/track/corners")?.rows ?? []) as { number: number; letter?: string; distance_m?: number }[]).filter(
            (c) => typeof c.distance_m === "number",
          )
        : [];
    const ax = axisStyle(p);
    const series: object[] = [];
    grids.forEach((g, i) => {
      const m = metaOf(g.ch);
      const first = series.length;
      if (g.ch === "delta") {
        for (const [e, dt] of deltas) {
          const { colour, dashed } = colourOf(e, colourBy, sel, styles, p);
          const data: [number, number][] = new Array(dt.d.length);
          for (let j = 0; j < dt.d.length; j++) data[j] = [dt.d[j] / 1000, dt.delta[j]];
          series.push({ id: `delta-${e}`, type: "line", xAxisIndex: i, yAxisIndex: i, data, showSymbol: false, silent: true, lineStyle: { color: colour, width: 1.25, type: dashed ? [4, 2] : "solid" } });
        }
        if (series.length === first) series.push({ id: "delta-none", type: "line", xAxisIndex: i, yAxisIndex: i, data: [] });
        (series[first] as Record<string, unknown>).markLine = {
          silent: true,
          symbol: "none",
          label: { show: false },
          lineStyle: { color: p.axis, width: 1, type: "solid" },
          data: [{ yAxis: 0 }],
        };
      } else {
        // Reference drawn last so it sits on top.
        for (const e of [...shown].sort((a, b) => Number(a === refId) - Number(b === refId))) {
          const tr = traces.get(e)!;
          const col = tr.channels[g.ch];
          if (!col) continue;
          const { colour, dashed } = colourOf(e, colourBy, sel, styles, p);
          const data: [number, number][] = new Array(tr.d.length);
          for (let j = 0; j < tr.d.length; j++) data[j] = [xOf(tr, j), col[j]];
          series.push({
            id: `${g.ch}-${e}`,
            type: "line",
            xAxisIndex: i,
            yAxisIndex: i,
            data,
            showSymbol: false,
            step: m.step ? "end" : false,
            sampling: "lttb",
            silent: true,
            lineStyle: { color: colour, width: e === refId ? 1.5 : 1.25, type: dashed ? [4, 2] : "solid" },
            z: e === refId ? 3 : 2,
          });
        }
        if (series.length === first) series.push({ id: `${g.ch}-none`, type: "line", xAxisIndex: i, yAxisIndex: i, data: [] });
      }
      if (corners.length) {
        const s = series[series.length - 1] as Record<string, unknown>;
        const prev = (s.markLine as { data: object[] } | undefined)?.data ?? [];
        s.markLine = {
          silent: true,
          symbol: "none",
          animation: false,
          lineStyle: { color: p.grid, width: 1, type: "solid" },
          label: { show: i === 0, position: "end", formatter: (x: { name: string }) => x.name, color: p.text3, fontSize: 10, fontFamily: p.font, distance: PAD.strip + 1 },
          data: [
            ...prev.map((d) => ({ ...d, lineStyle: { color: p.axis }, label: { show: false } })),
            ...corners.map((c) => ({ xAxis: c.distance_m! / 1000, name: `${c.number}${c.letter ?? ""}` })),
          ],
        };
      }
    });
    return {
      animation: false,
      grid: grids.map((g) => ({ left: PAD.left, right: PAD.right, top: g.top, height: g.height })),
      xAxis: grids.map((_, i) => ({
        type: "value",
        gridIndex: i,
        min: 0,
        max: xMax,
        ...ax,
        axisLine: { ...ax.axisLine, show: i === grids.length - 1 },
        axisLabel: { ...ax.axisLabel, show: i === grids.length - 1, formatter: (v: number) => `${+v.toFixed(2)}` },
        name: i === grids.length - 1 ? (xMode === "distance" ? "km" : "s") : undefined,
        nameLocation: "end",
        nameGap: 4,
        nameTextStyle: { ...ax.nameTextStyle, verticalAlign: "top", padding: [10, 0, 0, 0] },
      })),
      yAxis: grids.map((g, i) => {
        const m = metaOf(g.ch);
        const range = "range" in m ? m.range : undefined;
        return {
          type: "value",
          gridIndex: i,
          scale: !range,
          min: range?.[0],
          max: range?.[1],
          splitNumber: Math.max(1, Math.floor(g.height / 32)),
          ...ax,
          axisLine: { show: false },
          axisLabel: {
            ...ax.axisLabel,
            showMaxLabel: false,
            formatter: (v: number) => (g.ch === "delta" ? fmtSigned(v, 1) : Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}k` : `${v}`),
          },
        };
      }),
      dataZoom: [
        { type: "inside", xAxisIndex: grids.map((_, i) => i), filterMode: "none", zoomOnMouseWheel: true, moveOnMouseMove: false, moveOnMouseWheel: false, preventDefaultMouseMove: false },
      ],
      series,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traces, deltas, grids, p, showCorners, height, xMode, colourBy, sel.compare, styles, refId]);

  // Cursor line: the reference's position at the cursor, placed outside React.
  useEffect(() => {
    const place = () => {
      const el = cursorEl.current;
      const c = chart.current && !chart.current.isDisposed() ? chart.current : null;
      const { ref, refLap, xMode } = live.current;
      if (!el) return;
      const tau = refLap ? useWB.getState().t - refLap.t0 : NaN;
      const inLap = ref && refLap && tau >= 0 && tau <= (refLap.time ?? 0);
      const xv = inLap ? (xMode === "distance" ? interp(ref.tau, ref.d, tau) / 1000 : tau) : NaN;
      const x = c && Number.isFinite(xv) ? c.convertToPixel({ xAxisIndex: 0 }, xv) : NaN;
      if (!Number.isFinite(x)) {
        el.style.display = "none";
        return;
      }
      el.style.display = "block";
      el.style.transform = `translateX(${x}px)`;
    };
    place();
    let raf = 0;
    const unsub = useWB.subscribe((s, prev) => {
      if (s.t === prev.t) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    });
    const c = chart.current;
    c?.on("datazoom", place);
    c?.on("finished", place);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
      if (c && !c.isDisposed()) {
        c.off("datazoom", place);
        c.off("finished", place);
      }
    };
  }, [option]);

  const menu = (e: React.MouseEvent) => {
    e.preventDefault();
    openPanelMenu(id, e.clientX, e.clientY, [
      { label: "Reset zoom", hint: "Double-click", onSelect: () => chart.current?.dispatchAction({ type: "dataZoom", start: 0, end: 100 }) },
    ]);
  };

  if (status === "loading" && !ref) return <Skeleton rows={8} />;
  if (!entities.length)
    return (
      <div className="wb-fill" onContextMenu={menu}>
        <Empty title="Nothing to compare">Click a driver in any panel; Shift+click adds more. Right-click for options.</Empty>
      </div>
    );
  if (!ref) {
    const code = derived?.entityById.get(refId ?? "")?.code ?? refId;
    const hasTel = entities.some((e) => store.get(topicFor(telPattern, TEL, e))?.length);
    return (
      <div className="wb-fill" onContextMenu={menu}>
        {hasTel ? (
          <Empty title={`No timed lap for ${code}`}>Pick another lap or driver from the right-click menu.</Empty>
        ) : (
          <Empty title="No telemetry">The recording has no {telPattern} topic for these drivers.</Empty>
        )}
      </div>
    );
  }

  const code = (e: EntityId) => derived?.entityById.get(e)?.code ?? e;
  const valueAt = (e: EntityId, ch: string, x: number) => {
    const tr = traces.get(e);
    if (!tr) return null;
    if (ch === "delta") {
      const dt = deltas.get(e);
      return dt ? interp(dt.d, dt.delta, x) : e === refId ? 0 : null;
    }
    const xs = xMode === "distance" ? tr.d : tr.tau;
    return tr.channels[ch] ? interp(xs, tr.channels[ch], xMode === "distance" ? x : x) : null;
  };
  const kWarn = [...traces.values()].find((x) => x.k < 0.95 || x.k > 1.05);
  const fmt = (ch: string, v: number | null) => (v === null || !Number.isFinite(v) ? "—" : ch === "delta" ? fmtSigned(v) : v.toFixed(metaOf(ch).digits));
  const refLap = laps.get(refId!)!;
  const hoverEntities = shown.slice(0, 4);

  return (
    <>
      <Readout>
        {shown.map((e) => {
          const l = laps.get(e)!;
          const { colour } = colourOf(e, colourBy, sel, styles, p);
          return (
            <span key={e} className="wb-legend" title={e === refId ? "Reference" : undefined}>
              <i className="wb-dot" style={{ background: colour }} />
              <span className={e === refId ? "pw-strong" : undefined}>{code(e)}</span>
              <span className="pw-faint">L{l.n}</span> {fmtLap(l.time)}
              {e !== refId ? <span className="pw-faint"> {fmtSigned((l.time ?? 0) - (refLap.time ?? 0))}</span> : null}
            </span>
          );
        })}
        {entities.length > shown.length ? <span className="pw-faint">{entities.length - shown.length} without lap</span> : null}
        {kWarn ? (
          <span className="wb-warn" title="Lap distance from integrated speed was rescaled by more than 5%.">
            scaled ×{kWarn.k.toFixed(2)}
          </span>
        ) : null}
      </Readout>
      <div className="wb-fill" onContextMenu={menu} onDoubleClick={() => chart.current?.dispatchAction({ type: "dataZoom", start: 0, end: 100 })}>
        <EChart
          option={option}
          onReady={(c) => {
            chart.current = c;
            setHeight(c.getHeight());
            const zr = c.getZr();
            let drag: number | null = null;
            const toX = (x: number) => c.convertFromPixel({ xAxisIndex: 0 }, x) as number;
            const inPlot = (x: number) => x >= PAD.left && x <= c.getWidth() - PAD.right;
            zr.on("mousemove", (e) => {
              if (!inPlot(e.offsetX)) return;
              const xv = toX(e.offsetX);
              const dist = live.current.xMode === "distance";
              setHover(dist ? xv * 1000 : xv);
              useWB.setState({ hoverDistance: dist ? xv * 1000 : null });
              if (hoverEl.current) {
                hoverEl.current.style.display = "block";
                hoverEl.current.style.transform = `translateX(${e.offsetX}px)`;
              }
              if (drag !== null && boxEl.current) {
                boxEl.current.style.display = "block";
                boxEl.current.style.left = `${Math.min(drag, e.offsetX)}px`;
                boxEl.current.style.width = `${Math.abs(e.offsetX - drag)}px`;
              }
            });
            zr.on("globalout", () => {
              setHover(null);
              useWB.setState({ hoverDistance: null });
              if (hoverEl.current) hoverEl.current.style.display = "none";
            });
            zr.on("mousedown", (e) => {
              if ((e.event as MouseEvent).button === 0 && inPlot(e.offsetX)) drag = e.offsetX;
            });
            zr.on("mouseup", (e) => {
              const start = drag;
              drag = null;
              if (boxEl.current) boxEl.current.style.display = "none";
              if (start === null) return;
              if (Math.abs(e.offsetX - start) > 4) {
                const [k0, k1] = [toX(start), toX(e.offsetX)].sort((x, y) => x - y);
                c.dispatchAction({ type: "dataZoom", startValue: k0, endValue: k1 });
              } else {
                const { ref, refLap, xMode } = live.current;
                if (ref && refLap) setT(refLap.t0 + (xMode === "distance" ? interp(ref.d, ref.tau, toX(e.offsetX) * 1000) : toX(e.offsetX)));
              }
            });
            return () => {
              chart.current = null;
            };
          }}
          onResize={(c) => setHeight(c.getHeight())}
        >
          {grids.map((g) => {
            const m = metaOf(g.ch);
            return (
              <div key={g.ch} className="wb-chlabel" style={{ top: g.top - PAD.strip, left: PAD.left }}>
                {m.label}
                {m.unit ? <span className="pw-faint"> {m.unit}</span> : null}
                {hover !== null ? (
                  <span className="wb-chlabel__v">
                    {hoverEntities.map((e) => (
                      <span key={e} style={{ color: colourOf(e, colourBy, sel, styles, p).colour }}>
                        {fmt(g.ch, valueAt(e, g.ch, hover))}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>
            );
          })}
          <div ref={cursorEl} className="wb-vline wb-vline--cursor" style={{ top: PAD.top + PAD.strip, bottom: PAD.bottom }} />
          <div ref={hoverEl} className="wb-vline wb-vline--hover" style={{ top: PAD.top + PAD.strip, bottom: PAD.bottom }} />
          <div ref={boxEl} className="wb-zoombox" style={{ top: PAD.top + PAD.strip, bottom: PAD.bottom }} />
          {hover !== null ? (
            <div className="wb-xread" style={{ left: PAD.left }}>
              {xMode === "distance" ? `${(hover / 1000).toFixed(3)} km` : `${hover.toFixed(2)} s`}
            </div>
          ) : null}
        </EChart>
      </div>
    </>
  );
}

/** Chart right-click: channels, x axis, reference, laps, colours, zoom. */
function chartMenu(id: string): MenuItem[] {
  const { derived, store, sel, layout } = useWB.getState();
  const panel = layout.panels[id];
  const ents = panelEntitiesNow(id);
  const pattern = panel?.bindings.telemetry ?? TEL;
  const cols = ents.map((e) => Object.keys(store.get(topicFor(pattern, TEL, e))?.cols ?? {}));
  const avail = availableChannels(cols);
  const xMode = cfg<string>(id, "x", "distance");
  const current = (cfg<string[] | undefined>(id, "channels", undefined) ?? ["delta", ...avail.filter((c) => PREFERRED.slice(0, 4).includes(c))]).filter(
    (c) => c === "delta" || avail.includes(c),
  );
  const toggle = (ch: string) => {
    const now = (cfg<string[] | undefined>(id, "channels", undefined) ?? current).filter((c) => c === "delta" || avail.includes(c));
    const next = now.includes(ch) ? now.filter((c) => c !== ch) : [...now, ch];
    if (next.length) patch(id, { channels: ["delta", ...avail].filter((c) => next.includes(c)) });
  };
  const code = (e: EntityId) => derived?.entityById.get(e)?.code ?? e;
  const refNow = referenceOf(sel);
  return [
    {
      label: "Channels",
      hint: `${current.length}`,
      submenu: () => {
        const now = (cfg<string[] | undefined>(id, "channels", undefined) ?? current).filter((c) => c === "delta" || avail.includes(c));
        return [
          { label: "Δ time to reference", checked: now.includes("delta"), keepOpen: true, disabled: xMode === "time", onSelect: () => toggle("delta") },
          { separator: true },
          ...avail.map((ch) => {
            const m = fieldMeta(ch);
            return { label: m.label, hint: m.unit || ch, checked: now.includes(ch), keepOpen: true, onSelect: () => toggle(ch) };
          }),
          { separator: true },
          { label: "Reset channels", onSelect: () => patch(id, { channels: undefined }) },
        ];
      },
    },
    radio("X axis", [
      { value: "distance", label: "Distance" },
      { value: "time", label: "Time in lap" },
    ], xMode, (v) => patch(id, { x: v })),
    {
      label: "Reference",
      hint: refNow ? code(refNow) : undefined,
      disabled: !ents.length,
      submenu: () => ents.map((e) => ({ label: code(e), radio: true, checked: referenceOf(useWB.getState().sel) === e, onSelect: () => setReference(e) })),
    },
    {
      label: "Laps",
      disabled: !ents.length,
      submenu: () => ents.map((e) => ({ label: code(e), hint: describeLap(lapOf(useWB.getState().sel, e)), submenu: () => lapItems(e) })),
    },
    radio("Colours", [
      { value: "slot", label: "Comparison colours" },
      { value: "team", label: "Team colours" },
    ], cfg<string>(id, "colourBy", "slot"), (v) => patch(id, { colourBy: v })),
    check("Corner markers", cfg<boolean>(id, "corners", true), (v) => patch(id, { corners: v })),
  ];
}

const describeLap = (r: ReturnType<typeof lapOf>) => (typeof r === "object" ? `Lap ${r.n}` : r === "best" ? "Best" : r === "last" ? "Last" : "At cursor");

function panelEntitiesNow(id: string): EntityId[] {
  const { layout, sel, derived } = useWB.getState();
  return panelEntities(layout.panels[id]?.config ?? {}, sel, (derived?.entities ?? []).map((e) => e.id), "selection");
}

export const trace: PanelDef = {
  type: "trace",
  title: "Telemetry",
  description: "Compared laps channel by channel, by distance or time, with Δ to the reference. Drag to zoom.",
  icon: "chart-line",
  primary: "telemetry",
  entities: "selection",
  needs: ["/vehicle/*/telemetry"],
  slots: {
    telemetry: { schemas: ["rtc.telemetry"], required: true, default: TEL, pattern: true },
    laps: { schemas: ["rtc.laps"], required: true, default: "/timing/laps" },
    corners: { schemas: ["rtc.track_corners"], required: false, default: "/track/corners" },
  },
  defaultConfig: { x: "distance", corners: true, colourBy: "slot", drivers: "selection" },
  menu: ({ id }) => chartMenu(id),
  Component: Trace,
};
