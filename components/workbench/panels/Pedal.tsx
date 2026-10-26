"use client";

import { useMemo } from "react";

import { pedalShare, type PedalShare } from "@/lib/workbench/analysis";
import { lapTrace, resolveLap } from "@/lib/workbench/derive";
import { fmtLap } from "@/lib/workbench/format";
import { topicFor } from "@/lib/workbench/layout";
import { lapOf, slotOf } from "@/lib/workbench/selection";
import type { EntityId, Lap } from "@/lib/workbench/types";
import { cfg, check, entityMenuItems, lapItems, openPanelMenu, patch } from "../menus";
import { focusEntity, toggleCompare, useWB, type MenuItem } from "../state";
import { Chip, Empty, Readout, Skeleton, useThrottledT, usePanelEntities, type PanelDef, type PanelProps } from "./common";

const TEL = "/vehicle/*/telemetry";
const PARTS = [
  { key: "full", label: "Full", title: "Full throttle" },
  { key: "partial", label: "Part", title: "Partial throttle" },
  { key: "coast", label: "Coast", title: "Neither pedal" },
  { key: "brake", label: "Brake", title: "On the brake" },
] as const;

/** Pedal use over each compared car's chosen lap: how much is flat out, partial, coasting or braking. */
function Pedal({ id, panel }: PanelProps) {
  const derived = useWB((s) => s.derived);
  const store = useWB((s) => s.store);
  const version = useWB((s) => s.version);
  const status = useWB((s) => s.status);
  const sel = useWB((s) => s.sel);
  const entities = usePanelEntities(panel.config, "selection");
  const pattern = panel.bindings.telemetry ?? TEL;
  const t = useThrottledT(entities.some((e) => lapOf(sel, e) === "cursor") ? 4 : 0.0001);
  const fullAt = Number(panel.config.fullAt ?? 98);
  const showCounts = panel.config.counts !== false;

  const rows = useMemo(() => {
    const out: { e: EntityId; lap: Lap; s: PedalShare }[] = [];
    if (!derived) return out;
    for (const e of entities) {
      const lap = resolveLap(derived.lapsByEntity.get(e), lapOf(sel, e), t);
      const tel = store.get(topicFor(pattern, TEL, e));
      if (!lap || !tel) continue;
      const tr = lapTrace(tel, lap, derived.lapLength ?? null);
      const th = tr?.channels.throttle_pct ?? tr?.channels.throttle;
      if (!tr || !th) continue;
      const s = pedalShare(tr.tau, th, tr.channels.brake_pct ?? tr.channels.brake, tr.channels.gear, fullAt);
      if (s) out.push({ e, lap, s });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived, store, version, entities, sel, t, pattern, fullAt]);

  if (status === "loading" && !rows.length) return <Skeleton rows={4} />;
  if (!entities.length) return <Empty title="No cars to compare">Shift-click cars in any table to compare them.</Empty>;
  if (!rows.length) return <Empty title="No pedal data">The telemetry has no throttle channel for these laps.</Empty>;
  const ref = rows[0].s;

  return (
    <>
      <Readout>
        <span>Share of lap time · full ≥ {fullAt}%</span>
      </Readout>
      <div className="wb-scroll">
        <table className="wb-t wb-pedal">
          <colgroup>
            <col style={{ width: 66 }} />
            <col style={{ width: 44 }} />
            <col />
            {PARTS.map((x) => (
              <col key={x.key} style={{ width: 50 }} />
            ))}
            {showCounts ? (
              <>
                <col style={{ width: 60 }} />
                <col style={{ width: 60 }} />
              </>
            ) : null}
          </colgroup>
          <thead>
            <tr>
              <th>Driver</th>
              <th className="is-num">Lap</th>
              <th>
                <span className="wb-pedal__legend">
                  {PARTS.map((x) => (
                    <span key={x.key}>
                      <i className={`wb-pedal__sw is-${x.key}`} />
                      {x.title}
                    </span>
                  ))}
                </span>
              </th>
              {PARTS.map((x) => (
                <th key={x.key} className="is-num" title={x.title}>
                  {x.label}
                </th>
              ))}
              {showCounts ? (
                <>
                  <th className="is-num" title="Separate brake applications">Stops</th>
                  <th className="is-num" title="Seconds with throttle and brake together">Overlap</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, lap, s }, k) => {
              const ent = derived?.entityById.get(e);
              return (
                <tr
                  key={e}
                  className={[slotOf(sel, e) >= 0 && "is-selected", e === sel.focus && "is-focus"].filter(Boolean).join(" ") || undefined}
                  onClick={(ev) => (ev.shiftKey || ev.metaKey || ev.ctrlKey ? toggleCompare(e) : focusEntity(e))}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    openPanelMenu(id, ev.clientX, ev.clientY, () => [{ label: "Lap", submenu: () => lapItems(e) }, { separator: true }, ...entityMenuItems(e, { lapNumber: lap.n })]);
                  }}
                >
                  <td className="wb-team-cell">
                    <Chip code={ent?.code ?? e} colour={ent?.colour} title={ent?.name} />
                  </td>
                  <td className="is-num" title={fmtLap(lap.time)}>
                    {lap.n}
                  </td>
                  <td className="wb-pedal__bar">
                    <div>
                      {PARTS.map((x) => (
                        <i key={x.key} className={`is-${x.key}`} style={{ width: `${s[x.key] * 100}%` }} title={`${x.title} ${(s[x.key] * 100).toFixed(1)}%`} />
                      ))}
                    </div>
                  </td>
                  {PARTS.map((x) => {
                    const d = (s[x.key] - ref[x.key]) * 100;
                    return (
                      <td key={x.key} className="is-num" title={k > 0 ? `${d >= 0 ? "+" : ""}${d.toFixed(1)} pts vs ${derived?.entityById.get(rows[0].e)?.code ?? rows[0].e}` : undefined}>
                        {(s[x.key] * 100).toFixed(1)}
                      </td>
                    );
                  })}
                  {showCounts ? (
                    <>
                      <td className="is-num">{s.brakes}</td>
                      <td className="is-num">{s.overlap.toFixed(1)}</td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function pedalMenu(id: string): MenuItem[] {
  return [
    {
      label: "Full throttle from",
      submenu: () =>
        [95, 98, 99].map((v) => ({ label: `${v}%`, radio: true, checked: cfg<number>(id, "fullAt", 98) === v, onSelect: () => patch(id, { fullAt: v }) })),
    },
    check("Brake stops and overlap", cfg<boolean>(id, "counts", true), (v) => patch(id, { counts: v })),
  ];
}

export const pedal: PanelDef = {
  type: "pedal",
  title: "Pedal use",
  description: "Share of the lap at full throttle, part throttle, coasting and braking, with brake stops, for the compared cars' laps.",
  icon: "meter",
  primary: "telemetry",
  entities: "selection",
  needs: [TEL],
  slots: {
    telemetry: { schemas: ["rtc.telemetry"], required: true, default: TEL, pattern: true },
    laps: { schemas: ["rtc.laps"], required: false, default: "/timing/laps" },
  },
  defaultConfig: { drivers: "selection", fullAt: 98, counts: true },
  menu: ({ id }) => pedalMenu(id),
  Component: Pedal,
};
