import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import { bufferReadable, decodeMcap } from "../lib/workbench/decode";
import { bestLap, deltaTrace, lapTrace, poseAt, timingAt } from "../lib/workbench/derive";
import { applyMessage, derive, type Derived } from "../lib/workbench/session";
import { Store } from "../lib/workbench/store";
import type { SessionMeta, WorkerMessage } from "../lib/workbench/types";

// Real Singapore 2026 qualifying recording; skipped where the file is not present (CI).
const FILE = process.env.WB_MCAP ?? "/workspace/f1data-out/2026/17_singapore/qualifying.mcap";
const has = fs.existsSync(FILE);

describe.skipIf(!has)("Singapore 2026 qualifying MCAP", () => {
  const store = new Store();
  let session: SessionMeta;
  let d: Derived;
  const kinds: string[] = [];

  beforeAll(async () => {
    const buf = new Uint8Array(fs.readFileSync(FILE));
    await decodeMcap(bufferReadable(buf), (m: WorkerMessage) => {
      kinds.push(m.type);
      if (m.type === "summary") session = m.session;
      applyMessage(store, m);
    });
    d = derive(store, session);
  }, 60_000);

  it("posts the summary before data and ends with done", () => {
    expect(kinds[0]).toBe("summary");
    expect(kinds.at(-1)).toBe("done");
    expect(session.kind).toBe("qualifying");
    expect(session.title).toBe("Singapore Grand Prix · Qualifying");
    expect(session.topics.some((t) => t.name === "/vehicle/12/telemetry")).toBe(true);
    expect(session.topics.some((t) => t.name.startsWith("/scene"))).toBe(false);
  });

  it("maps 22 entities and Q1/Q2/Q3 segments from race control", () => {
    expect(d.entities).toHaveLength(22);
    expect(d.segments.map((s) => s.id)).toEqual(["Q1", "Q2", "Q3"]);
    expect(d.segments.every((s) => s.t1 !== null)).toBe(true);
    expect(d.segments[0].t0).toBeGreaterThan(0);
    expect(session.window[1]).toBeGreaterThan(d.segments[2].t1!);
  });

  it("final order and bests match /results/session", () => {
    const results = store.get("/results/session")!.rows;
    const rows = timingAt(
      {
        entities: d.entities,
        laps: d.lapsByEntity,
        segments: d.segments,
        classification: store.get("/timing/classification"),
        stints: store.get("/timing/stints")?.rows,
      },
      session.window[1],
    );
    const expected = [...results].sort((a, b) => Number(a.position ?? 99) - Number(b.position ?? 99));
    expect(rows.map((r) => r.entity)).toEqual(expected.map((r) => String(r.driver_number)));
    // Session-wide best = fastest of the official per-part bests; no part-specific logic needed.
    for (const [i, r] of rows.entries()) {
      const durs = (expected[i].durations_s as (number | null)[]).filter((x): x is number => x !== null);
      if (!durs.length) expect(r.best).toBeNull();
      else expect(r.best?.time).toBeCloseTo(Math.min(...durs), 3);
    }
    expect(rows.map((r) => r.pos)).toEqual(rows.map((_, i) => i + 1));
  });

  it("flags deleted laps from race control", () => {
    // "CAR 12 (ANT) LAP DELETED ... LAP 8 21:42:03": the clock puts the offence on the 1:32.818 lap.
    const del = d.lapsByEntity.get("12")!.filter((l) => l.deleted);
    expect(del.map((l) => l.time)).toEqual([92.818]);
    const all = d.laps.filter((l) => l.deleted);
    expect(all.length).toBeGreaterThan(3);
    expect(all.every((l) => l.deletedReason?.includes(`CAR ${l.entity} `))).toBe(true);
  });

  it("delta at L equals the lap-time difference by construction", () => {
    const [p1, p2] = ["3", "16"];
    const la = bestLap(d.lapsByEntity.get(p1))!;
    const lb = bestLap(d.lapsByEntity.get(p2))!;
    const ta = lapTrace(store.get(`/vehicle/${p1}/telemetry`)!, la, d.lapLength)!;
    const tb = lapTrace(store.get(`/vehicle/${p2}/telemetry`)!, lb, d.lapLength)!;
    expect(ta.k).toBeGreaterThan(0.95);
    expect(ta.k).toBeLessThan(1.05);
    const { delta } = deltaTrace(ta, tb);
    expect(delta[delta.length - 1]).toBeCloseTo(lb.time! - la.time!, 3);
  });

  it("interpolates pose mid-lap near the outline and never at the origin", () => {
    const la = bestLap(d.lapsByEntity.get("3"))!;
    const p = poseAt(store.get("/vehicle/3/pose")!, la.t0 + la.time! / 2)!;
    const o = store.latest<{ x: number[]; y: number[] }>("/track/outline")!;
    let min = Infinity;
    for (let i = 0; i < o.x.length; i++) min = Math.min(min, Math.hypot(o.x[i] - p[0], o.y[i] - p[1]));
    expect(min).toBeLessThan(30);
    expect(Math.hypot(p[0], p[1])).toBeGreaterThan(1);
  });
});
