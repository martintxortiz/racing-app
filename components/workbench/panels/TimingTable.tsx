"use client";

import { useMemo, useState } from "react";

import { fitColumns, nextSort, moveColumn, sortBy, toggleColumn, type SortState } from "@/lib/workbench/columns";
import { classesOf, sectorCount, segmentAt, timingAt, type CellFlag, type TimingInput, type TimingRow } from "@/lib/workbench/derive";
import { fmtLap, fmtSector, fmtSigned } from "@/lib/workbench/format";
import { slotOf } from "@/lib/workbench/selection";
import type { Entity } from "@/lib/workbench/types";
import { usePalette } from "../colors";
import { cfg, check, entityMenuItems, openPanelMenu, patch, radio } from "../menus";
import { focusEntity, toggleCompare, useWB, type MenuItem } from "../state";
import { Chip, Empty, Readout, Skeleton, useThrottledT, useTopicState, useWidth, type PanelDef, type PanelProps } from "./common";

/** Every column the table knows. "sectors" expands to as many sector columns as the feed has. */
export const TIMING_COLUMNS = ["pos", "num", "driver", "name", "team", "cls", "crew", "status", "tyre", "age", "best", "gap", "int", "sectors", "last", "trap", "laps", "pits"] as const;
export const DEFAULT_COLUMNS = ["pos", "driver", "status", "tyre", "age", "best", "gap", "int", "sectors", "last", "trap", "laps"];

/** Column widths include cell padding. `prio`: lower survives longer in a narrow panel (race, other). */
const META: Record<string, { label: string; title: string; num?: boolean; center?: boolean; width: number; prio: [number, number] }> = {
  pos: { label: "Pos", title: "Position", num: true, width: 40, prio: [0, 0] },
  num: { label: "No.", title: "Car number", num: true, width: 40, prio: [12, 12] },
  driver: { label: "Driver", title: "Driver / car code", width: 70, prio: [0, 0] },
  name: { label: "Name", title: "Full name", width: 120, prio: [13, 13] },
  team: { label: "Team", title: "Team", width: 110, prio: [14, 14] },
  cls: { label: "Class", title: "Class / category", width: 56, prio: [3, 3] },
  crew: { label: "In car", title: "Driver in the car (driver swaps)", width: 90, prio: [9, 9] },
  status: { label: "", title: "Pit, out lap, in lap or stopped", width: 40, prio: [5, 4] },
  tyre: { label: "Tyre", title: "Compound", center: true, width: 38, prio: [4, 8] },
  age: { label: "Age", title: "Tyre age in laps", num: true, width: 36, prio: [8, 10] },
  trap: { label: "Trap", title: "Speed trap, last lap (km/h)", num: true, width: 44, prio: [11, 11] },
  best: { label: "Best", title: "Best lap", num: true, width: 74, prio: [6, 1] },
  gap: { label: "Gap", title: "Gap", num: true, width: 66, prio: [2, 2] },
  int: { label: "Int", title: "Interval to the car ahead", num: true, width: 62, prio: [1, 5] },
  sectors: { label: "Sectors", title: "Sector times", num: true, width: 60, prio: [7, 3] },
  last: { label: "Last", title: "Last lap", num: true, width: 78, prio: [3, 4] },
  laps: { label: "Laps", title: "Completed laps", num: true, width: 40, prio: [10, 10] },
  pits: { label: "Pits", title: "Pit stops", num: true, width: 38, prio: [7, 12] },
};

/** Cell fill for a best: purple = field best, green = personal best. */
const fillOf = (f: CellFlag) => (f === "purple" ? "wb-fill--purple" : f === "green" ? "wb-fill--green" : undefined);
const STATUS: Record<NonNullable<TimingRow["status"]>, string> = { pit: "Pit", out: "Out", in: "In", stopped: "Stop" };

export function tyreClass(compound: string) {
  const c = compound.toUpperCase();
  if (c.startsWith("S")) return "soft";
  if (c.startsWith("M")) return "medium";
  if (c.startsWith("H")) return "hard";
  if (c.startsWith("I")) return "inter";
  if (c.startsWith("W")) return "wet";
  return "unknown";
}

type Col = { key: string; base: string; sector?: number };

/** Sort value of a cell, for header sorting. */
function sortValue(r: TimingRow, c: Col, ent: Entity | undefined): number | string | null {
  switch (c.base) {
    case "pos":
      return r.pos ?? r.rank;
    case "num":
      return ent?.number ?? null;
    case "driver":
      return ent?.code ?? r.entity;
    case "name":
      return ent?.name ?? null;
    case "team":
      return ent?.team ?? null;
    case "cls":
      return r.cls;
    case "crew":
      return r.driver;
    case "tyre":
      return r.tyre?.compound ?? null;
    case "age":
      return r.tyre?.age ?? null;
    case "status":
      return r.status;
    case "trap":
      return r.trap?.value ?? null;
    case "best":
      return r.best?.time ?? null;
    case "gap":
      return r.gap === null ? null : r.lapsDown * 1e6 + r.gap;
    case "int":
      return r.interval;
    case "sectors":
      return r.sectors[c.sector!] ?? null;
    case "last":
      return r.last?.time ?? null;
    case "laps":
      return r.laps;
    case "pits":
      return r.pits;
  }
  return null;
}

function TimingTable({ id, panel }: PanelProps) {
  const derived = useWB((s) => s.derived);
  const store = useWB((s) => s.store);
  const version = useWB((s) => s.version);
  const session = useWB((s) => s.session);
  const sel = useWB((s) => s.sel);
  const hover = useWB((s) => s.hoverEntity);
  const t = useThrottledT(10);
  const p = usePalette();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const width = useWidth(host);
  const lapsTopic = panel.bindings.laps ?? "/timing/laps";
  const state = useTopicState(lapsTopic);
  const c = panel.config;
  const sort = (c.sort as SortState | null | undefined) ?? null;
  const showHidden = c.showHidden === true;
  const group = (c.group as string | undefined) ?? "auto";

  const input = useMemo((): TimingInput | null => {
    if (!derived) return null;
    const auto = session?.kind === "race" ? "race" : "best";
    return {
      entities: derived.entities.map((e) => ({ id: e.id, class: e.class })),
      laps: derived.lapsByEntity,
      segments: derived.segments,
      classification: panel.bindings.order ? store.get(panel.bindings.order) : undefined,
      stints: panel.bindings.stints ? store.get(panel.bindings.stints)?.rows : undefined,
      pits: panel.bindings.pits ? store.get(panel.bindings.pits) : undefined,
      scope: (c.scope as "session" | "part" | "auto") ?? "auto",
      gapMode: c.gapMode === "race" || c.gapMode === "best" ? c.gapMode : auto,
      gapTo: c.gapTo === "leader" || c.gapTo === "class" ? c.gapTo : c.gapTo === "reference" && sel.reference ? { entity: sel.reference } : "auto",
    };
    // version: the store is mutable and grows while loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived, version, session?.kind, panel.bindings, c.scope, c.gapMode, c.gapTo, sel.reference]);

  const rows = useMemo(() => (input ? timingAt(input, t) : []), [input, t]);
  const nSec = useMemo(() => (derived ? sectorCount(derived.lapsByEntity.values()) : 0), [derived]);
  const classes = useMemo(() => classesOf(derived?.entities ?? []), [derived]);

  // Columns: configured order; columns without data in this recording drop out on their own.
  const has = useMemo(
    () => ({
      tyre: rows.some((r) => r.tyre),
      age: rows.some((r) => r.tyre),
      trap: rows.some((r) => r.trap),
      pits: rows.some((r) => r.pits > 0) || !!input?.pits?.length,
      crew: rows.some((r) => r.driver),
      cls: classes.length > 0,
      team: (derived?.entities ?? []).some((e) => e.team),
      num: (derived?.entities ?? []).some((e) => e.number != null),
      sectors: nSec > 0,
    }),
    [rows, input, classes, derived, nSec],
  );
  const configured = ((c.columns as string[] | undefined) ?? DEFAULT_COLUMNS).filter((k) => META[k]);
  // Fit the panel: sectors count as one block; the least important columns drop first.
  const pi = session?.kind === "race" ? 0 : 1;
  const fit = fitColumns(
    configured
      .filter((k) => has[k as keyof typeof has] !== false)
      .map((k) => ({ key: k, width: k === "sectors" ? META[k].width * nSec : META[k].width, priority: META[k].prio[pi] })),
    width,
  );
  const cols: Col[] = fit.shown.flatMap((x) =>
    x.key === "sectors" ? Array.from({ length: nSec }, (_, i) => ({ key: `s${i + 1}`, base: x.key, sector: i })) : [{ key: x.key, base: x.key }],
  );

  if (state === "loading" || (!derived && state !== "missing")) return <Skeleton rows={10} />;
  if (state === "missing" || !derived) return <Empty title="No lap data">Bind a laps topic from the panel menu.</Empty>;

  const visible = rows.filter((r) => showHidden || !sel.hidden.includes(r.entity));
  const sortCol = sort ? cols.find((x) => x.key === sort.key) : undefined;
  let ordered = sortCol ? sortBy(visible, (r) => sortValue(r, sortCol, derived.entityById.get(r.entity)), sort!.dir) : visible;
  const grouped = classes.length > 0 && group !== "none" && !sortCol;
  if (grouped) ordered = classes.flatMap((k) => ordered.filter((r) => r.cls === k)).concat(ordered.filter((r) => !r.cls || !classes.includes(r.cls)));
  const race = input?.gapMode === "race";
  // Knockout cut line: only when the data shows how many go through and the table ranks the part.
  const part = segmentAt(derived.segments, t);
  const knockout = derived.segments.some((g) => g.advance);
  const partScope = c.scope === "part" || ((c.scope ?? "auto") === "auto" && knockout);
  const cutAfter = !race && !sortCol && partScope && part?.advance && part.advance < ordered.length && ordered.some((r) => r.best) ? part.advance : null;

  /** Cell content and its semantic fill. */
  const cell = (r: TimingRow, col: Col): [React.ReactNode, string | undefined, React.CSSProperties | undefined] => {
    const e = derived.entityById.get(r.entity);
    switch (col.base) {
      case "pos":
        return [grouped ? r.rank : (r.pos ?? r.rank), undefined, undefined];
      case "num":
        return [e?.number ?? "", undefined, undefined];
      case "driver": {
        // Team colour on the chip; the comparison slot as a small square after it.
        const k = slotOf(sel, r.entity);
        return [
          <span key="d" className="wb-driver">
            <Chip code={e?.code ?? r.entity} colour={e?.colour} title={`${e?.name ?? ""}${e?.number != null ? ` #${e.number}` : ""}${e?.team ? ` · ${e.team}` : ""}`} />
            {k >= 0 ? <i className="wb-slotdot" style={{ ["--c" as string]: p.series[k % p.series.length] }} /> : null}
          </span>,
          "wb-team-cell",
          undefined,
        ];
      }
      case "name":
        return [<span key="n" className="wb-ellipsis">{e?.name ?? ""}</span>, undefined, undefined];
      case "team":
        return [<span key="t" className="wb-ellipsis pw-faint">{e?.team ?? ""}</span>, undefined, undefined];
      case "cls":
        return [r.cls ?? "", undefined, undefined];
      case "crew":
        return [<span key="c" className="wb-ellipsis">{r.driver ?? ""}</span>, undefined, undefined];
      case "status":
        return [r.status ? STATUS[r.status] : "", r.status ? `wb-status-cell is-${r.status}` : undefined, undefined];
      case "tyre":
        return [
          r.tyre ? <span key="y" className={`pw-tyre pw-tyre--${tyreClass(r.tyre.compound)}`} title={r.tyre.compound}>{r.tyre.compound[0]}</span> : <span key="y" className="pw-faint">—</span>,
          undefined,
          undefined,
        ];
      case "age":
        return [r.tyre ? r.tyre.age : "", undefined, undefined];
      case "best":
        if (!r.best && r.prior)
          return [<span key="b" className="pw-faint" title={`Best in ${r.prior.segment ?? "earlier part"}`}>{fmtLap(r.prior.time)}</span>, undefined, undefined];
        return [fmtLap(r.best?.time), fillOf(r.bestFlag), undefined];
      case "gap":
        if (r.lapsDown > 0) return [`+${r.lapsDown} L`, undefined, undefined];
        return [r.gap === null ? "" : r.gap === 0 ? <span key="g" className="pw-faint">—</span> : fmtSigned(r.gap), undefined, undefined];
      case "int": {
        if (r.interval === null || r.interval === 0) return [<span key="i" className="pw-faint">—</span>, undefined, undefined];
        // Race: closing on the car ahead (green) or dropping back (red), by more than 0.1 s a lap.
        const tr = r.intervalTrend;
        const fill = tr === null ? undefined : tr < -0.1 ? "wb-fill--green" : tr > 0.1 ? "wb-fill--red" : undefined;
        return [<span key="i" title={tr === null ? undefined : `${fmtSigned(tr)} s since last lap`}>{fmtSigned(r.interval)}</span>, fill, undefined];
      }
      case "sectors":
        return [fmtSector(r.sectors[col.sector!]), fillOf(r.sectorFlags[col.sector!]), undefined];
      case "last":
        if (!r.last) return [<span key="l" className="pw-faint">—</span>, undefined, undefined];
        if (r.last.deleted)
          return [
            <s key="l" title={r.last.deletedReason}>
              {fmtLap(r.last.time)}
            </s>,
            "wb-fill--deleted",
            undefined,
          ];
        return [fmtLap(r.last.time), fillOf(r.lastFlag), undefined];
      case "trap":
        return [r.trap ? Math.round(r.trap.value) : "", fillOf(r.trap?.flag ?? null), undefined];
      case "laps":
        return [r.laps, undefined, undefined];
      case "pits":
        return [r.pits, undefined, undefined];
    }
    return ["", undefined, undefined];
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    e.stopPropagation();
    const i = ordered.findIndex((r) => r.entity === sel.focus);
    const next = ordered[Math.max(0, Math.min(ordered.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) focusEntity(next.entity);
  };

  const body: React.ReactNode[] = [];
  let lastCls: string | null | undefined;
  for (const r of ordered) {
    if (grouped && r.cls !== lastCls) {
      body.push(
        <tr key={`g-${r.cls}`} className="wb-t__group">
          <td colSpan={cols.length}>{r.cls ?? "Other"}</td>
        </tr>,
      );
      lastCls = r.cls;
    }
    const hidden = sel.hidden.includes(r.entity);
    body.push(
      <tr
        key={r.entity}
        className={[
          sel.compare.includes(r.entity) && "is-selected",
          r.entity === sel.focus && "is-focus",
          r.entity === hover && "is-hover",
          hidden && "is-hidden",
          r.status && `is-${r.status}`,
          r.prior && "is-elim",
          cutAfter !== null && r.rank === cutAfter && "is-cut",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={(e) => (e.shiftKey || e.metaKey || e.ctrlKey ? toggleCompare(r.entity) : focusEntity(r.entity))}
        onContextMenu={(e) => {
          e.preventDefault();
          openPanelMenu(id, e.clientX, e.clientY, () => entityMenuItems(r.entity));
        }}
        onPointerEnter={() => useWB.setState({ hoverEntity: r.entity })}
        onPointerLeave={() => useWB.setState({ hoverEntity: null })}
      >
        {cols.map((col) => {
          const [content, fill, style] = cell(r, col);
          return (
            <td key={col.key} className={[META[col.base].num && "is-num", META[col.base].center && "is-center", fill].filter(Boolean).join(" ") || undefined} style={style}>
              {content}
            </td>
          );
        })}
      </tr>,
    );
  }

  const hiddenCols = fit.hidden.map((x) => META[x.key].title);
  return (
    <>
      <Readout>
        <span>
          {race ? "Gaps by elapsed time" : partScope && part ? `Bests in ${part.id}` : "Gaps by best lap"}
          {cutAfter ? ` · top ${cutAfter} go through` : ""}
          {sortCol ? ` · sorted by ${sortCol.key === sortCol.base ? META[sortCol.base].label : sortCol.key.toUpperCase()}` : ""}
        </span>
        {hiddenCols.length ? (
          <span className="wb-hiddencols" title={`Hidden to fit the panel: ${hiddenCols.join(", ")}`}>
            {hiddenCols.length} {hiddenCols.length === 1 ? "column" : "columns"} hidden
          </span>
        ) : null}
      </Readout>
      <div className="wb-scroll" ref={setHost}>
        <table className="wb-t wb-timing" tabIndex={0} onKeyDown={onKey}>
          <colgroup>
            {cols.map((col) => (
              <col key={col.key} style={{ width: META[col.base].width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {cols.map((col) => (
                <th
                  key={col.key}
                  title={col.sector !== undefined ? `Sector ${col.sector + 1} (best lap)` : META[col.base].title}
                  className={["is-sortable", META[col.base].num && "is-num", META[col.base].center && "is-center", sort?.key === col.key && "is-sorted"].filter(Boolean).join(" ")}
                  aria-sort={sort?.key === col.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                  onClick={() => patch(id, { sort: nextSort(sort, col.key) })}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openPanelMenu(id, e.clientX, e.clientY, () => columnMenu(id, col.key, col.base));
                  }}
                >
                  {col.sector !== undefined ? `S${col.sector + 1}` : META[col.base].label}
                  {sort?.key === col.key ? <span className={`wb-sort pw-icon pw-icon--caret-${sort.dir === "asc" ? "up" : "down"}`} /> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
    </>
  );
}

/** Header right-click: sort, hide, move and the full column chooser. */
export function columnMenu(id: string, key: string, base: string): MenuItem[] {
  const cols = cfg<string[]>(id, "columns", DEFAULT_COLUMNS);
  const sort = cfg<SortState | null>(id, "sort", null);
  const label = key.startsWith("s") && base === "sectors" ? `Sector ${key.slice(1)}` : META[base].title;
  const all = [...TIMING_COLUMNS];
  return [
    { heading: label },
    { label: "Sort ascending", radio: true, checked: sort?.key === key && sort.dir === "asc", onSelect: () => patch(id, { sort: { key, dir: "asc" } }) },
    { label: "Sort descending", radio: true, checked: sort?.key === key && sort.dir === "desc", onSelect: () => patch(id, { sort: { key, dir: "desc" } }) },
    { label: "Official order", radio: true, checked: !sort, onSelect: () => patch(id, { sort: null }) },
    { separator: true },
    { label: base === "sectors" ? "Hide sector columns" : "Hide column", disabled: cols.length <= 1, onSelect: () => patch(id, { columns: toggleColumn(cols, base, all) }) },
    { label: "Move left", disabled: cols.indexOf(base) <= 0, onSelect: () => patch(id, { columns: moveColumn(cols, base, -1) }) },
    { label: "Move right", disabled: cols.indexOf(base) >= cols.length - 1, onSelect: () => patch(id, { columns: moveColumn(cols, base, 1) }) },
  ];
}

/** Checkbox list of every column, plus reset. */
function columnChooser(id: string, nSec: number, has: Record<string, boolean>): MenuItem[] {
  const all = [...TIMING_COLUMNS];
  const now = cfg<string[]>(id, "columns", DEFAULT_COLUMNS);
  return [
    ...all.map((k) => ({
      label: k === "sectors" ? `Sectors${nSec ? ` (${nSec})` : ""}` : META[k].title,
      hint: has[k] === false ? "no data" : undefined,
      checked: now.includes(k),
      keepOpen: true,
      onSelect: () => patch(id, { columns: toggleColumn(cfg<string[]>(id, "columns", DEFAULT_COLUMNS), k, all) }),
    })),
    { separator: true },
    { label: "Reset columns", onSelect: () => patch(id, { columns: DEFAULT_COLUMNS, sort: null }) },
  ];
}

export const timingTable: PanelDef = {
  type: "timing-table",
  title: "Timing",
  description: "Order, gaps, sectors and tyres at the cursor. Any series, any session; classes grouped.",
  icon: "data-table",
  primary: "laps",
  needs: ["/timing/laps"],
  slots: {
    order: { schemas: ["rtc.classification"], required: false, default: "/timing/classification" },
    laps: { schemas: ["rtc.laps"], required: true, default: "/timing/laps" },
    stints: { schemas: ["rtc.stints"], required: false, default: "/timing/stints" },
    pits: { schemas: ["rtc.pit"], required: false, default: "/timing/pit" },
  },
  defaultConfig: { columns: DEFAULT_COLUMNS, sort: null, scope: "auto", gapMode: "auto", gapTo: "auto", group: "auto", showHidden: false },
  menu: ({ id, panel }) => {
    const c = panel.config;
    const set = (k: string) => (v: unknown) => patch(id, { [k]: v });
    const classes = classesOf(useWB.getState().derived?.entities ?? []);
    return [
      {
        label: "Columns",
        submenu: () => {
          const derived = useWB.getState().derived;
          return columnChooser(id, derived ? sectorCount(derived.lapsByEntity.values()) : 0, {});
        },
      },
      radio("Gaps", [
        { value: "auto", label: "Auto (by session type)" },
        { value: "best", label: "By best lap" },
        { value: "race", label: "By elapsed time" },
      ], c.gapMode ?? "auto", set("gapMode")),
      radio("Gap to", [
        { value: "auto", label: classes.length ? "Class leader" : "Leader" },
        { value: "leader", label: "Overall leader" },
        ...(classes.length ? [{ value: "class", label: "Class leader" }] : []),
        { value: "reference", label: "Reference driver" },
      ], c.gapTo ?? "auto", set("gapTo")),
      radio("Bests from", [
        { value: "auto", label: "Auto (part in knockout sessions)" },
        { value: "session", label: "Whole session" },
        { value: "part", label: "Current session part" },
      ], c.scope ?? "auto", set("scope")),
      ...(classes.length ? [radio("Classes", [{ value: "auto", label: "Grouped" }, { value: "none", label: "Overall" }], c.group ?? "auto", set("group"))] : []),
      check("Show hidden drivers", c.showHidden === true, set("showHidden")),
    ];
  },
  Component: TimingTable,
};
