"use client";

import { useMemo, useState } from "react";

import { sectorSummary, type SectorSummary } from "@/lib/workbench/analysis";
import { fmtLap, fmtSector, fmtSigned } from "@/lib/workbench/format";
import { slotOf } from "@/lib/workbench/selection";
import { cfg, entityMenuItems, openPanelMenu, patch, radio } from "../menus";
import { focusEntity, toggleCompare, useWB, type MenuItem } from "../state";
import { Chip, Empty, Readout, Skeleton, useThrottledT, useWidth, usePanelEntities, useTopicState, type PanelDef, type PanelProps } from "./common";

type SortKey = "ideal" | "best" | "gain";

export function sortSummary(rows: SectorSummary[], key: SortKey): SectorSummary[] {
  const v = (r: SectorSummary) => (key === "ideal" ? r.ideal : key === "gain" ? r.gain : (r.best?.time ?? null));
  return [...rows].sort((a, b) => (v(a) ?? Infinity) - (v(b) ?? Infinity));
}

function Sectors({ id, panel }: PanelProps) {
  const derived = useWB((s) => s.derived);
  const sel = useWB((s) => s.sel);
  const shown = usePanelEntities(panel.config, "field");
  const t = useThrottledT(1);
  const state = useTopicState(panel.bindings.laps ?? "/timing/laps");
  const sort = (panel.config.sort as SortKey) ?? "ideal";
  const relative = panel.config.values === "delta";
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const width = useWidth(host);

  const sum = useMemo(() => (derived ? sectorSummary(derived.lapsByEntity, shown, t) : null), [derived, shown, t]);
  if (state === "loading" && !derived?.laps.length) return <Skeleton rows={6} />;
  if (!sum || !sum.n) return <Empty title="No sector times">The laps topic has no sector_n_s fields.</Empty>;

  const rows = sortSummary(sum.rows, sort);
  const fieldIdeal = sum.field.every((v) => v !== null) ? sum.field.reduce<number>((a, v) => a + v!, 0) : null;
  const cell = (v: number | null, best: number | null) => {
    if (v === null) return <span className="pw-faint">—</span>;
    if (relative && best !== null && v !== best) return fmtSigned(v - best);
    return fmtSector(v);
  };
  const isBest = (v: number | null, best: number | null) => v !== null && best !== null && v === best;

  // Narrow panel: drop Best, then Ideal (the sectors and the time left stay).
  const fixed = 70 + sum.n * 60 + 72;
  const showIdeal = !width || width >= fixed + 74;
  const showBest = !width || width >= fixed + 148;
  return (
    <>
      <Readout>
        <span>Ideal {fmtLap(fieldIdeal)}</span>
      </Readout>
      <div className="wb-scroll" ref={setHost}>
      <table className="wb-t wb-sectors">
        <colgroup>
          <col style={{ width: 70 }} />
          {Array.from({ length: sum.n }, (_, i) => (
            <col key={i} style={{ width: 60 }} />
          ))}
          {showIdeal ? <col style={{ width: 74 }} /> : null}
          {showBest ? <col style={{ width: 74 }} /> : null}
          <col style={{ width: 72 }} />
        </colgroup>
        <thead>
          <tr>
            <th>Driver</th>
            {Array.from({ length: sum.n }, (_, i) => (
              <th key={i} className="is-num">
                S{i + 1}
              </th>
            ))}
            {showIdeal ? <th className="is-num">Ideal</th> : null}
            {showBest ? <th className="is-num">Best</th> : null}
            <th className="is-num" title="Best lap minus the ideal lap">To ideal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const e = derived?.entityById.get(r.entity);
            const slot = slotOf(sel, r.entity);
            return (
              <tr
                key={r.entity}
                className={[slot >= 0 && "is-selected", r.entity === sel.focus && "is-focus"].filter(Boolean).join(" ")}
                onClick={(ev) => (ev.shiftKey || ev.metaKey || ev.ctrlKey ? toggleCompare(r.entity) : focusEntity(r.entity))}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  openPanelMenu(id, ev.clientX, ev.clientY, () => entityMenuItems(r.entity, { lapNumber: r.best?.n }));
                }}
              >
                <td className="wb-team-cell">
                  <Chip code={e?.code ?? r.entity} colour={e?.colour} title={e?.name} />
                </td>
                {r.sectors.map((v, i) => (
                  <td key={i} className={`is-num${isBest(v, sum.field[i]) ? " wb-fill--purple" : ""}`}>
                    {cell(v, sum.field[i])}
                  </td>
                ))}
                {showIdeal ? <td className="is-num">{relative && fieldIdeal !== null && r.ideal !== null ? fmtSigned(r.ideal - fieldIdeal) : fmtLap(r.ideal)}</td> : null}
                {showBest ? <td className="is-num">{fmtLap(r.best?.time)}</td> : null}
                <td className={`is-num${r.gain !== null && r.gain > 0.05 ? "" : " is-dim"}`} title="Best lap minus ideal lap: time left in the sectors">
                  {r.gain === null ? "—" : r.gain < 0.0005 ? "—" : fmtSigned(r.gain)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}

function sectorMenu(id: string): MenuItem[] {
  return [
    radio("Sort by", [{ value: "ideal", label: "Ideal lap" }, { value: "best", label: "Best lap" }, { value: "gain", label: "Potential gain" }], cfg<string>(id, "sort", "ideal"), (v) => patch(id, { sort: v })),
    radio("Values", [{ value: "time", label: "Times" }, { value: "delta", label: "Delta to fastest" }], cfg<string>(id, "values", "time"), (v) => patch(id, { values: v })),
  ];
}

export const sectors: PanelDef = {
  type: "sectors",
  title: "Sectors",
  description: "Best sector times, ideal lap and the time left on the table, for any number of sectors.",
  icon: "data-table",
  primary: "laps",
  entities: "field",
  needs: ["/timing/laps"],
  slots: { laps: { schemas: ["rtc.laps"], required: true, default: "/timing/laps" } },
  defaultConfig: { drivers: "field", sort: "ideal", values: "time" },
  menu: ({ id }) => sectorMenu(id),
  Component: Sectors,
};
