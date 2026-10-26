import type { Lap } from "../lib/workbench/types";
import type { TopicData } from "../lib/workbench/store";

/** Laps for one entity from lap times; each lap starts where the previous ended. */
export function laps(entity: string, times: (number | null)[], opts: { start?: number; sectors?: number; outLaps?: number[]; drivers?: string[] } = {}): Lap[] {
  let t = opts.start ?? 0;
  const nSec = opts.sectors ?? 3;
  return times.map((time, i) => {
    const t0 = t;
    const dur = time ?? 120;
    t += dur;
    const out = opts.outLaps?.includes(i + 1) ?? false;
    return {
      entity,
      n: i + 1,
      t0,
      t1: t,
      time,
      sectors: time === null ? new Array(nSec).fill(null) : Array.from({ length: nSec }, () => time / nSec),
      outLap: out,
      driver: opts.drivers?.[i],
      deleted: false,
      segment: null,
      timed: time !== null && !out,
    };
  });
}

export function topic(ts: number[], rows: Record<string, unknown>[]): TopicData {
  return { t: Float64Array.from(ts), length: ts.length, cols: {}, rows };
}
