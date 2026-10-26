import type { Store } from "../store";
import type { Entity, LapFlag, Segment } from "../types";
import type { Adapter } from "./index";

type Row = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** Every canonical row that concerns one car carries `entity` so panels stay generic. */
const withEntity = (r: Row): Row =>
  r.driver_number == null ? r : { ...r, entity: String(r.driver_number) };
const rowsOf = (m: Row): Row[] => (Array.isArray(m.rows) ? (m.rows as Row[]) : [m]);

// "CAR 10 (GAS) TIME 1:36.764 DELETED - TRACK LIMITS AT TURN 9 LAP 3 16:07:14" -> car 10, lap 3
// "CAR 5 (BOR) LAP DELETED - TRACK LIMITS AT TURN 11 LAP 9 16:29:31 (PIT)"     -> car 5,  lap 9
export const DELETED = /^CAR (\d+) \(\w+\) (?:TIME \S+ |LAP )DELETED\b.*?\bLAP (\d+)\b/;
const NS = BigInt(1e9);
const CAR_CODE = /^CAR (\d+) \((\w+)\)/;

function parseOffset(s: unknown): number {
  const m = /^(-)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(s ?? ""));
  if (!m) return 0;
  const v = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] ?? 0);
  return m[1] ? -v : v;
}

function sessionKind(type: string): "practice" | "qualifying" | "race" | "test" {
  const t = type.toLowerCase();
  if (t.includes("qual") || t.includes("shootout")) return "qualifying";
  if (t.includes("race") || t === "sprint") return "race";
  if (t.includes("test")) return "test";
  return "practice";
}

/** f1pipe (OpenF1) MCAP -> canonical topics. Positions are in ~0.1 m timing units. */
export const f1OpenF1: Adapter = {
  id: "f1-openf1@1",
  detect: (meta, topics) => meta.pipeline_version !== undefined || topics.includes("/drivers"),
  skip: ["/scene/*"],
  topics: [
    { match: "/session/info", to: "/session/info", schema: "rtc.session_info", kind: "static", rows: (m) => [m] },
    {
      match: "/drivers",
      to: "/session/entities",
      schema: "rtc.entities",
      kind: "snapshot",
      rows: (m) =>
        rowsOf(m).map((d) => ({
          id: String(d.driver_number),
          number: d.driver_number,
          code: d.code ?? String(d.driver_number),
          name: d.full_name ?? d.broadcast_name ?? "",
          team: d.team_name ?? undefined,
          colour: d.team_colour ? `#${String(d.team_colour).replace(/^#/, "")}` : "#8d8d8d",
        })),
    },
    {
      match: "/track/outline",
      to: "/track/outline",
      schema: "rtc.track_outline",
      kind: "static",
      rows: (m) => [
        {
          x: (m.x as number[]).map((v) => v * 0.1),
          y: (m.y as number[]).map((v) => v * 0.1),
          distance_m: m.distance_m,
        },
      ],
    },
    {
      match: "/track/corners",
      to: "/track/corners",
      schema: "rtc.track_corners",
      kind: "static",
      rows: (m) =>
        ((m.corners as Row[]) ?? []).map((c) => ({
          ...c,
          x: (c.x as number) * 0.1,
          y: (c.y as number) * 0.1,
        })),
    },
    {
      match: "/car/{id}/telemetry",
      to: "/vehicle/{id}/telemetry",
      schema: "rtc.telemetry",
      kind: "stream",
      stream: (m) => ({
        speed_kph: num(m.speed_kph) ?? NaN,
        rpm: num(m.rpm) ?? NaN,
        gear: num(m.gear) ?? NaN,
        // The feed sometimes reports 104 as a sentinel before the car runs.
        throttle_pct: Math.min(num(m.throttle_pct) ?? NaN, 100),
        brake_pct: Math.min(num(m.brake_pct) ?? NaN, 100),
      }),
    },
    {
      match: "/car/{id}/position",
      to: "/vehicle/{id}/pose",
      schema: "rtc.pose",
      kind: "stream",
      stream: (m) => {
        const x = num(m.x);
        const y = num(m.y);
        if (x === null || y === null || (x === 0 && y === 0)) return null; // placeholder: car not located
        return { x_m: x * 0.1, y_m: y * 0.1, z_m: (num(m.z) ?? 0) * 0.1 };
      },
    },
    { match: "/timing/laps", to: "/timing/laps", schema: "rtc.laps", kind: "event", rows: (m) => [withEntity(m)] },
    {
      match: "/timing/positions",
      to: "/timing/classification",
      schema: "rtc.classification",
      kind: "event",
      rows: (m) => [withEntity(m)],
    },
    { match: "/stints", to: "/timing/stints", schema: "rtc.stints", kind: "snapshot", rows: (m) => rowsOf(m).map(withEntity) },
    {
      match: "/race_control",
      to: "/session/events",
      schema: "rtc.events",
      kind: "event",
      rows: (m) => {
        const r = withEntity(m);
        if (r.entity == null && typeof m.message === "string") {
          const c = CAR_CODE.exec(m.message);
          if (c) r.entity = c[1];
        }
        return [r];
      },
    },
    { match: "/weather", to: "/session/weather", schema: "rtc.weather", kind: "stream", rows: (m) => [m] },
    {
      match: "/results/session",
      to: "/results/session",
      schema: "rtc.results",
      kind: "snapshot",
      rows: (m) => rowsOf(m).map(withEntity),
    },
    { match: "/timing/intervals", to: "/timing/intervals", schema: "rtc.intervals", kind: "event", rows: (m) => [withEntity(m)] },
    { match: "/pit", to: "/timing/pit", schema: "rtc.pit", kind: "event", rows: (m) => [withEntity(m)] },
    { match: "/timing/overtakes", to: "/timing/overtakes", schema: "rtc.overtakes", kind: "event", rows: (m) => [m] },
    { match: "/team_radio", to: "/comms/radio", schema: "rtc.radio", kind: "event", rows: (m) => [withEntity(m)] },
  ],

  session(info) {
    const season = info.season ?? "";
    return {
      title: `${info.event_name ?? "Session"} · ${info.session_name ?? ""}`.trim(),
      series: `F1 ${season}`.trim(),
      event: String(info.event_name ?? ""),
      venue: String(info.circuit_short_name ?? info.location ?? ""),
      kind: sessionKind(String(info.session_type ?? info.session_name ?? "")),
      utcOffsetSec: parseOffset(info.gmt_offset),
      startNs: BigInt(String(info.date_start_ns)),
      endNs: BigInt(String(info.date_end_ns)),
    };
  },

  entities(store: Store): Entity[] {
    return (store.get("/session/entities")?.rows ?? []) as unknown as Entity[];
  },

  segments(store: Store): Segment[] {
    const ev = store.get("/session/events");
    if (!ev) return [];
    const segs = new Map<string, Segment>();
    for (let i = 0; i < ev.length; i++) {
      const r = ev.rows[i];
      if (r.category !== "SessionStatus") continue;
      const id = r.qualifying_phase != null ? `Q${r.qualifying_phase}` : "Session";
      const msg = String(r.message ?? "");
      if (msg.includes("STARTED") && !segs.has(id)) segs.set(id, { id, t0: ev.t[i], t1: null });
      else if (msg.includes("FINISHED") || msg.includes("ENDED")) {
        const s = segs.get(id);
        if (s && s.t1 === null) s.t1 = ev.t[i];
      }
    }
    return [...segs.values()].sort((a, b) => a.t0 - b.t0);
  },

  lapFlags(store: Store) {
    const out: LapFlag[] = [];
    const ev = store.get("/session/events");
    const info = store.latest<Record<string, unknown>>("/session/info");
    if (!ev) return out;
    const offset = parseOffset(info?.gmt_offset);
    const startUtcTod = info?.date_start_ns ? Number((BigInt(String(info.date_start_ns)) / NS) % BigInt(86400)) : null;
    for (let i = 0; i < ev.length; i++) {
      const msg = String(ev.rows[i].message ?? "");
      const m = DELETED.exec(msg);
      if (!m) continue;
      const flag: LapFlag = { entity: m[1], reason: msg, lap: Number(m[2]) };
      const time = /\bTIME (\d+):(\d+\.\d+)/.exec(msg);
      if (time) flag.time = Number(time[1]) * 60 + Number(time[2]);
      // The trailing clock is the track-local time of the offence; the message follows it.
      const clock = /\b(\d{2}):(\d{2}):(\d{2})\b/.exec(msg.slice(m[0].length));
      if (clock && startUtcTod !== null) {
        const offTod = Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) - offset;
        const msgTod = startUtcTod + ev.t[i];
        flag.at = ev.t[i] - ((((msgTod - offTod) % 86400) + 86400) % 86400);
      }
      out.push(flag);
    }
    return out;
  },
};
