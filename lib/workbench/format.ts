import type { Segment, Sec } from "./types";

const MINUS = "\u2212";

export function fmtLap(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return "—";
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return m > 0 ? `${m}:${rest.toFixed(3).padStart(6, "0")}` : rest.toFixed(3);
}

export function fmtSector(s: number | null | undefined): string {
  return s == null || !Number.isFinite(s) ? "—" : s.toFixed(3);
}

export function fmtSigned(v: number | null | undefined, digits = 3): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v).toFixed(digits);
  return Number(a) === 0 ? `±${a}` : v > 0 ? `+${a}` : `${MINUS}${a}`;
}

export function fmtClock(sec: number, tenths = true): string {
  const sign = sec < 0 ? MINUS : "";
  const a = Math.abs(sec);
  const m = Math.floor(a / 60);
  const s = a - m * 60;
  return `${sign}${String(m).padStart(2, "0")}:${tenths ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0")}`;
}

/** Segment clock like `Q3 08:12.4`; `Break` between segments; `Pre` before the first. */
export function segmentClock(t: Sec, segments: Segment[], session: [Sec, Sec]): string {
  let cur: Segment | null = null;
  for (const s of segments) if (s.t0 <= t) cur = s;
  if (!segments.length) return fmtClock(t - session[0]);
  if (!cur) return `Pre ${fmtClock(t - segments[0].t0)}`;
  if (cur.t1 !== null && t > cur.t1) {
    const next = segments.find((s) => s.t0 > t);
    return next ? `Break ${fmtClock(t - cur.t1)}` : `${cur.id} +${fmtClock(t - cur.t1)}`;
  }
  return `${cur.id} ${fmtClock(t - cur.t0)}`;
}

/** Time of day at the track: `16:55:12 UTC+8`. */
export function timeOfDay(t: Sec, startNs: string, utcOffsetSec: number): string {
  const ms = Number(BigInt(startNs) / BigInt(1000000)) + t * 1000 + utcOffsetSec * 1000;
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  const h = utcOffsetSec / 3600;
  const tz = h === 0 ? "UTC" : `UTC${h > 0 ? "+" : MINUS}${Math.abs(h)}`;
  return `${hh}:${mm}:${ss} ${tz}`;
}

const KEEP = new Set(["FIA", "DRS", "SC", "VSC", "FCY", "ERS", "PU", "RC", "F1", "F2", "F3", "UTC", "GMT", "CET", "TV", "OK", "II", "III", "LMP1", "LMP2", "LMGT3", "GT3", "GTE", "LMH", "LMDH", "IMSA", "WEC", "ACO"]);

/**
 * Race control shouts in capitals; show it in sentence case. Acronyms, codes in brackets
 * ("(VER)") and mixed letter-digit tokens stay as written.
 */
export function sentenceCase(msg: string): string {
  if (/[a-z]/.test(msg)) return msg;
  let first = true;
  return msg.replace(/[A-Z0-9][A-Z0-9'’.-]*/g, (w, at: number) => {
    const bracketed = msg[at - 1] === "(" && msg[at + w.length] === ")";
    const isFirst = first;
    first = false;
    const core = w.replace(/[.'’-]+$/, "");
    if (bracketed || KEEP.has(core) || (/\d/.test(core) && /[A-Z]/.test(core))) return w;
    const lower = w.toLowerCase();
    const afterStop = /[.!?:]\s+$/.test(msg.slice(0, at));
    return isFirst || afterStop ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  });
}

