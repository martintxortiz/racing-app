import { describe, expect, it } from "vitest";

import { fieldMeta, lapQuartiles, lapSeries, orderAt, sectorSummary, stintsOf, trackStatusAt } from "../lib/workbench/analysis";
import { classesOf, sectorCount, timingAt } from "../lib/workbench/derive";
import { laps, topic } from "./workbench-fixtures";

describe("generic timing", () => {
  // Multi-class endurance: two hypercars, two GT3s, four sectors, a driver swap.
  const lapMap = new Map([
    ["7", laps("7", [100, 99, 98], { sectors: 4 })],
    ["8", laps("8", [101, 99.5, 98.5], { sectors: 4 })],
    ["92", laps("92", [110, 109, 108], { sectors: 4, drivers: ["A", "A", "B"] })],
    ["93", laps("93", [111, 110], { sectors: 4 })],
  ]);
  const entities = [
    { id: "7", class: "HYPERCAR" },
    { id: "8", class: "HYPERCAR" },
    { id: "92", class: "GT3" },
    { id: "93", class: "GT3" },
  ];

  it("counts sectors and classes from the data", () => {
    expect(sectorCount(lapMap.values())).toBe(4);
    expect(classesOf(entities)).toEqual(["HYPERCAR", "GT3"]);
    expect(classesOf([{ class: "F1" }, { class: "F1" }])).toEqual([]);
  });

  it("race mode: laps-down and gaps to the class leader", () => {
    const rows = timingAt({ entities, laps: lapMap, segments: [], gapMode: "race" }, 1000);
    expect(rows.map((r) => r.entity)).toEqual(["7", "8", "92", "93"]);
    const by = new Map(rows.map((r) => [r.entity, r]));
    expect(by.get("8")!.gap).toBeCloseTo(2, 5);
    expect(by.get("92")!.rank).toBe(1); // class leader
    expect(by.get("92")!.gap === null || by.get("92")!.gap === 0).toBe(true);
    expect(by.get("93")!.lapsDown).toBe(1);
    expect(by.get("92")!.sectors).toHaveLength(4);
    expect(by.get("92")!.driver).toBe("B");
  });

  it("best-lap mode ranks by fastest lap and measures to the overall leader on request", () => {
    const rows = timingAt({ entities, laps: lapMap, segments: [], gapMode: "best", gapTo: "leader" }, 1000);
    expect(rows[0].entity).toBe("7");
    expect(rows.find((r) => r.entity === "92")!.gap).toBeCloseTo(10, 5);
    expect(rows[0].bestFlag).toBe("purple");
  });

  it("only uses laps finished by t", () => {
    const rows = timingAt({ entities, laps: lapMap, segments: [], gapMode: "best" }, 105);
    expect(rows.find((r) => r.entity === "7")!.best?.time).toBe(100);
    expect(rows.find((r) => r.entity === "93")!.best).toBeNull();
  });
});

describe("analyses", () => {
  const lapMap = new Map([
    ["1", laps("1", [90, 91, 92])],
    ["2", laps("2", [91, 91, 91])],
  ]);

  it("lap series: gap, interval, position, pace and delta", () => {
    const gap = lapSeries(lapMap, "gap");
    expect(gap.get("2")!.map(([, v]) => v)).toEqual([1, 1, 0]);
    expect(lapSeries(lapMap, "interval").get("1")![0]).toEqual([1, 0]);
    expect(lapSeries(lapMap, "position").get("2")!.map(([, v]) => v)).toEqual([2, 2, 1]);
    expect(lapSeries(lapMap, "pace").get("1")!.map(([, v]) => v)).toEqual([90, 91, 92]);
    expect(lapSeries(lapMap, "delta", { ref: "2" }).get("1")!.map(([, v]) => v)).toEqual([-1, 0, 1]);
    expect(lapSeries(lapMap, "pace", { t: 100 }).get("1")).toHaveLength(1);
  });

  it("running order: classification first, then race or best-lap order", () => {
    const race = new Map([
      ["1", laps("1", [91, 92, 92])], // finishes lap 3 at 275
      ["2", laps("2", [91, 90, 90])], // finishes lap 3 at 271
    ]);
    expect(orderAt(race, ["1", "2"], undefined, 1000)).toEqual(["2", "1"]);
    expect(orderAt(race, ["1", "2"], undefined, 1000, "best")).toEqual(["2", "1"]);
    expect(orderAt(race, ["1", "2"], undefined, 95)).toEqual(["1", "2"]); // after lap 1
    expect(orderAt(lapMap, ["1", "2"], undefined, 1000, "best")).toEqual(["1", "2"]);
    const cl = topic([10, 20], [{ entity: "2", position: 1 }, { entity: "1", position: 2 }]);
    expect(orderAt(lapMap, ["1", "2", "3"], cl, 15)).toEqual(["2", "1", "3"]);
  });

  it("stints from a topic, or inferred from out laps and driver swaps", () => {
    const rows = [
      { entity: "1", stint_number: 1, lap_start: 1, lap_end: 2, compound: "SOFT", tyre_age_at_start_laps: 3 },
      { entity: "1", stint_number: 2, lap_start: 3, lap_end: 3, compound: "HARD" },
    ];
    const st = stintsOf(lapMap, rows).get("1")!;
    expect(st.map((s) => [s.lapStart, s.lapEnd, s.compound])).toEqual([[1, 2, "SOFT"], [3, 3, "HARD"]]);
    const inferred = stintsOf(new Map([["9", laps("9", [100, 100, 130, 100], { outLaps: [3], drivers: ["A", "A", "A", "B"] })]]), undefined).get("9")!;
    expect(inferred.map((s) => [s.lapStart, s.lapEnd, s.driver])).toEqual([[1, 2, "A"], [3, 3, "A"], [4, 4, "B"]]);
  });

  it("sector summary: best sectors, ideal lap and gain", () => {
    const m = new Map([["1", laps("1", [90, 93])]]);
    m.get("1")![1].sectors = [29, 32, 32]; // faster first sector on a slower lap
    const s = sectorSummary(m, ["1"]);
    expect(s.n).toBe(3);
    expect(s.rows[0].sectors).toEqual([29, 30, 30]);
    expect(s.rows[0].ideal).toBe(89);
    expect(s.rows[0].gain).toBeCloseTo(1, 5);
  });

  it("track status from flags and safety-car messages", () => {
    const ev = topic([0, 10, 20, 30, 40], [
      { category: "Flag", flag: "GREEN", message: "GREEN LIGHT" },
      { category: "Flag", flag: "YELLOW", sector: 7, message: "YELLOW IN TRACK SECTOR 7" },
      { category: "SafetyCar", message: "SAFETY CAR DEPLOYED" },
      { category: "Flag", flag: "BLUE", entity: "4", message: "BLUE FLAG" },
      { category: "SafetyCar", message: "SAFETY CAR IN THIS LAP" },
    ]);
    expect(trackStatusAt(ev, 15)).toMatchObject({ flag: "GREEN", sectors: [{ sector: 7, flag: "YELLOW" }] });
    expect(trackStatusAt(ev, 35).flag).toBe("SC");
    expect(trackStatusAt(ev, 45).flag).toBe("GREEN");
    expect(trackStatusAt(undefined, 0).flag).toBeNull();
  });

  it("field names degrade gracefully", () => {
    expect(fieldMeta("speed_kph")).toMatchObject({ label: "Speed", unit: "km/h" });
    expect(fieldMeta("tyre_pressure_fl_kpa").unit).toBe("kPa");
    expect(fieldMeta("mystery").label.length).toBeGreaterThan(0);
  });

  it("lap quartiles", () => {
    const q = lapQuartiles(laps("1", [90, 91, 92, 93, 94]))!;
    expect(q).toMatchObject({ min: 90, median: 92, max: 94, n: 5 });
    expect(lapQuartiles([])).toBeNull();
  });
});
