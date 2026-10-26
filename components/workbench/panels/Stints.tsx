"use client";

import { useMemo } from "react";

import { orderAt, stintsOf, type Stint } from "@/lib/workbench/analysis";
import { slotOf } from "@/lib/workbench/selection";
import { usePalette } from "../colors";
import { cfg, entityMenuItems, openPanelMenu, patch, radio } from "../menus";
import { focusEntity, toggleCompare, useWB, type MenuItem } from "../state";
import { Chip, Empty, Readout, Skeleton, useThrottledT, usePanelEntities, useTopicState, type PanelDef, type PanelProps } from "./common";
import { niceTicks } from "./LapDistribution";
import { tyreClass } from "./TimingTable";

/** Label inside a stint bar: compound initial, driver or lap count, whatever fits the config. */
export function stintLabel(s: Stint, by: string): string {
  const laps = s.lapEnd - s.lapStart + 1;
  if (by === "driver") return s.driver ?? `${laps}`;
  if (by === "laps") return `${laps}`;
  return s.compound ? `${s.compound[0]}${s.ageAtStart ? ` +${s.ageAtStart}` : ""} · ${laps}` : `${laps}`;
}

function Stints({ id, panel }: PanelProps) {
  const p = usePalette();
  const derived = useWB((s) => s.derived);
  const session = useWB((s) => s.session);
  const store = useWB((s) => s.store);
  const version = useWB((s) => s.version);
  const sel = useWB((s) => s.sel);
  const shown = usePanelEntities(panel.config, "field");
  const t = useThrottledT(1);
  const state = useTopicState(panel.bindings.laps ?? "/timing/laps");
  const label = String(panel.config.label ?? "compound");
  const sort = String(panel.config.sort ?? "position");

  const { rows, maxLap, inferred } = useMemo(() => {
    if (!derived) return { rows: [] as [string, Stint[]][], maxLap: 1, inferred: true };
    const stRows = store.get(panel.bindings.stints ?? "/timing/stints")?.rows;
    const map = stintsOf(derived.lapsByEntity, stRows, t);
    const ids =
      sort === "position"
        ? orderAt(derived.lapsByEntity, shown, store.get("/timing/classification"), t, session?.kind === "race" ? "race" : "best")
        : sort === "number"
          ? [...shown].sort((a, b) => (derived.entityById.get(a)?.number ?? 999) - (derived.entityById.get(b)?.number ?? 999))
          : shown;
    const maxLap = Math.max(1, ...derived.laps.map((l) => l.n));
    return { rows: ids.map((e) => [e, map.get(e) ?? []] as [string, Stint[]]), maxLap, inferred: !stRows?.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived, store, version, panel.bindings.stints, shown, t, sort, session?.kind]);

  if (state === "loading" && !derived?.laps.length) return <Skeleton rows={8} />;
  if (!rows.length) return <Empty title="No drivers" />;

  const ticks = niceTicks(0, maxLap, 6).filter((n) => n > 0 && n <= maxLap * 0.97);
  const colour = (s: Stint) => (s.compound ? (p.tyre[s.compound.toUpperCase()] ?? p.split) : p.split);
  return (
    <>
      <Readout>
        <span>{inferred ? "Stints from pit stops" : "Stints and tyres"}</span>
      </Readout>
      <div className="wb-stints">
        <div className="wb-stints__axis">
          <span>Driver</span>
          <div>
            {ticks.map((n) => (
              <span key={n} style={{ left: `${(n / maxLap) * 100}%` }}>
                {n}
              </span>
            ))}
          </div>
        </div>
        <div className="wb-stints__body">
        <div className="wb-stints__gridlayer" aria-hidden>
          {ticks.map((n) => (
            <i key={n} style={{ left: `${(n / maxLap) * 100}%` }} />
          ))}
        </div>
        {rows.map(([e, stints]) => {
          const ent = derived?.entityById.get(e);
          const slot = slotOf(sel, e);
          return (
            <div
              key={e}
              className={`wb-stints__row${slot >= 0 ? " is-selected" : ""}${e === sel.focus ? " is-focus" : ""}`}
              onClick={(ev) => (ev.shiftKey || ev.metaKey || ev.ctrlKey ? toggleCompare(e) : focusEntity(e))}
              onContextMenu={(ev) => {
                ev.preventDefault();
                openPanelMenu(id, ev.clientX, ev.clientY, () => entityMenuItems(e));
              }}
            >
              <span className="wb-driver">
                <Chip code={ent?.code ?? e} colour={ent?.colour} title={ent?.name} />
                {slot >= 0 ? <i className="wb-slotdot" style={{ ["--c" as string]: p.series[slot % p.series.length] }} /> : null}
              </span>
              <div className="wb-stints__track">
                {stints.map((s) => {
                  const c = tyreClass(s.compound ?? "");
                  return (
                    <span
                      key={s.n}
                      className={`wb-stint${s.compound ? ` wb-stint--${c}` : ""}`}
                      style={{
                        left: `${((s.lapStart - 1) / maxLap) * 100}%`,
                        width: `${((s.lapEnd - s.lapStart + 1) / maxLap) * 100}%`,
                        ["--c" as string]: colour(s),
                      }}
                      title={`Stint ${s.n}: laps ${s.lapStart}–${s.lapEnd}${s.compound ? ` · ${s.compound}` : ""}${s.ageAtStart ? ` (${s.ageAtStart} laps old)` : ""}${s.driver ? ` · ${s.driver}` : ""}`}
                    >
                      {stintLabel(s, label)}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </>
  );
}

function stintMenu(id: string): MenuItem[] {
  return [
    radio("Sort", [{ value: "position", label: "Running order" }, { value: "number", label: "Car number" }, { value: "entry", label: "Entry list" }], cfg<string>(id, "sort", "position"), (v) => patch(id, { sort: v })),
    radio("Bar labels", [{ value: "compound", label: "Tyre and laps" }, { value: "driver", label: "Driver" }, { value: "laps", label: "Laps only" }], cfg<string>(id, "label", "compound"), (v) => patch(id, { label: v })),
  ];
}

export const stints: PanelDef = {
  type: "stints",
  title: "Stints",
  description: "Each car's stints by lap, coloured by tyre when the feed has tyre data. Driver swaps start a new stint.",
  icon: "chart-stacked",
  primary: "stints",
  entities: "field",
  needs: ["/timing/laps"],
  slots: {
    stints: { schemas: ["rtc.stints"], required: false, default: "/timing/stints" },
    laps: { schemas: ["rtc.laps"], required: true, default: "/timing/laps" },
    pits: { schemas: ["rtc.pit"], required: false, default: "/timing/pit" },
  },
  defaultConfig: { drivers: "field", sort: "position", label: "compound" },
  menu: ({ id }) => stintMenu(id),
  Component: Stints,
};
