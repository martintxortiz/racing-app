"use client";

import { useEffect, useMemo, useRef } from "react";

import { segmentClock, sentenceCase } from "@/lib/workbench/format";
import { slotOf } from "@/lib/workbench/selection";
import { usePalette } from "../colors";
import { flagColour } from "./SessionInfo";
import { cfg, check, entityMenuItems, openPanelMenu, patch } from "../menus";
import { focusEntity, setT, toggleCompare, useWB, type MenuItem } from "../state";
import { Chip, Empty, Readout, Skeleton, useThrottledT, useTopicState, type PanelDef, type PanelProps } from "./common";

interface Ev {
  i: number;
  t: number;
  category: string;
  flag: string | null;
  message: string;
  entity: string | null;
  raw: Record<string, unknown>;
}

const EVENTS = "/session/events";

function readEvents(topic: string): Ev[] {
  const d = useWB.getState().store.get(topic);
  if (!d) return [];
  return d.rows.map((r, i) => ({
    i,
    t: d.t[i],
    category: String(r.category ?? "Other"),
    flag: r.flag ? String(r.flag) : null,
    message: String(r.message ?? ""),
    entity: r.entity != null ? String(r.entity) : r.driver_number != null ? String(r.driver_number) : null,
    raw: r,
  }));
}

function EventLog({ id, panel }: PanelProps) {
  const p = usePalette();
  const topic = panel.bindings.events ?? EVENTS;
  const state = useTopicState(topic);
  const store = useWB((s) => s.store);
  const version = useWB((s) => s.version);
  const derived = useWB((s) => s.derived);
  const session = useWB((s) => s.session);
  const sel = useWB((s) => s.sel);
  const t = useThrottledT(4);
  const follow = panel.config.follow !== false;
  const raw = panel.config.raw === true;
  const only = panel.config.only === true;
  const future = panel.config.future === true;
  const hidden = useMemo(() => new Set((panel.config.categories as string[]) ?? []), [panel.config.categories]);
  const scroller = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const events = useMemo(() => readEvents(topic), [store, version, topic]);
  const shown = events.filter(
    (e) => !hidden.has(e.category) && (!only || (e.entity !== null && sel.compare.includes(e.entity))) && (future || e.t <= t),
  );
  const past = shown.filter((e) => e.t <= t).length;

  // Follow: keep the latest event at or before the cursor in view.
  useEffect(() => {
    if (!follow || !scroller.current) return;
    const lastPast = shown.filter((e) => e.t <= t).at(-1);
    const row = lastPast ? scroller.current.querySelector<HTMLElement>(`[data-row="${lastPast.i}"]`) : null;
    if (row) row.scrollIntoView({ block: "nearest" });
    else if (panel.config.newest !== false) scroller.current.scrollTop = 0;
  }, [past, follow]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === "loading") return <Skeleton rows={8} />;
  if (state === "missing") return <Empty title="No messages">This recording has no {topic} topic.</Empty>;

  const known = (e: string | null) => (e ? derived?.entityById.get(e) : undefined);
  const code = (e: string | null) => (e ? (known(e)?.code ?? e) : "");

  const newest = panel.config.newest !== false;
  const list = newest ? [...shown].reverse() : shown;
  const showCat = panel.config.showCategory === true;
  const tbl = (
    <table className="wb-t wb-rc">
      <colgroup>
        <col style={{ width: (derived?.segments.length ?? 1) > 1 ? 96 : 60 }} />
        {showCat ? <col style={{ width: 84 }} /> : null}
        <col style={{ width: 92 }} />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th>Time</th>
          {showCat ? <th>Category</th> : null}
          <th>Flag</th>
          <th>Message</th>
        </tr>
      </thead>
      <tbody>
        {list.map((e) => {
          const slot = e.entity ? slotOf(sel, e.entity) : -1;
          const ent = known(e.entity);
          const fc = e.flag ? flagColour(e.flag, p.flag, "") : "";
          const sector = e.raw.sector != null ? ` S${e.raw.sector}` : "";
          return (
            <tr
              key={e.i}
              data-row={e.i}
              className={[e.t > t && "is-future", slot >= 0 && "is-selected"].filter(Boolean).join(" ") || undefined}
              onClick={(ev) => {
                setT(e.t);
                if (ent && (ev.shiftKey || ev.metaKey || ev.ctrlKey)) toggleCompare(e.entity!);
              }}
              onContextMenu={(ev) => {
                ev.preventDefault();
                openPanelMenu(id, ev.clientX, ev.clientY, () => [
                  { label: "Move cursor here", onSelect: () => setT(e.t) },
                  { label: "Copy message", onSelect: () => void navigator.clipboard?.writeText(e.message) },
                  { label: `Hide “${e.category}”`, onSelect: () => patch(id, { categories: [...hidden, e.category] }) },
                  { label: `Only “${e.category}”`, onSelect: () => patch(id, { categories: categoriesOf(events).filter((c) => c !== e.category) }) },
                  ...(ent ? [{ separator: true } as const, ...entityMenuItems(e.entity!)] : []),
                ]);
              }}
            >
              <td className="is-num wb-rc__t">{session && derived ? shortClock(segmentClock(e.t, derived.segments, session.session), derived.segments.length) : e.t.toFixed(1)}</td>
              {showCat ? <td className="wb-rc__cat">{categoryLabel(e.category)}</td> : null}
              <td>
                {e.flag ? (
                  <span className="wb-rc__flag">
                    <i className="wb-flag" style={{ ["--c" as string]: fc || p.text3 }} />
                    {flagText(e.flag) + sector}
                  </span>
                ) : null}
              </td>
              <td className="wb-rc__msg" title={raw ? undefined : e.message}>
                {ent ? (
                  <span
                    className="wb-team-cell"
                    onClick={(ev) => {
                      if (ev.shiftKey || ev.metaKey || ev.ctrlKey) return;
                      focusEntity(e.entity!);
                    }}
                  >
                    <Chip code={code(e.entity)} colour={ent.colour} title={ent.name} />
                  </span>
                ) : null}
                {raw ? <code className="wb-log__raw">{JSON.stringify(e.raw)}</code> : sentenceCase(e.message)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <>
      <Readout>
        <span>
          {past} of {shown.length}
          {hidden.size || only ? " · filtered" : ""}
        </span>
      </Readout>
      <div className="wb-log__rows" ref={scroller}>
        {shown.length === 0 ? <Empty title="No messages match">Right-click to change the filters.</Empty> : tbl}
      </div>
    </>
  );
}

/** Drop tenths, and the part name when the session has one part: "Session 44:20.9" → "44:20". */
export function shortClock(s: string, parts: number): string {
  const x = s.replace(/\.\d$/, "");
  return parts <= 1 ? x.replace(/^\S+ (?=[+\d−-])/, "") : x;
}

export function categoriesOf(events: { category: string }[]): string[] {
  return [...new Set(events.map((e) => e.category))].sort();
}

/** "SafetyCar" → "Safety car", "CarEvent" → "Car event", "Drs" → "DRS". */
export function categoryLabel(c: string): string {
  if (/^drs$/i.test(c)) return "DRS";
  const w = c.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

export { sentenceCase } from "@/lib/workbench/format";

/** "DOUBLE YELLOW" → "Dbl yellow", "CHEQUERED" → "Chequered". */
export function flagText(f: string): string {
  const w = f.toLowerCase().replace(/^double /, "dbl ");
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function logMenu(id: string, topic: string): MenuItem[] {
  const cats = categoriesOf(readEvents(topic));
  return [
    {
      label: "Categories",
      disabled: !cats.length,
      submenu: () => {
        const hidden = cfg<string[]>(id, "categories", []);
        return [
          { label: "Show all", disabled: !hidden.length, onSelect: () => patch(id, { categories: [] }) },
          { separator: true },
          ...cats.map((c) => ({
            label: categoryLabel(c),
            checked: !hidden.includes(c),
            keepOpen: true,
            onSelect: () => {
              const h = cfg<string[]>(id, "categories", []);
              patch(id, { categories: h.includes(c) ? h.filter((x) => x !== c) : [...h, c] });
            },
          })),
        ];
      },
    },
    check("Newest on top", cfg<boolean>(id, "newest", true), (v) => patch(id, { newest: v })),
    check("Category column", cfg<boolean>(id, "showCategory", false), (v) => patch(id, { showCategory: v })),
    check("Only compared drivers", cfg<boolean>(id, "only", false), (v) => patch(id, { only: v })),
    check("Show messages after cursor", cfg<boolean>(id, "future", false), (v) => patch(id, { future: v })),
    check("Follow cursor", cfg<boolean>(id, "follow", true), (v) => patch(id, { follow: v })),
    check("Raw rows", cfg<boolean>(id, "raw", false), (v) => patch(id, { raw: v })),
  ];
}

export const eventLog: PanelDef = {
  type: "event-log",
  title: "Race control",
  description: "Race control as a table: time, category, flag, car and message. Newest on top; filter categories from the menu.",
  icon: "list",
  primary: "events",
  needs: [EVENTS],
  slots: { events: { schemas: ["rtc.events"], required: true, default: EVENTS } },
  defaultConfig: { follow: true, raw: false, categories: [], only: false, future: false, newest: true, showCategory: false },
  menu: ({ id, panel }) => logMenu(id, panel.bindings.events ?? EVENTS),
  Component: EventLog,
};
