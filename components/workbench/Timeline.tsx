"use client";

import { useEffect, useMemo, useRef } from "react";

import { fmtClock, segmentClock, timeOfDay } from "@/lib/workbench/format";
import { usePalette } from "./colors";
import { useThrottledT } from "./panels/common";
import { openMenu, setT, SPEEDS, stepLap, togglePlay, useWB } from "./state";

/** Playback bar: transport, playhead, scrubber (session parts, flags, the focused driver's laps), speed. */
export function Timeline() {
  const session = useWB((s) => s.session);
  const derived = useWB((s) => s.derived);
  const store = useWB((s) => s.store);
  const version = useWB((s) => s.version);
  const playing = useWB((s) => s.playing);
  const speed = useWB((s) => s.speed);
  const focus = useWB((s) => s.sel.focus);
  const progress = useWB((s) => s.progress);
  const status = useWB((s) => s.status);
  const t = useThrottledT(15);
  const p = usePalette();
  const track = useRef<HTMLDivElement>(null);
  const [w0, w1] = session?.window ?? [0, 1];
  const f = (x: number) => Math.min(1, Math.max(0, (x - w0) / (w1 - w0)));

  // Head position updates every frame, outside React.
  useEffect(() => {
    const set = () => track.current?.style.setProperty("--t", String(f(useWB.getState().t)));
    set();
    return useWB.subscribe((s, prev) => s.t !== prev.t && set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w0, w1]);

  const flags = useMemo(() => {
    const d = store.get("/session/events");
    if (!d) return [];
    const out: { t: number; flag: string; message: string }[] = [];
    for (let i = 0; i < d.length; i++) {
      const r = d.rows[i];
      if (r.category === "Flag" && r.flag && !r.entity) out.push({ t: d.t[i], flag: String(r.flag), message: String(r.message ?? "") });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, version]);

  const ticks = useMemo(() => {
    const span = w1 - w0;
    const step = [60, 120, 300, 600, 900, 1800].find((s) => span / s <= 12) ?? 3600;
    const out: number[] = [];
    for (let x = Math.ceil(w0 / step) * step; x <= w1; x += step) out.push(x);
    return out;
  }, [w0, w1]);

  const focusLaps = (focus && derived?.lapsByEntity.get(focus)) || [];
  const focusCode = (focus && derived?.entityById.get(focus)?.code) || "focused driver";

  const scrub = (e: React.PointerEvent) => {
    const el = track.current!;
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const go = (x: number) => setT(w0 + ((x - r.left) / r.width) * (w1 - w0));
    go(e.clientX);
    const move = (ev: PointerEvent) => go(ev.clientX);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <footer className="pw-timeline wb-timeline">
      <span className="pw-timeline__controls">
        <button type="button" className="pw-btn pw-btn--ghost pw-btn--icon" aria-label="Previous lap" title={`Previous lap of ${focusCode} ([)`} onClick={() => stepLap(-1)}>
          <span className="pw-icon pw-icon--skip-back" />
        </button>
        <button type="button" className="pw-btn pw-btn--ghost pw-btn--icon" aria-label={playing ? "Pause" : "Play"} title="Play/pause (Space)" onClick={togglePlay} disabled={!session}>
          <span className={`pw-icon pw-icon--${playing ? "pause" : "play"}`} />
        </button>
        <button type="button" className="pw-btn pw-btn--ghost pw-btn--icon" aria-label="Next lap" title={`Next lap of ${focusCode} (])`} onClick={() => stepLap(1)}>
          <span className="pw-icon pw-icon--skip-forward" />
        </button>
      </span>
      <span className="pw-timeline__time pw-num">
        {session ? (
          <>
            <b>{segmentClock(t, derived?.segments ?? [], session.session)}</b>
            <span className="pw-faint">{timeOfDay(t, session.startNs, session.utcOffsetSec).replace(/ UTC.*/, "")}</span>
          </>
        ) : (
          <span className="pw-faint">—</span>
        )}
      </span>
      <div ref={track} className="pw-timeline__track" onPointerDown={session ? scrub : undefined}>
        {(derived?.segments ?? []).map((s) => (
          <span
            key={s.id}
            className="pw-timeline__span pw-timeline__span--quiet"
            style={{ ["--a" as string]: f(s.t0), ["--b" as string]: f(s.t1 ?? w1) }}
            title={`${s.id} ${fmtClock((s.t1 ?? w1) - s.t0, false)}`}
          >
            {s.id}
          </span>
        ))}
        <span className="pw-timeline__rail" />
        {status === "loading" && progress && progress.total ? (
          <span className="pw-timeline__live" style={{ ["--a" as string]: progress.bytes / progress.total }} />
        ) : null}
        {flags.map((fl, i) => (
          <span
            key={i}
            className="pw-timeline__mark"
            title={`${segmentClock(fl.t, derived?.segments ?? [], session!.session)} ${fl.message}`}
            style={{ ["--a" as string]: f(fl.t), ["--c" as string]: p.flag[fl.flag] ?? p.text3 }}
          />
        ))}
        {focusLaps.map((l) => (
          <span key={l.n} className="wb-lapmark" style={{ ["--a" as string]: f(l.t0) }} />
        ))}
        <span className="pw-timeline__ticks">
          {ticks.map((x) => (
            <span key={x} className="pw-timeline__tick" style={{ ["--a" as string]: f(x) }}>
              {session ? timeOfDay(x, session.startNs, session.utcOffsetSec).slice(0, 5) : ""}
            </span>
          ))}
        </span>
        <span className="pw-timeline__head" />
      </div>
      <span className="pw-timeline__right">
        <button
          type="button"
          className="pw-btn pw-btn--ghost pw-btn--sm wb-speed"
          title="Playback speed (− / +)"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            openMenu(r.left, r.top - 8 - SPEEDS.length * 26, SPEEDS.map((s) => ({
              label: `${s}×`,
              radio: true,
              checked: s === speed,
              onSelect: () => useWB.setState({ speed: s }),
            })));
          }}
        >
          {speed}×
        </button>
      </span>
    </footer>
  );
}
