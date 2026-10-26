import type { RowBatch, Sec, StreamBatch } from "./types";

/** One topic's data: time column plus either float columns (streams) or rows. */
export interface TopicData {
  t: Float64Array;
  length: number;
  cols: Record<string, Float32Array>;
  rows: Record<string, unknown>[];
}

function grow<T extends Float64Array | Float32Array>(arr: T, need: number): T {
  if (arr.length >= need) return arr;
  let cap = Math.max(arr.length * 2, 1024);
  while (cap < need) cap *= 2;
  const next = new (arr.constructor as { new (n: number): T })(cap);
  next.set(arr);
  return next;
}

/** Append-only, time-indexed columnar store. Replay fills it in one pass; live would append. */
export class Store {
  topics = new Map<string, TopicData>();
  end: Sec = -Infinity;
  version = 0;

  private ensure(topic: string): TopicData {
    let d = this.topics.get(topic);
    if (!d) {
      d = { t: new Float64Array(0), length: 0, cols: {}, rows: [] };
      this.topics.set(topic, d);
    }
    return d;
  }

  appendStream(b: StreamBatch) {
    const d = this.ensure(b.topic);
    const n = b.t.length;
    const need = d.length + n;
    d.t = grow(d.t, need);
    d.t.set(b.t, d.length);
    for (const [k, v] of Object.entries(b.cols)) {
      const col = grow(d.cols[k] ?? new Float32Array(0), need);
      col.set(v, d.length);
      d.cols[k] = col;
    }
    d.length = need;
    if (n) this.end = Math.max(this.end, b.t[n - 1]);
  }

  appendRows(b: RowBatch) {
    const d = this.ensure(b.topic);
    const n = b.t.length;
    d.t = grow(d.t, d.length + n);
    d.t.set(b.t, d.length);
    for (const r of b.rows) d.rows.push(r);
    d.length += n;
    if (n) this.end = Math.max(this.end, b.t[n - 1]);
  }

  get(topic: string): TopicData | undefined {
    return this.topics.get(topic);
  }

  /** Last index with time <= t, or -1. */
  indexAt(topic: string, t: Sec): number {
    const d = this.topics.get(topic);
    return d ? indexAt(d.t, d.length, t) : -1;
  }

  /** Half-open index range [i0, i1) of samples with t0 <= time <= t1. */
  range(topic: string, t0: Sec, t1: Sec): [number, number] {
    const d = this.topics.get(topic);
    if (!d) return [0, 0];
    return [indexAt(d.t, d.length, t0 - 1e-9) + 1, indexAt(d.t, d.length, t1) + 1];
  }

  /** Snapshot/static topics: latest message wins. */
  latest<T = Record<string, unknown>>(topic: string): T | undefined {
    const d = this.topics.get(topic);
    return d && d.rows.length ? (d.rows[d.rows.length - 1] as T) : undefined;
  }
}

export function indexAt(t: Float64Array, length: number, x: number): number {
  let lo = 0;
  let hi = length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= x) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
