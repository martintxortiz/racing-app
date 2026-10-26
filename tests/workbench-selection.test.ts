import { describe, expect, it } from "vitest";

import { moveColumn, nextSort, placeColumn, sortBy, toggleColumn } from "../lib/workbench/columns";
import * as S from "../lib/workbench/selection";

describe("selection", () => {
  it("click focuses and replaces the focused driver; shift-click adds", () => {
    let s = S.focus(S.emptySelection(), "1");
    s = S.toggleCompare(s, "16");
    expect(s.compare).toEqual(["1", "16"]);
    expect(s.focus).toBe("1");
    s = S.focus(s, "44");
    expect(s.compare).toEqual(["44", "16"]);
    expect(s.focus).toBe("44");
    s = S.focus(s, "16");
    expect(s.compare).toEqual(["44", "16"]);
    expect(s.focus).toBe("16");
  });

  it("removing the focus moves it; removing the reference clears it", () => {
    let s = S.setReference(S.addCompare(S.focus(S.emptySelection(), "1"), "16"), "16");
    expect(S.referenceOf(s)).toBe("16");
    s = S.removeCompare(s, "16");
    expect(s.reference).toBeNull();
    expect(S.referenceOf(s)).toBe("1");
    s = S.removeCompare(s, "1");
    expect(s.focus).toBeNull();
  });

  it("caps the comparison and keeps the newest", () => {
    let s = S.emptySelection();
    for (let i = 0; i < S.MAX_COMPARE + 3; i++) s = S.addCompare(s, String(i));
    expect(s.compare).toHaveLength(S.MAX_COMPARE);
    expect(s.compare.at(-1)).toBe(String(S.MAX_COMPARE + 2));
    expect(s.compare).toContain(s.focus);
  });

  it("cycles focus, isolates and hides", () => {
    let s = S.addCompare(S.addCompare(S.focus(S.emptySelection(), "a"), "b"), "c");
    expect(S.cycleFocus(s).focus).toBe("b");
    expect(S.cycleFocus(s, -1).focus).toBe("c");
    s = S.isolate(s, "b");
    expect(s.compare).toEqual(["b"]);
    s = S.toggleHidden(s, "z");
    expect(s.hidden).toEqual(["z"]);
    expect(S.toggleHidden(s, "z").hidden).toEqual([]);
  });

  it("lap picks default to best", () => {
    let s = S.setLap(S.emptySelection(), "1", { n: 7 });
    expect(S.lapOf(s, "1")).toEqual({ n: 7 });
    s = S.setLap(s, "1", "best");
    expect(s.laps).toEqual({});
    expect(S.lapOf(s, "2")).toBe("best");
  });

  it("panel entities follow selection, field or a pinned list", () => {
    const s = { ...S.isolate(S.emptySelection(), "2"), hidden: ["3"] };
    const field = ["1", "2", "3"];
    expect(S.panelEntities({}, s, field)).toEqual(["2"]);
    expect(S.panelEntities({ drivers: "field" }, s, field)).toEqual(["1", "2"]);
    expect(S.panelEntities({ drivers: ["3", "9"] }, s, field)).toEqual(["3"]);
    expect(S.panelEntities({}, s, field, "field")).toEqual(["1", "2"]);
  });

  it("round-trips the URL and reads legacy a/b", () => {
    const s = S.setReference(S.addCompare(S.focus(S.emptySelection(), "1"), "16"), "16");
    const q = S.toQuery(s);
    expect(q).toEqual({ sel: "1,16", focus: null, ref: "16" });
    const back = S.fromQuery({ sel: q.sel!, ref: q.ref! })!;
    expect(back.compare).toEqual(["1", "16"]);
    expect(back.reference).toBe("16");
    expect(S.fromQuery({ a: "4", b: "81" })!.compare).toEqual(["4", "81"]);
    expect(S.fromQuery({})).toBeNull();
  });

  it("sanitizes against the session's entities", () => {
    const s = S.setReference(S.addCompare(S.focus(S.emptySelection(), "1"), "99"), "99");
    const c = S.sanitize({ ...s, laps: { "99": "last" } }, new Set(["1", "2"]));
    expect(c.compare).toEqual(["1"]);
    expect(c.reference).toBeNull();
    expect(c.laps).toEqual({});
  });
});

describe("columns", () => {
  const all = ["pos", "driver", "tyre", "best", "gap"];
  it("toggles in canonical order and keeps one column", () => {
    expect(toggleColumn(["pos", "best"], "driver", all)).toEqual(["pos", "driver", "best"]);
    expect(toggleColumn(["pos", "driver"], "driver", all)).toEqual(["pos"]);
    expect(toggleColumn(["pos"], "pos", all)).toEqual(["pos"]);
  });
  it("moves and places columns", () => {
    expect(moveColumn(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveColumn(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(placeColumn(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(placeColumn(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
  });
  it("cycles sort and sorts nulls last", () => {
    expect(nextSort(null, "best")).toEqual({ key: "best", dir: "asc" });
    expect(nextSort({ key: "best", dir: "asc" }, "best")).toEqual({ key: "best", dir: "desc" });
    expect(nextSort({ key: "best", dir: "desc" }, "best")).toBeNull();
    const rows = [{ v: 2 }, { v: null }, { v: 1 }];
    expect(sortBy(rows, (r) => r.v, "asc").map((r) => r.v)).toEqual([1, 2, null]);
    expect(sortBy(rows, (r) => r.v, "desc").map((r) => r.v)).toEqual([2, 1, null]);
  });
});
