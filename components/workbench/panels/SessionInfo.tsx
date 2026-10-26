"use client";

import { useMemo } from "react";

import { trackStatusAt, valueAt } from "@/lib/workbench/analysis";
import { classesOf } from "@/lib/workbench/derive";
import { fmtClock, segmentClock, sentenceCase, timeOfDay } from "@/lib/workbench/format";
import { usePalette } from "../colors";
import { cfg, patch } from "../menus";
import { useWB, type MenuItem } from "../state";
import { Empty, useThrottledT, type PanelDef, type PanelProps } from "./common";

const ROWS = [
  { key: "session", label: "Session" },
  { key: "clock", label: "Clock" },
  { key: "remaining", label: "Remaining" },
  { key: "status", label: "Track status" },
  { key: "weather", label: "Weather" },
  { key: "tod", label: "Local time" },
  { key: "laps", label: "Laps" },
  { key: "field", label: "Field" },
  { key: "source", label: "Source" },
] as const;

const KIND: Record<string, string> = { practice: "Practice", qualifying: "Qualifying", race: "Race", test: "Test" };

/** Flag → block colour. Neutral states (no flag yet, clear) fall back to the faint text colour. */
export function flagColour(flag: string, flags: Record<string, string>, fallback: string): string {
  const f = flag.toUpperCase();
  if (flags[f]) return flags[f];
  if (/\b(SC|VSC|FCY|SAFETY|YELLOW|SLOW)\b/.test(f)) return flags.YELLOW || fallback;
  if (/\bRED\b/.test(f)) return flags.RED || fallback;
  if (/\b(GREEN|CLEAR)\b/.test(f)) return flags.GREEN || fallback;
  return flags[f.split(" ")[0]] || fallback;
}

function SessionInfo({ panel }: PanelProps) {
  const p = usePalette();
  const session = useWB((s) => s.session);
  const derived = useWB((s) => s.derived);
  const store = useWB((s) => s.store);
  const version = useWB((s) => s.version);
  const t = useThrottledT(4);
  const hidden = new Set((panel.config.hide as string[]) ?? []);
  const events = useMemo(() => store.get(panel.bindings.events ?? "/session/events"), [store, version, panel.bindings.events]); // eslint-disable-line react-hooks/exhaustive-deps
  const weather = store.get(panel.bindings.weather ?? "/session/weather");

  if (!session || !derived) return <Empty title="No session" />;
  const status = trackStatusAt(events, t);
  let leaderLaps = 0;
  for (const ls of derived.lapsByEntity.values()) for (const l of ls) if (l.t1 !== null && l.t1 <= t) leaderLaps = Math.max(leaderLaps, l.n);
  const totalLaps = Math.max(0, ...derived.laps.map((l) => l.n));
  const classes = classesOf(derived.entities);
  // Time left in the current part when the feed has parts, else in the session.
  const part = derived.segments.find((sg) => sg.t0 <= t && (sg.t1 === null || t <= sg.t1));
  const remaining = (part ? (part.t1 ?? session.session[1]) : session.session[1]) - t;
  const started = t >= session.session[0];
  const flag = status.flag ?? (started ? "GREEN" : null);
  const show = (k: string) => !hidden.has(k);

  const remainingText =
    remaining > 0 && started ? fmtClock(remaining, false) : !started ? "Not started" : part || t > session.session[1] ? "Finished" : "Between parts";
  const flagC = flag ? flagColour(flag, p.flag, p.text3) : p.text3;
  const alert = !!flag && /\b(SC|VSC|FCY|SAFETY|YELLOW|SLOW|RED)\b/i.test(flag);

  const w = (k: string) => valueAt(weather, k, t);
  const wx = weather
    ? [
        w("air_temperature_c") !== null ? `Air ${w("air_temperature_c")!.toFixed(1)}°` : null,
        w("track_temperature_c") !== null ? `Track ${w("track_temperature_c")!.toFixed(1)}°` : null,
        w("humidity_pct") !== null ? `${Math.round(w("humidity_pct")!)}% RH` : null,
        w("wind_speed_mps") !== null ? `Wind ${w("wind_speed_mps")!.toFixed(1)} m/s` : null,
        w("rainfall") !== null ? (w("rainfall")! > 0 ? "Rain" : "Dry") : null,
      ].filter(Boolean)
    : [];
  const windDir = w("wind_direction_deg");

  const rows: [string, React.ReactNode][] = [];
  if (show("tod")) rows.push(["Local time", timeOfDay(t, session.startNs, session.utcOffsetSec)]);
  if (show("laps")) rows.push(["Laps", totalLaps ? `${leaderLaps} of ${totalLaps}` : <span className="pw-faint">—</span>]);
  if (show("field")) rows.push(["Field", `${derived.entities.length} cars${classes.length ? ` · ${classes.join(", ")}` : ""}`]);
  if (show("source")) rows.push(["Source", <span key="s" className="pw-faint">{session.adapter} · {session.topics.length} topics</span>]);

  return (
    <div className="wb-info">
      {show("session") ? (
        <div className="wb-info__title" title={session.title || session.event}>
          <span className="pw-strong">{session.title || session.event}</span>
          <span className="pw-faint"> · {[session.series, KIND[session.kind], session.venue].filter(Boolean).join(" · ")}</span>
        </div>
      ) : null}
      {show("clock") || show("remaining") ? (
        <div className="wb-info__clocks">
          {show("clock") ? (
            <div>
              <div className="wb-info__label">{part && derived.segments.length > 1 ? part.id : part || !derived.segments.length ? "Elapsed" : segmentClock(t, derived.segments, session.session).split(" ")[0]}</div>
              <div className="wb-info__big">{bigClock(segmentClock(t, derived.segments, session.session), part?.id ?? null)}</div>
            </div>
          ) : null}
          {show("remaining") ? (
            <div>
              <div className="wb-info__label">Remaining</div>
              <div className={`wb-info__big${remaining > 0 && started ? "" : " is-muted"}`}>{remainingText}</div>
            </div>
          ) : null}
        </div>
      ) : null}
      {show("status") ? (
        <div className={`wb-info__flag${alert ? " is-alert" : ""}`} style={{ ["--c" as string]: flagC }}>
          <i className="wb-flag" />
          <span className="wb-info__flagname">{flag ? flagLabel(flag) : "No status yet"}</span>
          {status.message && flag && status.message.toUpperCase() !== flag ? (
            <span className="wb-info__flagmsg" title={status.message}>
              {sentenceCase(status.message)}
            </span>
          ) : null}
        </div>
      ) : null}
      {show("status") && status.sectors.length ? (
        <div className="wb-info__sectors">
          {status.sectors.map((sc) => (
            <span key={sc.sector} className="wb-info__sector">
              <i className="wb-flag" style={{ ["--c" as string]: flagColour(sc.flag, p.flag, p.text3) }} />
              {flagLabel(sc.flag)} in sector {sc.sector}
            </span>
          ))}
        </div>
      ) : null}
      {show("weather") && wx.length ? (
        <div className="wb-info__wx">
          {wx.join(" · ")}
          {windDir !== null ? (
            <span className="wb-info__dir" style={{ transform: `rotate(${windDir + 180}deg)` }} title={`Wind from ${Math.round(windDir)}°`}>
              ↑
            </span>
          ) : null}
        </div>
      ) : null}
      {rows.length ? (
        <dl className="wb-kv wb-kv--compact">
          {rows.map(([k, v]) => (
            <div key={k} className="wb-kv__row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** The label above already names the part, so drop it from the big clock. */
function bigClock(s: string, part: string | null): string {
  if (part && s.startsWith(`${part} `)) return s.slice(part.length + 1);
  return part ? s : s.replace(/^\S+ /, "");
}

function flagLabel(f: string) {
  const map: Record<string, string> = { SC: "Safety car", VSC: "Virtual safety car", FCY: "Full course yellow", GREEN: "Green", RED: "Red flag", CHEQUERED: "Chequered" };
  return map[f] ?? f.charAt(0) + f.slice(1).toLowerCase();
}

function infoMenu(id: string): MenuItem[] {
  return [
    {
      label: "Rows",
      submenu: () => {
        const hide = cfg<string[]>(id, "hide", []);
        return ROWS.map((r) => ({
          label: r.label,
          checked: !hide.includes(r.key),
          keepOpen: true,
          onSelect: () => {
            const h = cfg<string[]>(id, "hide", []);
            patch(id, { hide: h.includes(r.key) ? h.filter((x) => x !== r.key) : [...h, r.key] });
          },
        }));
      },
    },
  ];
}

export const sessionInfo: PanelDef = {
  type: "session-info",
  title: "Session",
  description: "Big part clock and time remaining, the track status, sector flags, a weather line, local time and lap count.",
  icon: "time",
  primary: "info",
  slots: {
    info: { schemas: ["rtc.session_info"], required: false, default: "/session/info" },
    events: { schemas: ["rtc.events"], required: false, default: "/session/events" },
    laps: { schemas: ["rtc.laps"], required: false, default: "/timing/laps" },
    weather: { schemas: ["rtc.weather"], required: false, default: "/session/weather" },
  },
  defaultConfig: { hide: [] },
  menu: ({ id }) => infoMenu(id),
  Component: SessionInfo,
};
