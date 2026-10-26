"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { interp, poseAt } from "@/lib/workbench/derive";
import { classesOf } from "@/lib/workbench/derive";
import { topicFor } from "@/lib/workbench/layout";
import { panelEntities, slotOf } from "@/lib/workbench/selection";
import { indexAt } from "@/lib/workbench/store";
import { useEntityStyles, usePalette, type EntityStyle, type Palette } from "../colors";
import { EChart, type EChartsInstance, type EChartsOption } from "../EChart";
import { cfg, check, entityMenuItems, openPanelMenu, patch, radio } from "../menus";
import { focusEntity, setFollow, toggleCompare, useWB, type MenuItem } from "../state";
import { Empty, Readout, Skeleton, useTopicState, type PanelDef, type PanelProps } from "./common";

const POSE = "/vehicle/*/pose";
interface MapCfg {
  labels: string;
  colour: string;
  pose: string;
  config: Record<string, unknown>;
  zoom: number;
}

type Pt = [number, number];
interface Geo {
  outline: Pt[];
  dist: number[];
  corners: { label: string; p: Pt }[];
  rot: (p: Pt) => Pt;
  bounds: [number, number, number, number];
}

/** Rotation that puts the outline's principal axis horizontal. */
function autoAngle(xs: number[], ys: number[]) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  return -0.5 * Math.atan2(2 * sxy, sxx - syy);
}

function useGeo(outlineTopic: string, cornersTopic: string, rotation: string): Geo | null {
  const store = useWB((s) => s.store);
  const version = useWB((s) => s.version);
  return useMemo(() => {
    const o = store.latest<{ x: number[]; y: number[]; distance_m?: number[] }>(outlineTopic);
    if (!o?.x?.length) return null;
    const ang = rotation === "auto" ? autoAngle(o.x, o.y) : (Number(rotation) * Math.PI) / 180;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const rot = ([x, y]: Pt): Pt => [x * c - y * s, x * s + y * c];
    const outline = o.x.map((x, i) => rot([x, o.y[i]]));
    if (outline.length) outline.push(outline[0]);
    const dist = o.distance_m ?? [];
    const corners = (store.get(cornersTopic)?.rows ?? []).map((r) => ({
      label: `${r.number}${r.letter ?? ""}`,
      p: rot([Number(r.x), Number(r.y)]),
    }));
    const xs = outline.map((p) => p[0]);
    const ys = outline.map((p) => p[1]);
    return {
      outline,
      dist,
      corners,
      rot,
      bounds: [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, version, outlineTopic, cornersTopic, rotation]);
}

/** Car markers at the cursor. Labels and colours follow the panel config and the shared selection. */
function carData(geo: Geo, styles: Map<string, EntityStyle>, p: Palette, m: MapCfg) {
  const { store, derived, t, sel, follow, hoverEntity, hoverDistance } = useWB.getState();
  const ids = (derived?.entities ?? []).map((e) => e.id);
  const shown = new Set(panelEntities(m.config, sel, ids, "field"));
  const classes = classesOf(derived?.entities ?? []);
  const out: object[] = [];
  let centre: Pt | null = null;
  for (const e of derived?.entities ?? []) {
    if (!shown.has(e.id)) continue;
    const pose = store.get(topicFor(m.pose, POSE, e.id));
    const pos = pose ? poseAt(pose, t) : null;
    if (!pos) continue;
    const xy = geo.rot(pos);
    if (e.id === follow) centre = xy;
    const slot = slotOf(sel, e.id);
    const picked = slot >= 0;
    const st = styles.get(e.id);
    const team = st?.colour ?? p.text3;
    const colour =
      m.colour === "slot"
        ? picked
          ? p.series[slot % p.series.length]
          : p.axis
        : m.colour === "class" && classes.length
          ? p.series[Math.max(0, classes.indexOf(e.class ?? "")) % p.series.length]
          : team;
    const hover = e.id === hoverEntity;
    const focus = e.id === sel.focus;
    out.push({
      value: [...xy, e.id],
      name: e.code,
      symbolSize: focus ? 15 : picked ? 13 : hover ? 13 : 10,
      z: picked ? 3 : 2,
      itemStyle: {
        color: m.colour === "team" && st?.second && !picked ? p.bg : colour,
        borderColor: picked || hover ? p.text1 : colour,
        borderWidth: focus ? 2.5 : picked || hover ? 1.5 : m.colour === "team" && st?.second ? 2 : 0,
      },
      label: {
        show: m.labels === "all" || ((m.labels === "selection" || m.labels === "ab") && (picked || hover || e.id === follow)),
        formatter: e.code,
        position: "right",
        color: p.text1,
        fontWeight: focus ? 600 : 500,
        fontSize: 12,
        fontFamily: p.font,
      },
    });
  }
  const hoverPt =
    hoverDistance !== null && geo.dist.length
      ? [geo.outline[Math.round(interp(geo.dist, geo.dist.map((_, i) => i), hoverDistance))]].filter(Boolean)
      : [];
  return { cars: out, hover: hoverPt, centre };
}

/** Axis window: the whole track with equal aspect, or a window around the followed car. */
function view(geo: Geo, size: [number, number], centre: Pt | null, zoom: number) {
  const [x0, x1, y0, y1] = geo.bounds;
  const pad = 16;
  const W = Math.max(1, size[0] - 2 * pad);
  const H = Math.max(1, size[1] - 2 * pad);
  let scale = Math.min(W / (x1 - x0), H / (y1 - y0));
  let cx = (x0 + x1) / 2;
  let cy = (y0 + y1) / 2;
  if (centre) {
    scale *= zoom;
    [cx, cy] = centre;
  }
  const hw = W / scale / 2;
  const hh = H / scale / 2;
  return { xAxis: { min: cx - hw, max: cx + hw }, yAxis: { min: cy - hh, max: cy + hh } };
}

function TrackMap({ id, panel }: PanelProps) {
  const p = usePalette();
  const styles = useEntityStyles();
  const rotation = String(panel.config.rotation ?? "auto");
  const follow = useWB((s) => s.follow);
  const sel = useWB((s) => s.sel);
  const m: MapCfg = useMemo(
    () => ({
      labels: String(panel.config.labels ?? "selection"),
      colour: String(panel.config.colour ?? "team"),
      pose: panel.bindings.pose ?? POSE,
      config: panel.config,
      zoom: Number(panel.config.zoom ?? 4),
    }),
    [panel.config, panel.bindings.pose],
  );
  const geo = useGeo(panel.bindings.outline ?? "/track/outline", panel.bindings.corners ?? "/track/corners", rotation);
  const state = useTopicState(panel.bindings.outline ?? "/track/outline");
  const hasPose = useWB((s) => (s.derived?.entities ?? []).some((e) => s.store.get(topicFor(m.pose, POSE, e.id))?.length));
  const [size, setSize] = useState<[number, number]>([0, 0]);
  const chart = useRef<EChartsInstance | null>(null);
  const live = useRef({ geo, styles, p, m, size });
  useEffect(() => {
    live.current = { geo, styles, p, m, size };
  });

  const option = useMemo<EChartsOption>(() => {
    if (!geo) return {};
    const pad = 16;
    const { cars, hover, centre } = carData(geo, styles, p, m);
    const v = view(geo, size, centre, m.zoom);
    return {
      animation: false,
      grid: { left: pad, right: pad, top: pad, bottom: pad },
      xAxis: { type: "value", show: false, ...v.xAxis },
      yAxis: { type: "value", show: false, ...v.yAxis },
      tooltip: {
        trigger: "item",
        confine: true,
        className: "pw-tooltip",
        borderWidth: 0,
        padding: 0,
        backgroundColor: "transparent",
        extraCssText: "box-shadow:none",
        formatter: (x: { seriesId?: string; value?: unknown[] }) => {
          if (x.seriesId !== "cars" || !Array.isArray(x.value)) return "";
          return carTip(String(x.value[2]));
        },
      },
      series: [
        {
          id: "outline",
          type: "line",
          data: geo.outline,
          showSymbol: false,
          silent: true,
          lineStyle: { color: p.split, width: follow ? 9 : 5, cap: "round", join: "round" },
          z: 1,
        },
        {
          id: "corners",
          type: "scatter",
          data: geo.corners.map((c) => ({ value: c.p, label: { formatter: c.label } })),
          symbolSize: 0,
          silent: true,
          label: { show: panel.config.cornerLabels !== false, color: p.text3, fontSize: 10, fontFamily: p.font, position: "top", distance: 6 },
        },
        { id: "cars", type: "scatter", data: cars, symbol: "circle", z: 3 },
        {
          id: "hover",
          type: "scatter",
          data: hover,
          symbol: "diamond",
          symbolSize: 10,
          silent: true,
          itemStyle: { color: p.text1 },
          z: 4,
        },
      ],
    };
    // carData reads the latest cursor itself; re-run on structure changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, size, p, styles, m, follow, sel]);

  // Cursor link: update only the cars and hover series, outside React.
  useEffect(() => {
    let raf = 0;
    const unsub = useWB.subscribe((s, prev) => {
      if (s.t === prev.t && s.hoverEntity === prev.hoverEntity && s.hoverDistance === prev.hoverDistance && s.version === prev.version) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const { geo, styles, p, m, size } = live.current;
        if (!chart.current || !geo) return;
        const { cars, hover, centre } = carData(geo, styles, p, m);
        const v = centre ? view(geo, size, centre, m.zoom) : {};
        chart.current.setOption({ ...v, series: [{ id: "cars", data: cars }, { id: "hover", data: hover }] }, { lazyUpdate: true });
      });
    });
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
  }, []);

  if (state === "loading") return <Skeleton rows={6} />;
  if (!geo) return <Empty title="No track outline">This recording has no /track/outline topic.</Empty>;
  const followCode = follow ? useWB.getState().derived?.entityById.get(follow)?.code : null;

  return (
    <div
      className="wb-fill"
      onContextMenu={(e) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        openPanelMenu(id, e.clientX, e.clientY);
      }}
    >
      <Readout>
        {!hasPose ? <span className="pw-faint">No position data</span> : null}
        {followCode ? (
          <button type="button" className="pw-btn pw-btn--ghost pw-btn--sm" title="Stop following" onClick={() => setFollow(null)}>
            Following {followCode} <span className="pw-icon pw-icon--close" />
          </button>
        ) : null}
      </Readout>
      <EChart
        option={option}
        onReady={(c) => {
          chart.current = c;
          setSize([c.getWidth(), c.getHeight()]);
          const click = (e: { seriesId?: string; value?: unknown; event?: { event?: Event } }) => {
            if (e.seriesId !== "cars" || !Array.isArray(e.value)) return;
            const ent = String(e.value[2]);
            const ev = e.event?.event as MouseEvent | undefined;
            if (ev?.shiftKey || ev?.metaKey || ev?.ctrlKey) toggleCompare(ent);
            else focusEntity(ent);
          };
          const ctx = (e: { seriesId?: string; value?: unknown; event?: { event?: Event } }) => {
            if (e.seriesId !== "cars" || !Array.isArray(e.value)) return;
            const ev = e.event?.event as MouseEvent | undefined;
            ev?.preventDefault();
            const ent = String(e.value[2]);
            openPanelMenu(id, ev?.clientX ?? 0, ev?.clientY ?? 0, () => entityMenuItems(ent));
          };
          const over = (e: { seriesId?: string; value?: unknown }) => {
            if (e.seriesId === "cars" && Array.isArray(e.value)) useWB.setState({ hoverEntity: String(e.value[2]) });
          };
          const out = () => useWB.setState({ hoverEntity: null });
          c.on("click", click);
          c.on("contextmenu", ctx);
          c.on("mouseover", over);
          c.on("mouseout", out);
          return () => {
            chart.current = null;
          };
        }}
        onResize={(c) => {
          const w = c.getWidth();
          const h = c.getHeight();
          setSize((s) => (s[0] === w && s[1] === h ? s : [w, h]));
        }}
      />
    </div>
  );
}

function mapMenu(id: string): MenuItem[] {
  const { derived, follow } = useWB.getState();
  const multi = classesOf(derived?.entities ?? []).length > 0;
  return [
    radio("Labels", [
      { value: "selection", label: "Compared drivers" },
      { value: "all", label: "All cars" },
      { value: "none", label: "None" },
    ], cfg<string>(id, "labels", "selection") === "ab" ? "selection" : cfg<string>(id, "labels", "selection"), (v) => patch(id, { labels: v })),
    radio("Colour cars by", [
      { value: "team", label: "Team" },
      { value: "slot", label: "Comparison" },
      ...(multi ? [{ value: "class", label: "Class" }] : []),
    ], cfg<string>(id, "colour", "team"), (v) => patch(id, { colour: v })),
    {
      label: "Follow car",
      hint: follow ? derived?.entityById.get(follow)?.code : "Off",
      submenu: () => [
        { label: "Off", radio: true, checked: !useWB.getState().follow, onSelect: () => setFollow(null) },
        { separator: true },
        ...(derived?.entities ?? []).map((e) => ({ label: e.code, hint: e.class ?? e.team, swatch: e.colour, radio: true, checked: useWB.getState().follow === e.id, onSelect: () => setFollow(e.id) })),
      ],
    },
    radio("Follow zoom", [2, 4, 8].map((z) => ({ value: z, label: `${z}×` })), cfg<number>(id, "zoom", 4), (v) => patch(id, { zoom: v })),
    radio("Rotation", ["auto", "0", "90", "180", "270"].map((r) => ({ value: r, label: r === "auto" ? "Auto" : `${r}°` })), cfg<string>(id, "rotation", "auto"), (v) => patch(id, { rotation: v })),
    check("Corner numbers", cfg<boolean>(id, "cornerLabels", true), (v) => patch(id, { cornerLabels: v })),
  ];
}

function carTip(id: string) {
  const { store, derived, t } = useWB.getState();
  const e = derived?.entityById.get(id);
  const tel = store.get(`/vehicle/${id}/telemetry`);
  let extra = "";
  if (tel) {
    const i = indexAt(tel.t, tel.length, t);
    const sp = tel.cols.speed_kph?.[i];
    const g = tel.cols.gear?.[i];
    if (i >= 0 && sp !== undefined) extra += ` · ${Math.round(sp)} km/h`;
    if (i >= 0 && g !== undefined) extra += ` · G${g}`;
  }
  const name = (e?.code ?? id).replace(/[<>&]/g, "");
  return `<div class="pw-tooltip">${name}${e?.class ? ` · ${e.class.replace(/[<>&]/g, "")}` : ""}${extra}</div>`;
}

export const trackMap: PanelDef = {
  type: "track-map",
  title: "Track map",
  description: "Where every car is at the cursor. Follow a car, colour by team, class or comparison.",
  icon: "map",
  primary: "pose",
  entities: "field",
  needs: ["/track/outline"],
  slots: {
    outline: { schemas: ["rtc.track_outline"], required: true, default: "/track/outline" },
    corners: { schemas: ["rtc.track_corners"], required: false, default: "/track/corners" },
    pose: { schemas: ["rtc.pose"], required: false, default: POSE, pattern: true },
  },
  defaultConfig: { labels: "selection", rotation: "auto", colour: "team", zoom: 4, cornerLabels: true },
  menu: ({ id }) => mapMenu(id),
  Component: TrackMap,
};
