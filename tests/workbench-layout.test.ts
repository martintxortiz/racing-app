import { describe, expect, it } from "vitest";

import {
  insertAt,
  movePanel,
  panelIds,
  prune,
  removePanel,
  resolveBinding,
  setSplit,
  validateLayout,
  type LayoutNode,
} from "../lib/workbench/layout";
import { defaultLayout } from "../lib/workbench/presets";

const overview: LayoutNode = {
  direction: "row",
  splitPercentage: 40,
  first: "timing",
  second: {
    direction: "column",
    splitPercentage: 60,
    first: { direction: "row", splitPercentage: 60, first: "trace", second: "map" },
    second: { direction: "row", splitPercentage: 50, first: "laps", second: "log" },
  },
};

describe("layout tree", () => {
  it("default layout is valid", () => {
    expect(validateLayout(defaultLayout())).toBeNull();
    expect(panelIds(overview)).toEqual(["timing", "trace", "map", "laps", "log"]);
  });

  it("removing a panel promotes its sibling", () => {
    const n = removePanel(overview, "map");
    expect(panelIds(n)).toEqual(["timing", "trace", "laps", "log"]);
    expect(removePanel("solo", "solo")).toBeNull();
  });

  it("inserts on an edge of the target", () => {
    const n = insertAt(overview, "log", "new", "right");
    expect(panelIds(n)).toEqual(["timing", "trace", "map", "laps", "log", "new"]);
    expect(insertAt(null, null, "first", "right")).toBe("first");
    expect(insertAt("a", "a", "b", "top")).toEqual({ direction: "column", splitPercentage: 50, first: "b", second: "a" });
  });

  it("moves a panel next to another", () => {
    const n = movePanel(overview, "timing", "log", "bottom");
    expect(panelIds(n)).toEqual(["trace", "map", "laps", "log", "timing"]);
    expect(movePanel(overview, "map", "map", "left")).toBe(overview);
  });

  it("clamps split percentages", () => {
    const n = setSplit(overview, ["second"], 120);
    expect((n as { second: { splitPercentage: number } }).second.splitPercentage).toBe(95);
  });

  it("rejects broken layouts and prunes unused panels", () => {
    expect(validateLayout({ version: 2 })).toMatch(/version/);
    const l = defaultLayout();
    l.tabs[0].root = "ghost";
    expect(validateLayout(l)).toMatch(/ghost/);
    const d = defaultLayout();
    const p = prune({ ...d, tabs: [d.tabs[1]] });
    expect(Object.keys(p.panels).sort()).toEqual(panelIds(d.tabs[1].root).sort());
  });

  it("resolves entity patterns and legacy A/B tokens", () => {
    expect(resolveBinding("/vehicle/{id}/telemetry", { entity: "12" })).toBe("/vehicle/12/telemetry");
    expect(resolveBinding("/vehicle/*/telemetry", { entity: "7" })).toBe("/vehicle/7/telemetry");
    expect(resolveBinding("/vehicle/{A}/telemetry", { focus: "12" })).toBe("/vehicle/12/telemetry");
    expect(resolveBinding("/vehicle/{B}/telemetry", { focus: "12", reference: null })).toBeNull();
  });
});
