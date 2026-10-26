"use client";

import { create } from "zustand";

import {
  insertAt,
  movePanel,
  newId,
  panelIds,
  prune,
  removePanel,
  replacePanel,
  setSplit,
  type Edge,
  type Layout,
  type PanelState,
  type Path,
} from "@/lib/workbench/layout";
import { defaultLayout, presetTab } from "@/lib/workbench/presets";
import * as S from "@/lib/workbench/selection";
import { derive, type Derived } from "@/lib/workbench/session";
import { Store } from "@/lib/workbench/store";
import type { EntityId, LapRef, Sec, SessionMeta } from "@/lib/workbench/types";

export interface MenuAction {
  label: string;
  onSelect?: () => void;
  hint?: string;
  disabled?: boolean;
  /** Checkbox (true/false) or radio state; undefined = plain item. */
  checked?: boolean;
  radio?: boolean;
  /** Keep the menu open after selecting (checkbox lists). */
  keepOpen?: boolean;
  /** Small colour square before the label (entities, series). */
  swatch?: string;
  danger?: boolean;
  /** Nested menu, built when it opens so it always reflects current state. */
  submenu?: MenuItem[] | (() => MenuItem[]);
}
export type MenuItem = MenuAction | { separator: true } | { heading: string };
export interface MenuState {
  x: number;
  y: number;
  /** Items are rebuilt on every state change while the menu is open (checkmarks stay live). */
  items: MenuItem[] | (() => MenuItem[]);
}
/** Where a panel chosen in the picker goes. */
export type PickerTarget =
  | { kind: "split"; panel: string; edge: Edge }
  | { kind: "replace"; panel: string }
  | { kind: "tab"; tab: string };

export const SPEEDS = [0.5, 1, 2, 4, 8, 16, 32, 64, 128];

interface WB {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  progress: { bytes: number; total: number; phase: string } | null;
  session: SessionMeta | null;
  store: Store;
  derived: Derived | null;
  version: number;

  t: Sec;
  playing: boolean;
  speed: number;

  sel: S.Selection;
  /** Entity the track maps follow, if any. */
  follow: EntityId | null;
  hoverEntity: EntityId | null;
  hoverDistance: number | null;

  layout: Layout;
  dirty: boolean;
  activeTab: string;
  maximized: string | null;
  focused: string | null;
  menu: MenuState | null;
  picker: PickerTarget | null;
  theme: "light" | "dark";
  /** One transient message (errors, confirmations); the shell shows it as a toast. */
  notice: { kind: "info" | "error"; text: string } | null;
  /** Small text prompt (Save as…). */
  prompt: { title: string; value: string; onSubmit: (v: string) => void } | null;
}

export const useWB = create<WB>(() => ({
  status: "idle",
  error: null,
  progress: null,
  session: null,
  store: new Store(),
  derived: null,
  version: 0,
  t: 0,
  playing: false,
  speed: 1,
  sel: S.emptySelection(),
  follow: null,
  hoverEntity: null,
  hoverDistance: null,
  layout: defaultLayout(),
  dirty: false,
  activeTab: defaultLayout().tabs[0].id,
  maximized: null,
  focused: null,
  menu: null,
  picker: null,
  theme: "light",
  notice: null,
  prompt: null,
}));

const set = useWB.setState;
const get = useWB.getState;

// ---------- data ----------

export function resetData(session: SessionMeta | null) {
  set({ store: new Store(), derived: null, version: 0, session, status: session ? "loading" : "idle", error: null });
}

export function refreshDerived() {
  const { store, session } = get();
  if (!session) return;
  set({ derived: derive(store, session), version: store.version });
}

// ---------- cursor ----------

export function clampT(t: Sec): Sec {
  const w = get().session?.window ?? [0, 0];
  return Math.min(w[1], Math.max(w[0], t));
}
export const setT = (t: Sec) => set({ t: clampT(t) });
export const togglePlay = () => {
  const { playing, t, session } = get();
  // Restart from the window start when play is pressed at the end.
  if (!playing && session && t >= session.window[1]) set({ t: session.window[0] });
  set({ playing: !playing });
};
export function stepSpeed(dir: 1 | -1) {
  const i = SPEEDS.indexOf(get().speed);
  set({ speed: SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (i < 0 ? 1 : i) + dir))] });
}

/** Cursor to the start of the focused entity's previous/next lap. */
export function stepLap(dir: 1 | -1) {
  const { derived, sel, t } = get();
  const e = sel.focus ?? derived?.entities[0]?.id;
  const laps = (e && derived?.lapsByEntity.get(e)) || [];
  if (!laps.length) return;
  if (dir > 0) {
    const next = laps.find((l) => l.t0 > t + 0.05);
    if (next) setT(next.t0);
  } else {
    const prev = [...laps].reverse().find((l) => l.t0 < t - 0.5);
    setT(prev ? prev.t0 : laps[0].t0);
  }
}

// ---------- selection ----------

const editSel = (f: (s: S.Selection) => S.Selection) => set((st) => ({ sel: f(st.sel) }));
export const focusEntity = (e: EntityId) => editSel((s) => S.focus(s, e));
export const toggleCompare = (e: EntityId) => editSel((s) => S.toggleCompare(s, e));
export const addCompare = (e: EntityId) => editSel((s) => S.addCompare(s, e));
export const removeCompare = (e: EntityId) => editSel((s) => S.removeCompare(s, e));
export const isolateEntity = (e: EntityId) => editSel((s) => S.isolate(s, e));
export const setReference = (e: EntityId | null) => editSel((s) => S.setReference(s, e));
export const toggleHidden = (e: EntityId) => editSel((s) => S.toggleHidden(s, e));
export const cycleFocus = (dir: 1 | -1 = 1) => editSel((s) => S.cycleFocus(s, dir));
export const clearComparison = () => editSel((s) => (s.focus ? S.isolate(s, s.focus) : s));
export const setSelection = (sel: S.Selection) => set({ sel });
/** Show a lap of an entity in lap-based panels (and add the entity to the comparison). */
export const showLap = (e: EntityId, ref: LapRef) => editSel((s) => S.setLap(S.addCompare(s, e), e, ref));
export const setFollow = (e: EntityId | null) => set({ follow: e });

// ---------- menus ----------

export const openMenu = (x: number, y: number, items: MenuItem[] | (() => MenuItem[])) => set({ menu: { x, y, items } });
export const closeMenu = () => set({ menu: null });
export const openPicker = (target: PickerTarget) => set({ picker: target, menu: null });
export const closePicker = () => set({ picker: null });

// ---------- layout ----------

function editLayout(f: (l: Layout) => Layout) {
  set((s) => ({ layout: prune(f(s.layout)), dirty: true }));
}
const mapTabs = (l: Layout, f: (t: Layout["tabs"][number]) => Layout["tabs"][number]): Layout => ({
  ...l,
  tabs: l.tabs.map(f),
});
const tabOf = (l: Layout, panel: string) => l.tabs.find((t) => panelIds(t.root).includes(panel));

export function loadLayout(layout: Layout, dirty = false) {
  set({ layout: prune(layout), dirty, activeTab: layout.tabs[0].id, maximized: null });
}

export function addPanel(type: string, panel: PanelState, target: PickerTarget) {
  editLayout((l) => {
    const id = newId(type, Object.keys(l.panels));
    const panels = { ...l.panels, [id]: panel };
    if (target.kind === "replace") {
      return { ...mapTabs(l, (t) => ({ ...t, root: replacePanel(t.root, target.panel, id) })), panels };
    }
    if (target.kind === "split") {
      return {
        ...mapTabs(l, (t) =>
          panelIds(t.root).includes(target.panel) ? { ...t, root: insertAt(t.root, target.panel, id, target.edge) } : t,
        ),
        panels,
      };
    }
    return {
      ...mapTabs(l, (t) => (t.id === target.tab ? { ...t, root: insertAt(t.root, null, id, "right") } : t)),
      panels,
    };
  });
}

/** Swap a panel's widget type in place, keeping its position (title and config reset). */
export function changePanelType(id: string, panel: PanelState) {
  editLayout((l) => (l.panels[id] ? { ...l, panels: { ...l.panels, [id]: panel } } : l));
}

/** Move a panel to another tab (it lands on the right of that tab). */
export function movePanelToTab(id: string, tabId: string) {
  editLayout((l) => {
    const src = tabOf(l, id);
    if (!src || src.id === tabId) return l;
    return mapTabs(l, (t) =>
      t.id === src.id ? { ...t, root: removePanel(t.root, id) } : t.id === tabId ? { ...t, root: insertAt(t.root, null, id, "right") } : t,
    );
  });
  set({ activeTab: tabId, maximized: null });
}

/** Add a preset tab (Timing, Telemetry, Strategy …) after the active tab. */
export function addPresetTab(key: string) {
  const l = get().layout;
  const { tab, panels } = presetTab(key, l);
  const idx = l.tabs.findIndex((t) => t.id === get().activeTab);
  const tabs = [...l.tabs];
  tabs.splice(idx < 0 ? tabs.length : idx + 1, 0, tab);
  editLayout(() => ({ ...l, tabs, panels: { ...l.panels, ...panels } }));
  set({ activeTab: tab.id, maximized: null });
}

export function removePanelById(id: string) {
  editLayout((l) => mapTabs(l, (t) => ({ ...t, root: removePanel(t.root, id) })));
  set((s) => ({ maximized: s.maximized === id ? null : s.maximized }));
}

export function duplicatePanel(id: string) {
  const l = get().layout;
  const p = l.panels[id];
  if (!p) return;
  addPanel(p.type, structuredClone(p), { kind: "split", panel: id, edge: "right" });
}

export function updatePanel(id: string, f: (p: PanelState) => PanelState) {
  editLayout((l) => (l.panels[id] ? { ...l, panels: { ...l.panels, [id]: f(l.panels[id]) } } : l));
}

export function movePanelTo(id: string, target: string, edge: Edge) {
  editLayout((l) => {
    const src = tabOf(l, id);
    const dst = tabOf(l, target);
    if (!src || !dst || src.id !== dst.id) return l;
    return mapTabs(l, (t) => (t.id === src.id ? { ...t, root: movePanel(t.root, id, target, edge) } : t));
  });
}

export function resizeSplit(tabId: string, path: Path, pct: number) {
  // Resizing marks the layout dirty but needs no prune.
  set((s) => ({
    layout: mapTabs(s.layout, (t) => (t.id === tabId && t.root ? { ...t, root: setSplit(t.root, path, pct) } : t)),
    dirty: true,
  }));
}

export function addTab() {
  const l = get().layout;
  const id = newId("tab", l.tabs.map((t) => t.id));
  editLayout((l) => ({ ...l, tabs: [...l.tabs, { id, name: `Tab ${l.tabs.length + 1}`, root: null }] }));
  set({ activeTab: id, maximized: null });
}

export function renameTab(id: string, name: string) {
  const n = name.trim();
  if (n) editLayout((l) => mapTabs(l, (t) => (t.id === id ? { ...t, name: n } : t)));
}

export function duplicateTab(id: string) {
  const l = get().layout;
  const src = l.tabs.find((t) => t.id === id);
  if (!src) return;
  const panels = { ...l.panels };
  const rename = new Map<string, string>();
  for (const pid of panelIds(src.root)) {
    const nid = newId(l.panels[pid].type, Object.keys(panels));
    panels[nid] = structuredClone(l.panels[pid]);
    rename.set(pid, nid);
  }
  let root = src.root;
  for (const [o, n] of rename) root = replacePanel(root, o, n);
  const tid = newId("tab", l.tabs.map((t) => t.id));
  const idx = l.tabs.indexOf(src);
  const tabs = [...l.tabs];
  tabs.splice(idx + 1, 0, { id: tid, name: `${src.name} copy`, root });
  editLayout(() => ({ ...l, tabs, panels }));
  set({ activeTab: tid, maximized: null });
}

export function deleteTab(id: string) {
  const l = get().layout;
  if (l.tabs.length <= 1) {
    editLayout((l) => ({ ...l, tabs: [{ ...l.tabs[0], root: null }] }));
    return;
  }
  const idx = l.tabs.findIndex((t) => t.id === id);
  editLayout((l) => ({ ...l, tabs: l.tabs.filter((t) => t.id !== id) }));
  if (get().activeTab === id) set({ activeTab: get().layout.tabs[Math.max(0, idx - 1)].id, maximized: null });
}

export function moveTab(id: string, toIndex: number) {
  editLayout((l) => {
    const tabs = [...l.tabs];
    const from = tabs.findIndex((t) => t.id === id);
    if (from < 0) return l;
    const [t] = tabs.splice(from, 1);
    tabs.splice(Math.max(0, Math.min(tabs.length, toIndex > from ? toIndex - 1 : toIndex)), 0, t);
    return { ...l, tabs };
  });
}

export const setActiveTab = (id: string) => set({ activeTab: id, maximized: null });
export const toggleMaximize = (id: string | null) => set((s) => ({ maximized: s.maximized === id ? null : id }));

export const notify = (text: string, kind: "info" | "error" = "info") => set({ notice: { kind, text } });
