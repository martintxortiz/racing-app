import { beforeEach, describe, expect, it } from "vitest";

// Load the registry first, as the app does: panels and menus import each other.
import { PANELS } from "../components/workbench/panels/registry";

import { DEFAULT_COLUMNS, columnMenu } from "../components/workbench/panels/TimingTable";
import { resolveMode } from "../components/workbench/panels/GapChart";
import { stintLabel } from "../components/workbench/panels/Stints";
import { sortSummary } from "../components/workbench/panels/Sectors";
import { panelMenuItems } from "../components/workbench/menus";
import { loadLayout, useWB, type MenuAction, type MenuItem } from "../components/workbench/state";
import { canonical } from "../lib/workbench/adapters/canonical";
import { validateLayout } from "../lib/workbench/layout";
import { DEFAULT_TABS, PANEL_TYPES, PRESETS, defaultLayout, presetTab } from "../lib/workbench/presets";

const actions = (items: MenuItem[]) => items.filter((i): i is MenuAction => "label" in i);
const find = (items: MenuItem[], label: string) => actions(items).find((i) => i.label === label)!;
const sub = (a: MenuAction) => (typeof a.submenu === "function" ? a.submenu() : (a.submenu ?? []));
const panelsOfType = (type: string) => Object.entries(useWB.getState().layout.panels).filter(([, p]) => p.type === type);

describe("presets", () => {
  it("default layout is valid with Timing, Telemetry and Strategy tabs", () => {
    const l = defaultLayout();
    expect(validateLayout(l)).toBeNull();
    expect(l.tabs.map((t) => t.name)).toEqual(DEFAULT_TABS.map((k) => PRESETS[k].name));
    expect(new Set(l.tabs.map((t) => t.id)).size).toBe(l.tabs.length);
  });

  it("preset tabs get fresh ids", () => {
    const l = defaultLayout();
    const { tab, panels } = presetTab("timing", l);
    expect(l.tabs.map((t) => t.id)).not.toContain(tab.id);
    for (const id of Object.keys(panels)) expect(l.panels[id]).toBeUndefined();
  });

  it("every preset only uses registered widgets", () => {
    const types = new Set(PANELS.map((d) => d.type));
    expect([...types].sort()).toEqual([...PANEL_TYPES].sort());
    for (const p of Object.values(PRESETS)) for (const panel of Object.values(p.build().panels)) expect(types.has(panel.type)).toBe(true);
  });

  it("no widget defaults to a series-specific driver or session part", () => {
    const json = JSON.stringify(defaultLayout());
    expect(json).not.toMatch(/\b(VER|LEC|Q1|Q2|Q3)\b/);
  });
});

describe("panel context menu", () => {
  beforeEach(() => loadLayout(defaultLayout()));

  it("has config, drivers, data, layout and close sections", () => {
    const [id] = panelsOfType("gap-chart")[0];
    const items = panelMenuItems(id);
    for (const l of ["Show", "Gap to", "Drivers", "Data", "Change widget", "Split", "Duplicate", "Close panel"]) expect(find(items, l), l).toBeTruthy();
  });

  it("writes widget settings into the panel config in the layout", () => {
    const [id] = panelsOfType("gap-chart")[0];
    const mode = find(panelMenuItems(id), "Show");
    actions(sub(mode)).find((o) => o.label === "Interval to car ahead")!.onSelect!();
    expect(useWB.getState().layout.panels[id].config.mode).toBe("interval");
  });

  it("drivers submenu pins the comparison", () => {
    const [id] = panelsOfType("stints")[0];
    useWB.setState({ sel: { ...useWB.getState().sel, compare: ["4", "81"], focus: "4" } });
    actions(sub(find(panelMenuItems(id), "Drivers"))).find((o) => o.label === "Pin current comparison")!.onSelect!();
    expect(useWB.getState().layout.panels[id].config.drivers).toEqual(["4", "81"]);
  });

  it("local items come first and close removes the panel", () => {
    const [id] = panelsOfType("weather")[0];
    const items = panelMenuItems(id, [{ label: "Here" }]);
    expect(actions(items)[0].label).toBe("Here");
    find(items, "Close panel").onSelect!();
    expect(useWB.getState().layout.panels[id]).toBeUndefined();
  });

  it("column header menu sorts, hides and moves columns", () => {
    const [id] = panelsOfType("timing-table")[0];
    const menu = () => columnMenu(id, "best", "best");
    find(menu(), "Sort descending").onSelect!();
    expect(useWB.getState().layout.panels[id].config.sort).toEqual({ key: "best", dir: "desc" });
    const before = ((useWB.getState().layout.panels[id].config.columns as string[] | undefined) ?? DEFAULT_COLUMNS).indexOf("best");
    find(menu(), "Move left").onSelect!();
    const cols = useWB.getState().layout.panels[id].config.columns as string[];
    expect(cols.indexOf("best")).toBe(before - 1);
    find(menu(), "Hide column").onSelect!();
    expect(useWB.getState().layout.panels[id].config.columns).not.toContain("best");
  });
});

describe("widget logic", () => {
  it("gap chart mode follows the session kind", () => {
    expect(resolveMode("auto", "race")).toBe("gap");
    expect(resolveMode("auto", "qualifying")).toBe("pace");
    expect(resolveMode("auto", undefined)).toBe("pace");
    expect(resolveMode("delta", "race")).toBe("delta");
  });

  it("stint labels", () => {
    const s = { entity: "1", n: 2, lapStart: 10, lapEnd: 24, compound: "MEDIUM", driver: "A. Driver", newTyre: true, ageAtStart: 0 };
    expect(stintLabel(s as never, "compound")).toBe("M · 15");
    expect(stintLabel({ ...s, ageAtStart: 3 } as never, "compound")).toBe("M +3 · 15");
    expect(stintLabel(s as never, "laps")).toBe("15");
    expect(stintLabel(s as never, "driver")).toBe("A. Driver");
    expect(stintLabel({ ...s, compound: null } as never, "compound")).toBe("15"); // no tyre data
  });

  it("sector table sorts by ideal, best or gain, nulls last", () => {
    const rows = [
      { entity: "a", sectors: [30, null], ideal: null, best: { time: 60 }, gain: null },
      { entity: "b", sectors: [29, 31], ideal: 60, best: { time: 60.5 }, gain: 0.5 },
    ];
    expect(sortSummary(rows as never, "ideal").map((r) => r.entity)).toEqual(["b", "a"]);
    expect(sortSummary(rows as never, "best").map((r) => r.entity)).toEqual(["a", "b"]);
    expect(sortSummary(rows as never, "gain").map((r) => r.entity)).toEqual(["b", "a"]);
  });

  it("canonical adapter claims rtc recordings, not F1 ones", () => {
    expect(canonical.detect({} as never, ["/session/entities", "/timing/laps"])).toBe(true);
    expect(canonical.detect({} as never, ["/session/entities", "/drivers"])).toBe(false);
  });
});
