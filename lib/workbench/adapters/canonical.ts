import type { Store } from "../store";
import type { Entity, Segment, SessionMeta } from "../types";
import type { Adapter, TopicRule } from "./index";

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const rowsOf = (m: Row): Row[] => (Array.isArray(m.rows) ? (m.rows as Row[]) : [m]);
/** Every numeric field of a stream message becomes a column, whatever the game publishes. */
const numericCols = (m: Row): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) if (typeof v === "number" && k !== "timestamp_ns") out[k] = v;
  return out;
};
const withEntity = (r: Row): Row => (r.entity != null ? { ...r, entity: String(r.entity) } : r);

function kindOf(s: string): SessionMeta["kind"] {
  const t = s.toLowerCase();
  if (t.includes("qual") || t.includes("shootout") || t.includes("hyperpole")) return "qualifying";
  if (t.includes("race") || t.includes("sprint") || t.includes("feature")) return "race";
  if (t.includes("test")) return "test";
  return "practice";
}

const rule = (to: string, schema: string, kind: TopicRule["kind"], extra: Partial<TopicRule> = {}): TopicRule => ({
  match: to,
  to,
  schema,
  kind,
  ...extra,
});

/**
 * Recordings already written in the canonical model (rtc.* topics, any game or series:
 * LMU, AC, iRacing exports …). Topics pass through 1:1; telemetry keeps every numeric channel.
 */
export const canonical: Adapter = {
  id: "canonical@1",
  detect: (_meta, topics) => topics.includes("/session/entities") && !topics.includes("/drivers"),
  skip: [],
  topics: [
    rule("/session/info", "rtc.session_info", "static", { rows: (m) => [m] }),
    rule("/session/entities", "rtc.entities", "snapshot", {
      rows: (m) =>
        rowsOf(m).map((e) => ({
          ...e,
          id: String(e.id ?? e.entity ?? e.number),
          code: String(e.code ?? e.short_name ?? e.number ?? e.id),
          name: String(e.name ?? e.driver ?? e.code ?? e.id),
          colour: typeof e.colour === "string" ? e.colour : "#8d8d8d",
        })),
    }),
    rule("/track/outline", "rtc.track_outline", "static", { rows: (m) => [m] }),
    rule("/track/corners", "rtc.track_corners", "static", { rows: (m) => (Array.isArray(m.corners) ? (m.corners as Row[]) : rowsOf(m)) }),
    rule("/vehicle/{id}/telemetry", "rtc.telemetry", "stream", { stream: numericCols }),
    rule("/vehicle/{id}/pose", "rtc.pose", "stream", { stream: numericCols }),
    rule("/timing/laps", "rtc.laps", "event", { rows: (m) => rowsOf(m).map(withEntity) }),
    rule("/timing/classification", "rtc.classification", "event", { rows: (m) => rowsOf(m).map(withEntity) }),
    rule("/timing/stints", "rtc.stints", "snapshot", { rows: (m) => rowsOf(m).map(withEntity) }),
    rule("/timing/pit", "rtc.pit", "event", { rows: (m) => rowsOf(m).map(withEntity) }),
    rule("/timing/intervals", "rtc.intervals", "event", { rows: (m) => rowsOf(m).map(withEntity) }),
    rule("/session/events", "rtc.events", "event", { rows: (m) => rowsOf(m).map(withEntity) }),
    rule("/session/weather", "rtc.weather", "event", { rows: (m) => [m] }),
    rule("/results/session", "rtc.results", "snapshot", { rows: (m) => rowsOf(m).map(withEntity) }),
  ],

  session(info) {
    const startNs = BigInt(String(info.start_ns ?? info.date_start_ns ?? 0));
    const endNs = BigInt(String(info.end_ns ?? info.date_end_ns ?? startNs + BigInt(3600) * BigInt(1e9)));
    const name = String(info.session_name ?? info.session ?? info.kind ?? "Session");
    const event = String(info.event_name ?? info.event ?? "");
    return {
      title: String(info.title ?? ([event, name].filter(Boolean).join(" · ") || "Session")),
      series: String(info.series ?? info.game ?? ""),
      event,
      venue: String(info.venue ?? info.track ?? info.circuit ?? ""),
      kind: kindOf(String(info.kind ?? info.session_type ?? name)),
      utcOffsetSec: num(info.utc_offset_sec) ?? 0,
      startNs,
      endNs,
    };
  },

  entities(store: Store): Entity[] {
    return (store.get("/session/entities")?.rows ?? []) as unknown as Entity[];
  },

  /** Parts of a session from events with category "Session" / "SessionStatus" and a `part` name. */
  segments(store: Store): Segment[] {
    const ev = store.get("/session/events");
    if (!ev) return [];
    const segs = new Map<string, Segment>();
    for (let i = 0; i < ev.length; i++) {
      const r = ev.rows[i];
      if (!/^session(status)?$/i.test(String(r.category ?? ""))) continue;
      const id = String(r.part ?? r.segment ?? "Session");
      const msg = String(r.message ?? "").toUpperCase();
      if (/START/.test(msg) && !segs.has(id)) segs.set(id, { id, t0: ev.t[i], t1: null });
      else if (/FINISH|END/.test(msg)) {
        const s = segs.get(id);
        if (s && s.t1 === null) s.t1 = ev.t[i];
      }
    }
    return [...segs.values()].sort((a, b) => a.t0 - b.t0);
  },
};
