// Menu builders shared by every panel: entity actions, the panel menu and small radio/check helpers.

import type { Edge } from "@/lib/workbench/layout";
import { MAX_COMPARE, lapOf, referenceOf } from "@/lib/workbench/selection";
import { fmtLap } from "@/lib/workbench/format";
import type { EntityId, LapRef } from "@/lib/workbench/types";
import { panelDef, PANELS, newPanelState } from "./panels/registry";
import {
  addCompare,
  changePanelType,
  clearComparison,
  duplicatePanel,
  focusEntity,
  isolateEntity,
  movePanelToTab,
  openMenu,
  openPicker,
  removeCompare,
  removePanelById,
  setT as seek,
  setFollow,
  setReference,
  showLap,
  toggleHidden,
  toggleMaximize,
  updatePanel,
  useWB,
  type MenuAction,
  type MenuItem,
} from "./state";

// ---------- helpers ----------

/** A submenu of mutually exclusive options. */
export function radio<T>(label: string, options: { value: T; label: string; hint?: string }[], current: T, set: (v: T) => void, keepOpen = false): MenuAction {
  const cur = options.find((o) => o.value === current);
  return {
    label,
    hint: cur?.label,
    submenu: () => options.map((o) => ({ label: o.label, hint: o.hint, radio: true, checked: o.value === current, keepOpen, onSelect: () => set(o.value) })),
  };
}

export const check = (label: string, on: boolean, set: (v: boolean) => void, hint?: string): MenuAction => ({
  label,
  hint,
  checked: on,
  keepOpen: true,
  onSelect: () => set(!on),
});

const panelConfig = (id: string) => useWB.getState().layout.panels[id]?.config ?? {};
export const cfg = <T,>(id: string, key: string, fallback: T): T => {
  const v = panelConfig(id)[key];
  if (v !== undefined) return v as T;
  const def = panelDef(useWB.getState().layout.panels[id]?.type ?? "").defaultConfig[key];
  return (def === undefined ? fallback : def) as T;
};
export const patch = (id: string, p: Record<string, unknown>) => updatePanel(id, (x) => ({ ...x, config: { ...x.config, ...p } }));

// ---------- entities ----------

export function entityName(e: EntityId): string {
  const ent = useWB.getState().derived?.entityById.get(e);
  return ent ? `${ent.code}${ent.name && ent.name !== ent.code ? ` · ${ent.name}` : ""}` : e;
}

export function lapItems(e: EntityId): MenuItem[] {
  const { derived, sel } = useWB.getState();
  const laps = derived?.lapsByEntity.get(e) ?? [];
  const cur = lapOf(sel, e);
  const same = (r: LapRef) => JSON.stringify(r) === JSON.stringify(cur);
  const timed = laps.filter((l) => l.time !== null);
  const items: MenuItem[] = [
    { label: "Best lap", radio: true, checked: same("best"), onSelect: () => showLap(e, "best") },
    { label: "Last completed", radio: true, checked: same("last"), onSelect: () => showLap(e, "last") },
    { label: "Lap at cursor", radio: true, checked: same("cursor"), onSelect: () => showLap(e, "cursor") },
  ];
  if (timed.length) items.push({ separator: true });
  for (const l of timed.slice(-40))
    items.push({
      label: `Lap ${l.n}`,
      hint: `${fmtLap(l.time)}${l.deleted ? " · deleted" : l.outLap ? " · out lap" : ""}`,
      radio: true,
      checked: same({ n: l.n }),
      onSelect: () => showLap(e, { n: l.n }),
    });
  return items;
}

function jumpItems(e: EntityId): MenuItem[] {
  const laps = useWB.getState().derived?.lapsByEntity.get(e) ?? [];
  const best = laps.filter((l) => l.time !== null && !l.deleted).sort((a, b) => a.time! - b.time!)[0];
  const last = laps.filter((l) => l.time !== null).at(-1);
  return [
    { label: "Start of best lap", disabled: !best, onSelect: () => best && seek(best.t0) },
    { label: "Start of last lap", disabled: !last, onSelect: () => last && seek(last.t0) },
    { label: "First lap", disabled: !laps.length, onSelect: () => laps[0] && seek(laps[0].t0) },
  ];
}

/** Everything you can do with one car / driver; used by every panel that shows entities. */
export function entityMenuItems(e: EntityId, opts: { lapNumber?: number } = {}): MenuItem[] {
  const { sel, follow } = useWB.getState();
  const inCompare = sel.compare.includes(e);
  const isRef = referenceOf(sel) === e && sel.compare.length > 1;
  const hidden = sel.hidden.includes(e);
  return [
    { heading: entityName(e) },
    { label: "Focus", hint: "Click", checked: sel.focus === e ? true : undefined, onSelect: () => focusEntity(e) },
    inCompare
      ? { label: "Remove from comparison", hint: "Shift+click", onSelect: () => removeCompare(e) }
      : { label: "Add to comparison", hint: "Shift+click", disabled: sel.compare.length >= MAX_COMPARE, onSelect: () => addCompare(e) },
    isRef
      ? { label: "Clear reference", onSelect: () => setReference(null) }
      : { label: "Set as reference", onSelect: () => setReference(e) },
    { label: "Compare only this", onSelect: () => isolateEntity(e) },
    ...(opts.lapNumber !== undefined
      ? [{ label: `Show lap ${opts.lapNumber} in telemetry`, onSelect: () => showLap(e, { n: opts.lapNumber! }) }]
      : []),
    { label: "Lap for telemetry", submenu: () => lapItems(e) },
    { label: "Jump to", submenu: () => jumpItems(e) },
    { separator: true },
    { label: follow === e ? "Stop following on map" : "Follow on track map", onSelect: () => setFollow(follow === e ? null : e) },
    { label: hidden ? "Show in field" : "Hide from field", onSelect: () => toggleHidden(e) },
    { label: "Copy name", onSelect: () => void navigator.clipboard?.writeText(entityName(e)) },
  ];
}

export function openEntityMenu(e: EntityId, x: number, y: number, extra: MenuItem[] = [], opts: { lapNumber?: number } = {}) {
  openMenu(x, y, () => [...entityMenuItems(e, opts), ...(extra.length ? [{ separator: true } as const, ...extra] : [])]);
}

// ---------- panel menu ----------

const renamers = new Map<string, () => void>();
export const registerRename = (id: string, f: (() => void) | null) => (f ? renamers.set(id, f) : renamers.delete(id));

function driversMenu(id: string, fallback: "selection" | "field"): MenuAction {
  const { derived } = useWB.getState();
  const cur = cfg<unknown>(id, "drivers", fallback);
  const pinned = Array.isArray(cur) ? (cur as string[]) : [];
  return {
    label: "Drivers",
    hint: cur === "field" ? "Field" : cur === "selection" ? "Comparison" : `${pinned.length} pinned`,
    submenu: () => {
      const now = cfg<unknown>(id, "drivers", fallback);
      const list = Array.isArray(now) ? (now as string[]) : [];
      return [
        { label: "Follow comparison", radio: true, checked: now === "selection", onSelect: () => patch(id, { drivers: "selection" }) },
        { label: "Whole field", radio: true, checked: now === "field", onSelect: () => patch(id, { drivers: "field" }) },
        {
          label: "Pin current comparison",
          radio: true,
          checked: Array.isArray(now),
          onSelect: () => patch(id, { drivers: [...useWB.getState().sel.compare] }),
        },
        { separator: true },
        { heading: "Pinned" },
        ...(derived?.entities ?? []).map((e) => ({
          label: e.code,
          hint: e.class ?? e.team,
          swatch: e.colour,
          checked: list.includes(e.id),
          keepOpen: true,
          onSelect: () => {
            const base = Array.isArray(cfg<unknown>(id, "drivers", fallback)) ? list : [];
            patch(id, { drivers: base.includes(e.id) ? base.filter((x) => x !== e.id) : [...base, e.id] });
          },
        })),
      ];
    },
  };
}

export function dataItems(id: string): MenuItem[] {
  const { layout, session } = useWB.getState();
  const panel = layout.panels[id];
  const def = panelDef(panel.type);
  const topics = session?.topics ?? [];
  const items: MenuItem[] = [];
  for (const [slot, s] of Object.entries(def.slots)) {
    const cur = panel.bindings[slot];
    const options = new Set<string>();
    for (const tp of topics.filter((t) => s.schemas.includes(t.schema) || s.schemas.includes(`kind:${t.kind}`))) {
      if (s.pattern) options.add(tp.name.replace(/\/vehicle\/[^/]+\//, "/vehicle/*/"));
      else options.add(tp.name);
    }
    if (s.pattern) options.add(s.default);
    if (cur) options.add(cur);
    items.push({
      label: slot,
      hint: cur ?? "unbound",
      submenu: () => [
        ...[...options].sort().map((o) => ({
          label: o,
          radio: true,
          checked: o === cur,
          onSelect: () => updatePanel(id, (p) => ({ ...p, bindings: { ...p.bindings, [slot]: o } })),
        })),
        ...(!s.required && cur
          ? [
              { separator: true } as const,
              {
                label: "Unbind",
                onSelect: () =>
                  updatePanel(id, (p) => {
                    const b = { ...p.bindings };
                    delete b[slot];
                    return { ...p, bindings: b };
                  }),
              },
            ]
          : []),
      ],
    });
  }
  return items;
}

export function panelMenuItems(id: string, local: MenuItem[] = []): MenuItem[] {
  const { layout, maximized, activeTab } = useWB.getState();
  const panel = layout.panels[id];
  if (!panel) return [];
  const def = panelDef(panel.type);
  const setConfig = (p: Record<string, unknown>) => patch(id, p);
  const own = def.menu?.({ id, panel, setConfig }) ?? [];
  const settings: MenuItem[] = (def.settings ?? []).map((s) =>
    radio(s.label, s.options, panel.config[s.key] ?? def.defaultConfig[s.key], (v) => setConfig({ [s.key]: v })),
  );
  const split = (edge: Edge) => () => openPicker({ kind: "split", panel: id, edge });
  const rename = renamers.get(id);
  const otherTabs = layout.tabs.filter((t) => t.id !== activeTab);
  const sections: MenuItem[][] = [
    local,
    [...own, ...settings],
    [
      ...(def.entities ? [driversMenu(id, def.entities)] : []),
      ...(Object.keys(def.slots).length ? [{ label: "Data", submenu: () => dataItems(id) } as MenuAction] : []),
    ],
    [
      {
        label: "Change widget",
        submenu: () =>
          PANELS.map((d) => ({
            label: d.title,
            radio: true,
            checked: d.type === panel.type,
            onSelect: () => d.type !== panel.type && changePanelType(id, newPanelState(d)),
          })),
      },
      {
        label: "Split",
        submenu: [
          { label: "Right…", onSelect: split("right") },
          { label: "Down…", onSelect: split("bottom") },
          { label: "Left…", onSelect: split("left") },
          { label: "Up…", onSelect: split("top") },
        ],
      },
      { label: "Duplicate", onSelect: () => duplicatePanel(id) },
      ...(rename ? [{ label: "Rename", onSelect: rename }] : []),
      { label: maximized === id ? "Restore" : "Maximize", hint: "F", onSelect: () => toggleMaximize(id) },
      {
        label: "Move to tab",
        disabled: !otherTabs.length,
        submenu: () => otherTabs.map((t) => ({ label: t.name, onSelect: () => movePanelToTab(id, t.id) })),
      },
    ],
    [
      {
        label: "Reset settings",
        onSelect: () => updatePanel(id, (p) => ({ ...p, config: structuredClone(def.defaultConfig) })),
      },
      { label: "Copy panel JSON", onSelect: () => void navigator.clipboard?.writeText(JSON.stringify(panel, null, 2)) },
      { label: "Close panel", danger: true, onSelect: () => removePanelById(id) },
    ],
  ];
  const out: MenuItem[] = [];
  for (const sec of sections.filter((s) => s.length)) {
    if (out.length) out.push({ separator: true });
    out.push(...sec);
  }
  return out;
}

/** Open the panel menu; `local` items (what was right-clicked) come first. */
export function openPanelMenu(id: string, x: number, y: number, local: MenuItem[] | (() => MenuItem[]) = []) {
  openMenu(x, y, () => panelMenuItems(id, typeof local === "function" ? local() : local));
}

/** Entity rows: entity actions first, then the panel's menu in a submenu-free tail. */
export function openEntityPanelMenu(id: string, e: EntityId, x: number, y: number, opts: { lapNumber?: number } = {}) {
  openPanelMenu(id, x, y, () => entityMenuItems(e, opts));
}

export { clearComparison };
