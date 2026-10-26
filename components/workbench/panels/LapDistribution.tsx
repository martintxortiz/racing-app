"use client";

import { useMemo } from "react";

import { lapQuartiles, orderAt, representativeLaps } from "@/lib/workbench/analysis";
import { fmtLap, fmtSigned } from "@/lib/workbench/format";
import { slotOf } from "@/lib/workbench/selection";
import { usePalette } from "../colors";
import { cfg, entityMenuItems, openPanelMenu, patch, radio } from "../menus";
import { focusEntity, toggleCompare, useWB, type MenuItem } from "../state";
import { Chip, Empty, Readout, Skeleton, useThrottledT, usePanelEntities, useTopicState, type PanelDef, type PanelProps } from "./common";

const LAPS = "/timing/laps";

/** Box plot of each car's representative laps: where the pace sits and how consistent it is. */
function LapDistribution({ id, panel }: PanelProps) {
  const p = usePalette();
  const derived = useWB((s) => s.derived);
  const sel = useWB((s) => s.sel);
  const store = useWB((s) => s.store);
  const session = useWB((s) => s.session);
  const shown = usePanelEntities(panel.config, "field");
  const t = useThrottledT(1);
  const state = useTopicState(panel.bindings.laps ?? LAPS);
  const cutoff = Number(panel.config.cutoff ?? 1.07);
  const sort = String(panel.config.sort ?? "median");

  const rows = useMemo(() => {
    if (!derived) return [];
    const base = orderAt(derived.lapsByEntity, shown, store.get("/timing/classification"), t, session?.kind === "race" ? "race" : "best");
    const out = base
      .map((e) => ({ e, q: lapQuartiles(representativeLaps(derived.lapsByEntity.get(e) ?? [], cutoff, t)) }))
      .filter((r) => r.q && r.q.n >= 1);
    if (sort === "median") out.sort((a, b) => a.q!.median - b.q!.median);
    else if (sort === "spread") out.sort((a, b) => a.q!.q3 - a.q!.q1 - (b.q!.q3 - b.q!.q1));
    return out as { e: string; q: NonNullable<ReturnType<typeof lapQuartiles>> }[];
  }, [derived, shown, store, t, session?.kind, cutoff, sort]);

  if (state === "loading" && !derived?.laps.length) return <Skeleton rows={8} />;
  if (!rows.length) return <Empty title="No timed laps yet" />;

  // Shared axis over the whiskers, padded a little.
  const lo = Math.min(...rows.map((r) => r.q.min));
  const hi = Math.max(...rows.map((r) => r.q.max));
  const pad = Math.max(0.05, (hi - lo) * 0.04);
  const x0 = lo - pad;
  const x1 = hi + pad;
  const pct = (v: number) => `${((v - x0) / (x1 - x0)) * 100}%`;
  const best = Math.min(...rows.map((r) => r.q.median));
  const ticks = niceTicks(x0, x1, 5).filter((v) => (v - x0) / (x1 - x0) > 0.06 && (v - x0) / (x1 - x0) < 0.94);

  return (
    <>
      <Readout>
        <span>{cutoff > 0 ? `Laps within ${Math.round((cutoff - 1) * 100)}% of own best` : "All clean laps"} · out and in laps excluded</span>
      </Readout>
      <div className="wb-scroll">
        <table className="wb-t wb-box">
          <colgroup>
            <col style={{ width: 66 }} />
            <col />
            <col style={{ width: 72 }} />
            <col style={{ width: 60 }} />
            <col style={{ width: 48 }} />
            <col style={{ width: 40 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Driver</th>
              <th className="wb-box__axis">
                {ticks.map((v) => (
                  <span key={v} style={{ left: pct(v) }}>
                    {fmtLap(v).replace(/\.\d+$/, "")}
                  </span>
                ))}
              </th>
              <th className="is-num">Median</th>
              <th className="is-num">Δ</th>
              <th className="is-num" title="Interquartile range, seconds">IQR</th>
              <th className="is-num">n</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, q }) => {
              const ent = derived?.entityById.get(e);
              const slot = slotOf(sel, e);
              // Compared cars in their series colour, the rest neutral: the boxes, not the colours, carry the story.
              const c = slot >= 0 ? p.series[slot % p.series.length] : p.text3;
              return (
                <tr
                  key={e}
                  className={[slot >= 0 && "is-selected", e === sel.focus && "is-focus"].filter(Boolean).join(" ") || undefined}
                  onClick={(ev) => (ev.shiftKey || ev.metaKey || ev.ctrlKey ? toggleCompare(e) : focusEntity(e))}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    openPanelMenu(id, ev.clientX, ev.clientY, () => entityMenuItems(e));
                  }}
                >
                  <td className="wb-team-cell">
                    <Chip code={ent?.code ?? e} colour={ent?.colour} title={ent?.name} />
                  </td>
                  <td className="wb-box__plot" title={`min ${fmtLap(q.min)} · Q1 ${fmtLap(q.q1)} · median ${fmtLap(q.median)} · Q3 ${fmtLap(q.q3)} · max ${fmtLap(q.max)}`}>
                    {ticks.map((v) => (
                      <i key={v} className="wb-box__grid" style={{ left: pct(v) }} />
                    ))}
                    <i className="wb-box__whisker" style={{ left: pct(q.min), width: `calc(${pct(q.max)} - ${pct(q.min)})` }} />
                    <i className="wb-box__iqr" style={{ left: pct(q.q1), width: `calc(${pct(q.q3)} - ${pct(q.q1)})`, ["--c" as string]: c }} />
                    <i className="wb-box__median" style={{ left: pct(q.median) }} />
                  </td>
                  <td className={`is-num${q.median === best ? " wb-fill--purple" : ""}`}>{fmtLap(q.median)}</td>
                  <td className="is-num pw-faint">{q.median === best ? "" : fmtSigned(q.median - best)}</td>
                  <td className="is-num">{(q.q3 - q.q1).toFixed(2)}</td>
                  <td className="is-num pw-faint">{q.n}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** About n round tick values between a and b. */
export function niceTicks(a: number, b: number, n: number): number[] {
  const span = b - a;
  if (!(span > 0)) return [a];
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

function distMenu(id: string): MenuItem[] {
  return [
    radio(
      "Laps",
      [
        { value: 1.07, label: "Within 7% of own best" },
        { value: 1.03, label: "Within 3% of own best" },
        { value: 0, label: "All clean laps" },
      ],
      cfg<number>(id, "cutoff", 1.07),
      (v) => patch(id, { cutoff: v }),
    ),
    radio(
      "Sort by",
      [
        { value: "median", label: "Median pace" },
        { value: "spread", label: "Consistency (IQR)" },
        { value: "position", label: "Position" },
      ],
      cfg<string>(id, "sort", "median"),
      (v) => patch(id, { sort: v }),
    ),
  ];
}

export const lapDistribution: PanelDef = {
  type: "lap-distribution",
  title: "Lap distribution",
  description: "Box plot of each car's representative lap times: median pace, spread and outliers removed.",
  icon: "analytics",
  primary: "laps",
  entities: "field",
  needs: [LAPS],
  slots: { laps: { schemas: ["rtc.laps"], required: true, default: LAPS } },
  defaultConfig: { drivers: "field", cutoff: 1.07, sort: "median" },
  menu: ({ id }) => distMenu(id),
  Component: LapDistribution,
};
