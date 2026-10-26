import { describe, expect, it } from "vitest";

import { PANELS } from "../components/workbench/panels/registry";
import { gridMetrics, lapGrid, pedalShare, representativeLaps } from "../lib/workbench/analysis";
import { buildLaps, speedsOf, timingAt, withAdvance } from "../lib/workbench/derive";
import { DEFAULT_TABS, PRESETS } from "../lib/workbench/presets";
import type { Lap, Segment } from "../lib/workbench/types";
import { niceTicks } from "../components/workbench/panels/LapDistribution";
import { categoryLabel, flagText, sentenceCase, shortClock } from "../components/workbench/panels/EventLog";
import { flagColour } from "../components/workbench/panels/SessionInfo";
import { onColour } from "../components/workbench/colors";
import { laps, topic } from "./workbench-fixtures";

const seg = (id: string, t0: number, t1: number | null): Segment => ({ id, t0, t1 });
const inPart = (ls: Lap[], id: string) => ls.map((l) => ({ ...l, segment: id }));

describe("data model", () => {
  it("collects every *_kph field as a speed and marks in laps", () => {
    expect(speedsOf({ speed_trap_kph: 320, intermediate_1_kph: 280, lap_time_s: 90, foo_kph: "x" })).toEqual({ speed_trap_kph: 320, intermediate_1_kph: 280 });
    expect(speedsOf({ lap_time_s: 90 })).toBeUndefined();
    const rows = [
      { entity: "1", lap_number: 1, lap_time_s: 90, speed_trap_kph: 300 },
      { entity: "1", lap_number: 2, lap_time_s: 110 },
      { entity: "1", lap_number: 3, lap_time_s: 120, is_pit_out_lap: true },
    ];
    const ls = buildLaps(topic([0, 90, 200], rows), []);
    expect(ls[0].speeds).toEqual({ speed_trap_kph: 300 });
    expect(ls.map((l) => !!l.inLap)).toEqual([false, true, false]);
  });

  it("detects knockout parts from the data, not the series", () => {
    const parts = [seg("A", 0, 100), seg("B", 200, 300), seg("C", 400, 500)];
    const ls: Lap[] = [];
    for (const e of ["1", "2", "3", "4"]) ls.push({ ...laps(e, [50])[0], segment: "A" });
    for (const e of ["1", "2", "3"]) ls.push({ ...laps(e, [50])[0], segment: "B" });
    for (const e of ["1", "2"]) ls.push({ ...laps(e, [50])[0], segment: "C" });
    expect(withAdvance(parts, ls).map((s) => s.advance)).toEqual([3, 2, undefined]);
    // Practice-style parts where everyone runs in each: no cut line.
    const flat = ["A", "B"].flatMap((p) => ["1", "2"].map((e) => ({ ...laps(e, [50])[0], segment: p })));
    expect(withAdvance(parts.slice(0, 2), flat).every((s) => s.advance === undefined)).toBe(true);
  });
});

describe("timing rows", () => {
  it("interval trend is negative when closing on the car ahead", () => {
    // Car 2 laps 1 s quicker than car 1, starting 5 s behind.
    const m = new Map([
      ["1", laps("1", [100, 100, 100])],
      ["2", laps("2", [100, 99, 99], { start: 5 })],
    ]);
    const rows = timingAt({ entities: [{ id: "1" }, { id: "2" }], laps: m, segments: [], gapMode: "race" }, 1000);
    const r2 = rows.find((r) => r.entity === "2")!;
    expect(r2.interval).toBeCloseTo(3, 5);
    expect(r2.intervalTrend).toBeCloseTo(-1, 5);
  });

  it("speed trap: purple for field best, green for own best", () => {
    const a = laps("1", [90, 90]).map((l, i) => ({ ...l, speeds: { speed_trap_kph: [300, 310][i] } }));
    const b = laps("2", [91, 91]).map((l, i) => ({ ...l, speeds: { speed_trap_kph: [305, 302][i] } }));
    const rows = timingAt({ entities: [{ id: "1" }, { id: "2" }], laps: new Map([["1", a], ["2", b]]), segments: [] }, 1000);
    const by = new Map(rows.map((r) => [r.entity, r]));
    expect(by.get("1")!.trap).toEqual({ value: 310, flag: "purple" });
    expect(by.get("2")!.trap).toEqual({ value: 302, flag: null });
  });

  it("status: out lap and retired from the classification", () => {
    const m = new Map([
      ["1", laps("1", [90, 120], { outLaps: [2] })],
      ["2", laps("2", [91, 91])],
    ]);
    const cl = topic([0], [{ entity: "2", position: 2, status: "Retired" }]);
    const rows = timingAt({ entities: [{ id: "1" }, { id: "2" }], laps: m, segments: [], classification: cl }, 100);
    const by = new Map(rows.map((r) => [r.entity, r]));
    expect(by.get("1")!.status).toBe("out");
    expect(by.get("2")!.status).toBe("stopped");
  });

  it("knockout: ranks the current part, then the eliminated by the furthest part reached", () => {
    const parts = withAdvance([seg("A", 0, 1000), seg("B", 1000, 2000)], [
      ...["1", "2", "3"].map((e) => ({ ...laps(e, [90])[0], segment: "A" })),
      ...["1", "2"].map((e) => ({ ...laps(e, [90])[0], segment: "B" })),
    ]);
    const m = new Map([
      ["1", [...inPart(laps("1", [92]), "A"), ...inPart(laps("1", [90], { start: 1100 }), "B")]],
      ["2", [...inPart(laps("2", [91]), "A"), ...inPart(laps("2", [89], { start: 1100 }), "B")]],
      ["3", inPart(laps("3", [93]), "A")],
    ]);
    const ents = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const rows = timingAt({ entities: ents, laps: m, segments: parts, scope: "auto" }, 1500);
    expect(rows.map((r) => r.entity)).toEqual(["2", "1", "3"]);
    expect(rows[2].best).toBeNull();
    expect(rows[2].prior).toEqual({ segment: "A", time: 93 });
    // Session scope ignores parts.
    const all = timingAt({ entities: ents, laps: m, segments: parts, scope: "session" }, 1500);
    expect(all.find((r) => r.entity === "3")!.prior ?? null).toBeNull();
  });
});

describe("lap history grid", () => {
  const a = laps("1", [95, 90, 91], { outLaps: [1] }).map((l, i) => ({ ...l, speeds: { speed_trap_kph: [280, 300, 305][i] } }));
  const b = laps("2", [96, 92, 89.5]).map((l, i) => ({ ...l, speeds: { speed_trap_kph: [290, 298, 299][i] } }));
  b[1].deleted = true;
  const m = new Map([["1", a], ["2", b]]);

  it("fills field best purple and personal best green, skipping out and deleted laps", () => {
    const g = lapGrid(m, ["1", "2"], { kind: "lap" });
    expect(g.laps).toBe(3);
    expect(g.field).toBe(89.5);
    expect(g.cells.get("2")!.get(3)!.flag).toBe("purple");
    expect(g.cells.get("1")!.get(2)!.flag).toBe("green");
    expect(g.cells.get("1")!.get(1)!.kind).toBe("out");
    expect(g.cells.get("1")!.get(1)!.flag).toBeNull();
    expect(g.cells.get("2")!.get(2)!.kind).toBe("deleted");
  });

  it("speeds: higher is better; only laps finished by t", () => {
    const g = lapGrid(m, ["1", "2"], { kind: "speed", key: "speed_trap_kph" });
    expect(g.field).toBe(305);
    expect(g.cells.get("2")!.get(3)!.flag).toBe("green");
    expect(lapGrid(m, ["1", "2"], { kind: "lap" }, 100).laps).toBe(1);
  });

  it("offers lap, each sector and each speed field", () => {
    expect(gridMetrics([...a, ...b]).map((x) => x.value)).toEqual(["lap", "s1", "s2", "s3", "speed_trap_kph"]);
  });
});

describe("lap distribution", () => {
  it("keeps clean laps within the cutoff of the car's own best", () => {
    const ls = laps("1", [120, 90, 91, 130, 92], { outLaps: [1] });
    ls[4].deleted = true;
    expect(representativeLaps(ls).map((l) => l.n)).toEqual([2, 3]);
    expect(representativeLaps(ls, 0).map((l) => l.n)).toEqual([2, 3, 4]);
  });

  it("nice ticks", () => {
    expect(niceTicks(89.7, 92.4, 5)).toEqual([90, 91, 92]);
    expect(niceTicks(90.1, 91.4, 5)).toEqual([90.5, 91]);
  });
});

describe("pedal use", () => {
  it("splits lap time into full, partial, coast and brake", () => {
    // 10 samples a second apart: 4 s flat, 2 s partial, 1 s coast, 2 s braking (0/1 brake), one overlap.
    const tau = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const thr = [100, 100, 100, 100, 50, 50, 0, 20, 0, 100];
    const brk = [0, 0, 0, 0, 0, 0, 0, 1, 1, 0];
    const gear = [7, 7, 8, 8, 8, 7, 6, 5, 4, 4];
    const s = pedalShare(tau, thr, brk, gear)!;
    expect(s.time).toBe(9);
    expect(s.full).toBeCloseTo(4 / 9);
    expect(s.partial).toBeCloseTo(2 / 9);
    expect(s.coast).toBeCloseTo(1 / 9);
    expect(s.brake).toBeCloseTo(2 / 9);
    expect(s.brakes).toBe(1);
    expect(s.overlap).toBe(1);
    expect(s.shifts).toBe(5);
  });

  it("needs at least two samples", () => {
    expect(pedalShare([0], [100], undefined)).toBeNull();
  });
});

describe("race control and session info helpers", () => {
  it("formats categories, flags and clocks", () => {
    expect(categoryLabel("SafetyCar")).toBe("Safety car");
    expect(categoryLabel("Drs")).toBe("DRS");
    expect(flagText("DOUBLE YELLOW")).toBe("Dbl yellow");
    expect(shortClock("Session 44:20.9", 1)).toBe("44:20");
    expect(shortClock("Q2 03:14.9", 3)).toBe("Q2 03:14");
  });

  it("puts shouted race control messages in sentence case, keeping codes", () => {
    expect(sentenceCase("CAR 44 (HAM) TIME 1:32.411 DELETED - TRACK LIMITS AT TURN 7 LAP 3 18:02:11")).toBe(
      "Car 44 (HAM) time 1:32.411 deleted - track limits at turn 7 lap 3 18:02:11",
    );
    expect(sentenceCase("DRS ENABLED")).toBe("DRS enabled");
    expect(sentenceCase("FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 1 (VER)")).toBe("FIA stewards: 5 second time penalty for car 1 (VER)");
    expect(sentenceCase("Already mixed Case")).toBe("Already mixed Case");
  });

  it("maps any flag to a colour block and picks readable text", () => {
    const flags = { GREEN: "#24a148", YELLOW: "#f1c21b", RED: "#da1e28" };
    expect(flagColour("SC DEPLOYED", flags, "#888")).toBe("#f1c21b");
    expect(flagColour("Red", flags, "#888")).toBe("#da1e28");
    expect(flagColour("CLEAR", flags, "#888")).toBe("#24a148");
    expect(flagColour("CHEQUERED", flags, "#888")).toBe("#888");
    expect(onColour("#f1c21b")).toBe("#161616");
    expect(onColour("#0f62fe")).toBe("#ffffff");
  });
});

describe("presets", () => {
  it("default tabs include Laps, and every preset uses registered widgets", () => {
    expect(DEFAULT_TABS).toEqual(["timing", "telemetry", "strategy", "laps"]);
    const known = new Set(PANELS.map((d) => d.type));
    for (const p of Object.values(PRESETS)) for (const panel of Object.values(p.build().panels)) expect(known.has(panel.type)).toBe(true);
    expect(Object.values(PRESETS.laps.build().panels).map((x) => x.type)).toEqual(["lap-grid", "lap-distribution", "sectors"]);
    expect(Object.values(PRESETS.telemetry.build().panels).map((x) => x.type)).toContain("pedal");
  });
});
