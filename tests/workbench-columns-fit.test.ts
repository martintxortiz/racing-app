import { describe, expect, it } from "vitest";

import { fitColumns } from "../lib/workbench/columns";

const cols = [
  { key: "pos", width: 40, priority: 0 },
  { key: "driver", width: 70, priority: 0 },
  { key: "gap", width: 66, priority: 2 },
  { key: "tyre", width: 38, priority: 8 },
  { key: "last", width: 68, priority: 3 },
  { key: "laps", width: 40, priority: 10 },
];

describe("fitColumns", () => {
  it("keeps everything when there is room or the width is unknown", () => {
    expect(fitColumns(cols, 400).hidden).toEqual([]);
    expect(fitColumns(cols, 0).shown).toHaveLength(6);
  });

  it("drops the least important columns first and keeps the configured order", () => {
    const { shown, hidden } = fitColumns(cols, 250);
    expect(hidden.map((c) => c.key)).toEqual(["tyre", "laps"]);
    expect(shown.map((c) => c.key)).toEqual(["pos", "driver", "gap", "last"]);
  });

  it("always keeps the first column", () => {
    expect(fitColumns(cols, 10).shown.map((c) => c.key)).toEqual(["pos"]);
  });
});
