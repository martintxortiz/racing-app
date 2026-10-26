import { indexAt, type TopicData } from "./store";
import type { EntityId, Lap, LapFlag, LapRef, Sec, Segment } from "./types";

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function segmentAt(segments: Segment[], t: Sec): Segment | null {
  let cur: Segment | null = null;
  for (const s of segments) if (s.t0 <= t) cur = s;
  return cur;
}

function segmentOfLap(segments: Segment[], t0: Sec): string | null {
  // A lap belongs to the segment containing its start (laps begun before the flag count).
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    if (s.t0 <= t0 + 1e-6) return s.t1 === null || t0 <= s.t1 ? s.id : null;
  }
  return null;
}

/** Sector times from `sector_1_s … sector_n_s`, as many as the feed publishes. */
export function sectorsOf(r: Row): (number | null)[] {
  const out: (number | null)[] = [];
  for (const k of Object.keys(r)) {
    const m = /^sector_(\d+)_s$/.exec(k);
    if (m) out[Number(m[1]) - 1] = num(r[k]);
  }
  return Array.from(out, (v) => v ?? null);
}

/** Per-lap speeds: every numeric `*_kph` field (speed trap, intermediates …). */
export function speedsOf(r: Row): Record<string, number> | undefined {
  let out: Record<string, number> | undefined;
  for (const [k, v] of Object.entries(r)) {
    if (!/_kph$/.test(k) || typeof v !== "number" || !Number.isFinite(v)) continue;
    (out ??= {})[k] = v;
  }
  return out;
}

/**
 * Knockout parts: when fewer entities run in the next part than in this one, the difference
 * was eliminated, so `advance` = entities seen in the next part. Nothing is assumed per series.
 */
export function withAdvance(segments: Segment[], laps: Lap[]): Segment[] {
  const seen = segments.map((s) => new Set(laps.filter((l) => l.segment === s.id).map((l) => l.entity)));
  return segments.map((s, i) => {
    const next = seen[i + 1];
    return next && next.size > 0 && next.size < seen[i].size ? { ...s, advance: next.size } : s;
  });
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Lap index from canonical `/timing/laps` rows (stamped at lap start). */
export function buildLaps(
  laps: TopicData | undefined,
  segments: Segment[],
  flags: LapFlag[] = [],
  classOf: (e: EntityId) => string | undefined = () => undefined,
): Lap[] {
  if (!laps) return [];
  const out: Lap[] = [];
  for (let i = 0; i < laps.length; i++) {
    const r = laps.rows[i];
    const entity = String(r.entity ?? r.driver_number);
    const n = Number(r.lap_number);
    const time = num(r.lap_time_s);
    const t0 = laps.t[i];
    const lap: Lap = {
      entity,
      n,
      t0,
      t1: time === null ? null : t0 + time,
      time,
      sectors: sectorsOf(r),
      outLap: r.is_pit_out_lap === true || r.is_out_lap === true,
      deleted: r.deleted === true,
      segment: segmentOfLap(segments, t0),
      timed: false,
    };
    const driver = str(r.driver) ?? str(r.driver_name);
    if (driver) lap.driver = driver;
    const speeds = speedsOf(r);
    if (speeds) lap.speeds = speeds;
    out.push(lap);
  }
  // In laps: the lap before an out lap.
  const prevOf = new Map<string, Lap>();
  for (const l of out) {
    const prev = prevOf.get(l.entity);
    if (prev && l.outLap && prev.n === l.n - 1) prev.inLap = true;
    prevOf.set(l.entity, l);
  }
  // Deletions: exact lap time first, then the lap the offence happened on, then the lap number.
  for (const f of flags) {
    const mine = out.filter((l) => l.entity === f.entity);
    const hit =
      (f.time !== undefined ? mine.find((l) => l.time !== null && Math.abs(l.time - f.time!) < 0.0015) : undefined) ??
      (f.at !== undefined ? mine.find((l) => l.t1 !== null && l.t0 <= f.at! && f.at! < l.t1) : undefined) ??
      mine.find((l) => l.n === f.lap);
    if (hit) {
      hit.deleted = true;
      hit.deletedReason = f.reason;
    }
  }
  // timed = has a time, not an out lap, within 107% of the fastest lap of its part and class
  // (classes run at very different paces in multi-class sessions).
  const key = (l: Lap) => `${l.segment ?? ""}\u0000${classOf(l.entity) ?? ""}`;
  const min = new Map<string, number>();
  for (const l of out) {
    if (l.time === null || l.outLap) continue;
    min.set(key(l), Math.min(min.get(key(l)) ?? Infinity, l.time));
  }
  for (const l of out) {
    l.timed = l.time !== null && !l.outLap && l.time <= 1.07 * (min.get(key(l)) ?? Infinity);
  }
  return out;
}

export function lapsByEntity(laps: Lap[]): Map<EntityId, Lap[]> {
  const m = new Map<EntityId, Lap[]>();
  for (const l of laps) {
    let a = m.get(l.entity);
    if (!a) m.set(l.entity, (a = []));
    a.push(l);
  }
  for (const a of m.values()) a.sort((x, y) => x.n - y.n);
  return m;
}

const isBestCandidate = (l: Lap) => l.timed && !l.deleted && l.time !== null;

/** Best non-deleted timed lap; optionally only in one segment and completed by t. */
export function bestLap(laps: Lap[] | undefined, opts: { segment?: string | null; t?: Sec } = {}): Lap | null {
  let best: Lap | null = null;
  for (const l of laps ?? []) {
    if (!isBestCandidate(l)) continue;
    if (opts.segment !== undefined && l.segment !== opts.segment) continue;
    if (opts.t !== undefined && (l.t1 === null || l.t1 > opts.t)) continue;
    if (!best || l.time! < best.time!) best = l;
  }
  return best;
}

/** Resolve a LapRef against one entity's laps. */
export function resolveLap(laps: Lap[] | undefined, ref: LapRef, t: Sec): Lap | null {
  if (!laps?.length) return null;
  if (ref === "best") return bestLap(laps);
  if (ref === "last") {
    for (let i = laps.length - 1; i >= 0; i--) {
      const l = laps[i];
      if (l.time !== null && l.t1 !== null && l.t1 <= t) return l;
    }
    return null;
  }
  if (ref === "cursor") {
    let cur: Lap | null = null;
    for (const l of laps) if (l.t0 <= t) cur = l;
    return cur;
  }
  return laps.find((l) => l.n === ref.n) ?? null;
}

export type CellFlag = "purple" | "green" | null;

export interface TimingRow {
  entity: EntityId;
  /** Class or category, when the session has more than one. */
  cls: string | null;
  /** Rank in the table's ordering (1-based, per class when grouped by class). */
  rank: number;
  /** Official position from the classification topic, if any. */
  pos: number | null;
  best: Lap | null;
  bestFlag: CellFlag;
  /** Gap to the leader (or class leader, or reference) in seconds. */
  gap: number | null;
  /** Gap to the row ahead in seconds. */
  interval: number | null;
  /** Laps behind the leader in race mode (0 on the lead lap). */
  lapsDown: number;
  sectors: (number | null)[];
  sectorFlags: CellFlag[];
  last: Lap | null;
  lastFlag: CellFlag;
  laps: number;
  tyre: { compound: string; age: number } | null;
  pits: number;
  /** Driver currently in the car, when the feed names one. */
  driver: string | null;
  /** Interval now minus one lap earlier (race mode). Negative = closing on the car ahead. */
  intervalTrend: number | null;
  /** What the car is doing, when it is not simply on a lap. */
  status: "pit" | "out" | "in" | "stopped" | null;
  /** Speed trap of the last lap, flagged against the field and the entity's own best. */
  trap: { value: number; flag: CellFlag } | null;
  /** Knockout parts: no time in this part; best time in the furthest part reached. */
  prior?: { segment: string | null; time: number } | null;
}

export interface TimingInput {
  entities: { id: EntityId; class?: string }[];
  laps: Map<EntityId, Lap[]>;
  segments: Segment[];
  classification?: TopicData;
  stints?: Row[];
  pits?: TopicData;
  /** Which laps count for bests and colours: the whole session, the current part, or the
   * part when it is a knockout part (`advance` known). */
  scope?: "session" | "part" | "auto";
  /** Which `*_kph` lap field the trap column shows. Default: speed_trap_kph, else the first. */
  trapKey?: string;
  /** Gaps by best lap (practice, qualifying) or by elapsed time at equal laps (race). */
  gapMode?: "best" | "race";
  /** What gaps are measured to. "auto" = class leader in multi-class sessions, else leader. */
  gapTo?: "auto" | "leader" | "class" | { entity: EntityId };
  /** Ordering. "auto" = classification position when published, else by gap mode. */
  rank?: "auto" | "position" | "best" | "race";
}

/** Number of sectors the feed publishes (longest sector list over all laps). */
export function sectorCount(laps: Iterable<Lap[]>): number {
  let n = 0;
  for (const ls of laps) for (const l of ls) n = Math.max(n, l.sectors.length);
  return n;
}

/** Distinct classes in entity order; empty when the session is single-class. */
export function classesOf(entities: { class?: string }[]): string[] {
  const out: string[] = [];
  for (const e of entities) if (e.class && !out.includes(e.class)) out.push(e.class);
  return out.length > 1 ? out : [];
}

/** Everything the timing table shows at time t. Works for any series and session kind. */
export function timingAt(inp: TimingInput, t: Sec): TimingRow[] {
  const nSec = sectorCount(inp.laps.values());
  const classes = classesOf(inp.entities);
  const multi = classes.length > 0;
  const clsOf = new Map(inp.entities.map((e) => [e.id, multi ? (e.class ?? null) : null]));
  const seg = segmentAt(inp.segments, t);
  const knockout = inp.segments.some((g) => g.advance);
  const cur = inp.scope === "part" || (inp.scope === "auto" && knockout) ? seg : null;
  const inScope = (l: Lap) => !cur || l.segment === cur.id;
  const gapMode = inp.gapMode ?? "best";

  // Latest classification position per entity at or before t.
  const pos = new Map<EntityId, number>();
  const out = new Set<EntityId>();
  const cl = inp.classification;
  if (cl) {
    const end = indexAt(cl.t, cl.length, t);
    for (let i = 0; i <= end; i++) {
      const r = cl.rows[i];
      const e = String(r.entity ?? r.driver_number);
      const p = num(r.position);
      if (p !== null) pos.set(e, p);
      if (typeof r.status === "string" && /retir|dnf|dns|dsq|stopp|out/i.test(r.status)) out.add(e);
    }
  }
  // Speed trap: the configured field, else speed_trap_kph, else the first *_kph field.
  let trapKey = inp.trapKey;
  if (!trapKey) {
    const keys = new Set<string>();
    for (const ls of inp.laps.values()) for (const l of ls) if (l.speeds) for (const k of Object.keys(l.speeds)) keys.add(k);
    trapKey = keys.has("speed_trap_kph") ? "speed_trap_kph" : [...keys].sort()[0];
  }
  let fieldTrap = -Infinity;
  let fieldBestLap = Infinity;
  let leaderLastStart = -Infinity;
  for (const ls of inp.laps.values())
    for (const l of ls) {
      if (l.t0 > t) continue;
      leaderLastStart = Math.max(leaderLastStart, l.t0);
      if (l.t1 === null || l.t1 > t) continue;
      if (l.timed && l.time! < fieldBestLap) fieldBestLap = l.time!;
      const v = trapKey ? l.speeds?.[trapKey] : undefined;
      if (v !== undefined && v > fieldTrap) fieldTrap = v;
    }

  // Overall bests (purple) up to t, per class.
  const fresh = () => ({ lap: Infinity, s: new Array<number>(nSec).fill(Infinity) });
  const overall = new Map<string | null, ReturnType<typeof fresh>>();
  for (const [e, ls] of inp.laps) {
    const k = clsOf.get(e) ?? null;
    let v = overall.get(k);
    if (!v) overall.set(k, (v = fresh()));
    for (const l of ls) {
      if (l.t1 === null || l.t1 > t || l.deleted || l.outLap || !inScope(l)) continue;
      if (l.timed && l.time! < v.lap) v.lap = l.time!;
      l.sectors.forEach((s, i) => {
        if (s !== null && s < v.s[i]) v.s[i] = s;
      });
    }
  }

  const pitRows = new Map<EntityId, number>();
  const inPit = new Set<EntityId>();
  if (inp.pits) {
    const end = indexAt(inp.pits.t, inp.pits.length, t);
    for (let i = 0; i <= end; i++) {
      const r = inp.pits.rows[i];
      const e = String(r.entity ?? r.driver_number);
      pitRows.set(e, (pitRows.get(e) ?? 0) + 1);
      const dur = num(r.lane_duration_s) ?? num(r.pit_duration_s) ?? num(r.pit_duration) ?? num(r.duration_s);
      if (dur !== null && t - inp.pits.t[i] <= dur) inPit.add(e);
    }
  }

  // Knockout parts: entities without a time in this part rank by the furthest part they set a time in.
  const segIdx = new Map(inp.segments.map((g, i) => [g.id, i]));
  const reachOf = (ls: Lap[]): [number, number] => {
    if (!cur) return [0, Infinity];
    let idx = -1;
    let bestT = Infinity;
    for (const l of ls) {
      if (!l.timed || l.deleted || l.t1 === null || l.t1 > t) continue;
      const i = segIdx.get(l.segment ?? "") ?? -1;
      if (i > idx) [idx, bestT] = [i, l.time!];
      else if (i === idx && l.time! < bestT) bestT = l.time!;
    }
    return [idx, bestT];
  };
  const rows: (TimingRow & { _end: number; _reach: [number, number] })[] = inp.entities.map(({ id: e }) => {
    const ls = inp.laps.get(e) ?? [];
    const best = bestLap(ls.filter(inScope), { t });
    const done = ls.filter((l, i) => (l.t1 ?? ls[i + 1]?.t0 ?? Infinity) <= t);
    const last = [...done].reverse().find((l) => l.time !== null) ?? null;
    const pb = fresh();
    for (const l of done) {
      if (l.deleted || l.outLap || !inScope(l)) continue;
      if (l.timed && l.time! < pb.lap) pb.lap = l.time!;
      l.sectors.forEach((s, i) => {
        if (s !== null && s < pb.s[i]) pb.s[i] = s;
      });
    }
    const ov = overall.get(clsOf.get(e) ?? null) ?? fresh();
    const flag = (v: number | null, min: number, pbMin: number): CellFlag =>
      v === null ? null : v <= min ? "purple" : v <= pbMin ? "green" : null;
    const sectors = Array.from({ length: nSec }, (_, i) => best?.sectors[i] ?? null);

    const started = ls.filter((l) => l.t0 <= t);
    const curLap = started.length ? started[started.length - 1] : null;
    let tyre: TimingRow["tyre"] = null;
    let stintsStarted = 0;
    let driver: string | null = curLap?.driver ?? null;
    if (curLap && inp.stints) {
      for (const st of inp.stints) {
        if (String(st.entity ?? st.driver_number) !== e) continue;
        const a = num(st.lap_start) ?? 0;
        const b = num(st.lap_end) ?? Infinity;
        if (a <= curLap.n) stintsStarted++;
        if (curLap.n >= a && curLap.n <= b) {
          tyre = st.compound != null ? { compound: String(st.compound), age: (num(st.tyre_age_at_start_laps) ?? 0) + curLap.n - a } : null;
          driver = str(st.driver) ?? driver;
        }
      }
    }
    const lastDone = [...done].reverse().find((l) => l.t1 !== null) ?? null;
    // Trap: last completed lap's value; purple = field best so far, green = own best.
    let trap: TimingRow["trap"] = null;
    if (trapKey) {
      const v = [...done].reverse().find((l) => l.speeds?.[trapKey!] !== undefined)?.speeds?.[trapKey];
      if (v !== undefined) {
        const own = Math.max(...done.map((l) => l.speeds?.[trapKey!] ?? -Infinity));
        trap = { value: v, flag: v >= fieldTrap ? "purple" : v >= own ? "green" : null };
      }
    }
    const reach = reachOf(ls);
    const lapDur = Number.isFinite(fieldBestLap) ? fieldBestLap : 120;
    const status: TimingRow["status"] = out.has(e)
      ? "stopped"
      : inPit.has(e)
        ? "pit"
        : curLap && curLap.t1 !== null && curLap.t1 > t && curLap.outLap
          ? "out"
          : curLap && curLap.t1 !== null && curLap.t1 > t && curLap.inLap
            ? "in"
            : gapMode === "race" && curLap && leaderLastStart - curLap.t0 > 3 * lapDur && (curLap.t1 === null || curLap.t1 <= t)
              ? "stopped"
              : null;
    return {
      entity: e,
      cls: clsOf.get(e) ?? null,
      rank: 0,
      pos: pos.get(e) ?? null,
      best,
      bestFlag: best && best.time! <= ov.lap ? "purple" : null,
      gap: null,
      interval: null,
      lapsDown: 0,
      sectors,
      sectorFlags: sectors.map((s, i) => flag(s, ov.s[i], pb.s[i])),
      last,
      lastFlag: last && !last.deleted && last.timed && inScope(last) ? flag(last.time, ov.lap, pb.lap) : null,
      laps: lastDone ? lastDone.n : done.length,
      tyre,
      pits: pitRows.get(e) ?? Math.max(0, stintsStarted - 1),
      driver,
      intervalTrend: null,
      status,
      trap,
      _end: lastDone?.t1 ?? Infinity,
      _reach: reach,
      prior: cur && !best && reach[0] >= 0 ? { segment: inp.segments[reach[0]]?.id ?? null, time: reach[1] } : null,
    };
  });

  const rank = inp.rank ?? "auto";
  const usePos = rank === "position" || (rank === "auto" && pos.size > 0);
  const byRace = rank === "race" || (rank === "auto" && !usePos && gapMode === "race");
  const tie = (a: TimingRow, b: TimingRow) =>
    Number(a.entity) - Number(b.entity) || a.entity.localeCompare(b.entity);
  rows.sort((a, b) => {
    if (usePos && (a.pos !== null || b.pos !== null) && a.pos !== b.pos) return (a.pos ?? Infinity) - (b.pos ?? Infinity);
    if (byRace) return b.laps - a.laps || a._end - b._end || tie(a, b);
    const ta = a.best?.time ?? Infinity;
    const tb = b.best?.time ?? Infinity;
    if (cur && ta === Infinity && tb === Infinity) return b._reach[0] - a._reach[0] || a._reach[1] - b._reach[1] || tie(a, b);
    return ta - tb || tie(a, b);
  });

  // Gaps. Race mode: time behind at the same lap count (needs each lap's end time).
  const endOf = (e: EntityId, n: number) => inp.laps.get(e)?.find((l) => l.n === n)?.t1 ?? null;
  const gapTo = inp.gapTo ?? "auto";
  const perClass = gapTo === "class" || (gapTo === "auto" && multi);
  const refId = typeof gapTo === "object" ? gapTo.entity : null;
  const ranks = new Map<string | null, number>();
  const leaders = new Map<string | null, (typeof rows)[number]>();
  const ref = refId ? rows.find((r) => r.entity === refId) : undefined;
  let prev: (typeof rows)[number] | undefined;
  const prevByClass = new Map<string | null, (typeof rows)[number]>();
  for (const r of rows) {
    const k = perClass ? r.cls : null;
    r.rank = (ranks.get(k) ?? 0) + 1;
    ranks.set(k, r.rank);
    if (!leaders.has(k)) leaders.set(k, r);
    const base = ref ?? leaders.get(k)!;
    const ahead = perClass ? prevByClass.get(k) : prev;
    if (gapMode === "race") {
      const g = (o: typeof r) => {
        if (!r.laps || !o.laps) return null;
        const n = Math.min(r.laps, o.laps);
        const a = endOf(r.entity, n);
        const b = endOf(o.entity, n);
        return a !== null && b !== null ? a - b : null;
      };
      r.gap = r === base ? 0 : g(base);
      r.lapsDown = Math.max(0, base.laps - r.laps);
      r.interval = ahead ? g(ahead) : null;
      if (ahead && r.interval !== null && r.laps > 1 && ahead.laps >= r.laps) {
        const n = r.laps - 1;
        const a = endOf(r.entity, n);
        const b = endOf(ahead.entity, n);
        if (a !== null && b !== null) r.intervalTrend = r.interval - (a - b);
      }
    } else {
      const bt = base.best?.time;
      r.gap = r.best && bt != null ? r.best.time! - bt : null;
      const at = ahead?.best?.time;
      r.interval = r.best && at != null ? r.best.time! - at : null;
    }
    prev = r;
    prevByClass.set(k, r);
  }
  return rows.map(({ _end, ...r }) => (void _end, r));
}

export interface LapTrace {
  entity: EntityId;
  lap: Lap;
  /** Lap distance per sample, metres. */
  d: Float64Array;
  /** Time since lap start per sample, seconds. */
  tau: Float64Array;
  channels: Record<string, Float32Array>;
  /** Distance normalisation factor; outside 0.95–1.05 is suspicious. */
  k: number;
  length: number;
}

/**
 * Lap distance from speed (F1 publishes no distance channel): integrate speed with
 * trapezoids over [t0 − 1 s, t1 + 1 s], zero at the lap start, normalise to L.
 */
export function lapTrace(tel: TopicData, lap: Lap, L: number | null, entity = lap.entity): LapTrace | null {
  if (lap.time === null || lap.t1 === null) return null;
  const T = lap.time;
  const i0 = Math.max(0, indexAt(tel.t, tel.length, lap.t0 - 1));
  const i1 = Math.min(tel.length - 1, indexAt(tel.t, tel.length, lap.t1 + 1) + 1);
  const speed = tel.cols.speed_kph;
  // Games publish lap distance; F1 does not, so integrate speed there.
  const dist = tel.cols.lap_distance_m ?? tel.cols.distance_m;
  if ((!speed && !dist) || i1 - i0 < 3) return null;
  const n = i1 - i0 + 1;
  const tau = new Float64Array(n);
  const D = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    tau[j] = tel.t[i0 + j] - lap.t0;
    if (j === 0) continue;
    if (dist) {
      // Lap distance resets at the line: ignore the backwards jump.
      D[j] = D[j - 1] + Math.max(0, (dist[i0 + j] || 0) - (dist[i0 + j - 1] || 0));
    } else {
      const v0 = (speed[i0 + j - 1] || 0) / 3.6;
      const v1 = (speed[i0 + j] || 0) / 3.6;
      D[j] = D[j - 1] + ((v0 + v1) / 2) * (tau[j] - tau[j - 1]);
    }
  }
  const at = (x: number) => interp(tau, D, x);
  const D0 = at(0);
  const DT = at(T) - D0;
  if (!(DT > 0)) return null;
  const length = L ?? DT;
  const k = length / DT;
  // Keep samples inside the lap and pin both ends.
  const keep: number[] = [];
  for (let j = 0; j < n; j++) if (tau[j] > 0 && tau[j] < T) keep.push(j);
  const m = keep.length + 2;
  const d = new Float64Array(m);
  const tt = new Float64Array(m);
  const channels: Record<string, Float32Array> = {};
  for (const name of Object.keys(tel.cols)) channels[name] = new Float32Array(m);
  const fill = (dst: number, x: number, src: number | null) => {
    tt[dst] = x;
    for (const name of Object.keys(tel.cols)) {
      const col = tel.cols[name];
      channels[name][dst] =
        src !== null ? col[i0 + src] : interp(tau, col.subarray(i0, i0 + n), x);
    }
  };
  fill(0, 0, null);
  d[0] = 0;
  keep.forEach((j, idx) => {
    fill(idx + 1, tau[j], j);
    d[idx + 1] = Math.min(length, Math.max(d[idx], k * (D[j] - D0)));
  });
  fill(m - 1, T, null);
  d[m - 1] = length;
  return { entity, lap, d, tau: tt, channels, k, length };
}

/** Linear interpolation of y over ascending x, clamped at the ends. */
export function interp(x: ArrayLike<number>, y: ArrayLike<number>, at: number): number {
  const n = x.length;
  if (!n) return NaN;
  if (at <= x[0]) return y[0];
  if (at >= x[n - 1]) return y[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= at) lo = mid;
    else hi = mid;
  }
  const dx = x[hi] - x[lo];
  return dx > 0 ? y[lo] + ((y[hi] - y[lo]) * (at - x[lo])) / dx : y[lo];
}

/** Δ(d) = τB(d) − τA(d) on a regular grid; positive means B is behind. */
export function deltaTrace(a: LapTrace, b: LapTrace, step = 5) {
  const L = Math.min(a.length, b.length);
  const n = Math.floor(L / step) + 1;
  const d = new Float64Array(n + 1);
  const delta = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    d[i] = i * step;
    delta[i] = interp(b.d, b.tau, d[i]) - interp(a.d, a.tau, d[i]);
  }
  d[n] = L;
  delta[n] = interp(b.d, b.tau, L) - interp(a.d, a.tau, L);
  return { d, delta };
}

/** Car position at t: linear interpolation when the neighbouring samples are ≤ 1 s apart. */
export function poseAt(pose: TopicData, t: Sec, maxGap = 1): [number, number] | null {
  const i = indexAt(pose.t, pose.length, t);
  if (i < 0) return null;
  const x = pose.cols.x_m;
  const y = pose.cols.y_m;
  if (i === pose.length - 1) return t - pose.t[i] <= maxGap ? [x[i], y[i]] : null;
  const t0 = pose.t[i];
  const t1 = pose.t[i + 1];
  if (t1 - t0 > maxGap) return t - t0 <= 1e-6 ? [x[i], y[i]] : null;
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  return [x[i] + (x[i + 1] - x[i]) * f, y[i] + (y[i + 1] - y[i]) * f];
}
