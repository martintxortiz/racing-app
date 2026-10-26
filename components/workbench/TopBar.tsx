"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { PRESETS } from "@/lib/workbench/presets";
import { deleteSaved, exportLayout, importLayout, resetLayout, saveLayout, savedLayouts } from "./persist";
import {
  addPresetTab,
  addTab,
  deleteTab,
  duplicateTab,
  loadLayout,
  moveTab,
  notify,
  openMenu,
  openPicker,
  renameTab,
  setActiveTab,
  SPEEDS,
  useWB,
  type MenuItem,
} from "./state";

const MIME = "application/x-wb-tab";
const below = (e: React.MouseEvent, alignRight = false) => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return [alignRight ? r.right - 220 : r.left, r.bottom + 2] as const;
};

const presetItems = (): MenuItem[] =>
  Object.entries(PRESETS).map(([key, p]) => ({ label: p.name, hint: "New tab", onSelect: () => addPresetTab(key) }));

export function layoutMenuItems(): MenuItem[] {
  const { layout, dirty } = useWB.getState();
  const saved = savedLayouts();
  return [
    { heading: `${layout.name}${dirty ? " · edited" : ""}` },
    { label: "Add tab from preset", submenu: presetItems },
    { label: "Reset to default layout", onSelect: resetLayout },
    { separator: true },
    { label: "Save", hint: "Ctrl+S", onSelect: () => (saveLayout(), notify(`Saved “${useWB.getState().layout.name}”`)) },
    {
      label: "Save as…",
      onSelect: () =>
        useWB.setState({
          prompt: { title: "Save layout as", value: `${layout.name} copy`, onSubmit: (v) => (saveLayout(v), notify(`Saved “${v}”`)) },
        }),
    },
    {
      label: "Saved layouts",
      disabled: !saved.length,
      submenu: () => [
        ...saved.map((l) => ({ label: l.name, radio: true, checked: l.id === layout.id, onSelect: () => loadLayout(l) })),
        { separator: true },
        {
          label: "Delete current from saved",
          danger: true,
          disabled: !saved.some((l) => l.id === layout.id),
          onSelect: () => (deleteSaved(layout.id), notify(`Deleted “${layout.name}”`)),
        },
      ],
    },
    { separator: true },
    { label: "Import JSON…", onSelect: () => importLayout((m) => notify(m, "error")) },
    { label: "Export JSON", onSelect: exportLayout },
  ];
}

function openItems(go: (href: string) => void): MenuItem[] {
  const { session } = useWB.getState();
  return [
    ...(session ? [{ heading: session.title } as const] : []),
    { label: "Open .mcap file…", hint: "or drop it", onSelect: () => window.dispatchEvent(new Event("wb:pick-file")) },
    { label: "Session library", onSelect: () => go("/dashboard") },
    { label: "Demo session", onSelect: () => go("/s/demo") },
  ];
}

function settingsItems(): MenuItem[] {
  const { session, theme, speed } = useWB.getState();
  const notes = session?.notes ?? [];
  return [
    {
      label: "Theme",
      hint: theme === "dark" ? "Dark" : "Light",
      submenu: () =>
        (["light", "dark"] as const).map((t) => ({
          label: t === "dark" ? "Dark" : "Light",
          radio: true,
          checked: useWB.getState().theme === t,
          onSelect: () => window.dispatchEvent(new CustomEvent("wb:theme", { detail: t })),
        })),
    },
    {
      label: "Playback speed",
      hint: `${speed}×`,
      submenu: () =>
        SPEEDS.map((v) => ({
          label: `${v}×`,
          radio: true,
          checked: useWB.getState().speed === v,
          onSelect: () => useWB.setState({ speed: v }),
        })),
    },
    {
      label: "Data notes",
      hint: notes.length ? String(notes.length) : undefined,
      disabled: !notes.length,
      submenu: () => notes.map((n) => ({ label: n })),
    },
    {
      label: "Keyboard shortcuts",
      submenu: [
        { label: "Play / pause", hint: "Space" },
        { label: "Step 1 s / 10 s", hint: "← → / Shift" },
        { label: "Previous / next lap", hint: "[ ]" },
        { label: "Jump to session part", hint: "1–9" },
        { label: "Next focused driver", hint: "X" },
        { label: "Add panel", hint: "P" },
        { label: "Maximize panel", hint: "F" },
        { label: "Toggle theme", hint: "\\" },
        { label: "Save layout", hint: "Ctrl+S" },
      ],
    },
  ];
}

/** Top bar: layout tabs on the left, app controls on the right. No session data lives here. */
export function TopBar() {
  const router = useRouter();
  const tabs = useWB((s) => s.layout.tabs);
  const active = useWB((s) => s.activeTab);
  const theme = useWB((s) => s.theme);
  const dirty = useWB((s) => s.dirty);
  const layoutName = useWB((s) => s.layout.name);
  const [editing, setEditing] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const tabMenu = (id: string, x: number, y: number) =>
    openMenu(x, y, () => {
      const ts = useWB.getState().layout.tabs;
      const i = ts.findIndex((t) => t.id === id);
      return [
        { label: "Rename", onSelect: () => setEditing(id) },
        { label: "Duplicate", onSelect: () => duplicateTab(id) },
        { label: "Add panel…", hint: "P", onSelect: () => openPicker({ kind: "tab", tab: id }) },
        { separator: true },
        { label: "Move left", disabled: i === 0, onSelect: () => moveTab(id, i - 1) },
        { label: "Move right", disabled: i === ts.length - 1, onSelect: () => moveTab(id, i + 2) },
        { separator: true },
        { label: "New blank tab", onSelect: addTab },
        { label: "New tab from preset", submenu: presetItems },
        { separator: true },
        { label: ts.length === 1 ? "Clear tab" : "Close tab", danger: true, onSelect: () => deleteTab(id) },
      ];
    });

  return (
    <header
      className="wb-topbar"
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest(".wb-tab, button")) return;
        e.preventDefault();
        openMenu(e.clientX, e.clientY, () => [
          { label: "New blank tab", onSelect: addTab },
          { label: "New tab from preset", submenu: presetItems },
          { separator: true },
          ...layoutMenuItems(),
        ]);
      }}
    >
      <nav className="wb-tabs" role="tablist" aria-label="Layout tabs">
        {tabs.map((t, i) => (
          <div
            key={t.id}
            className={`wb-tabwrap${dropAt === i ? " is-drop" : ""}`}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(MIME)) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              setDropAt(e.clientX < r.left + r.width / 2 ? i : i + 1);
            }}
            onDragLeave={() => setDropAt(null)}
            onDrop={(e) => {
              const id = e.dataTransfer.getData(MIME);
              if (id && dropAt !== null) moveTab(id, dropAt);
              setDropAt(null);
            }}
          >
            {editing === t.id ? (
              <input
                className="pw-input wb-rename"
                autoFocus
                defaultValue={t.name}
                onFocus={(e) => e.target.select()}
                onBlur={(e) => {
                  renameTab(t.id, e.target.value);
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditing(null);
                }}
              />
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={t.id === active}
                className={`wb-tab${t.id === active ? " is-active" : ""}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(MIME, t.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => setActiveTab(t.id)}
                onDoubleClick={() => setEditing(t.id)}
                onAuxClick={(e) => e.button === 1 && tabs.length > 1 && deleteTab(t.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  tabMenu(t.id, e.clientX, e.clientY);
                }}
              >
                {t.name}
              </button>
            )}
          </div>
        ))}
        {dropAt === tabs.length ? <div className="wb-tabwrap is-drop" /> : null}
        <button
          type="button"
          className="pw-btn pw-btn--ghost pw-btn--sm pw-btn--icon"
          aria-label="New tab"
          title="New tab"
          onClick={(e) =>
            openMenu(...below(e), () => [
              { label: "Blank tab", onSelect: addTab },
              { separator: true },
              { heading: "From preset" },
              ...presetItems(),
            ])
          }
        >
          <span className="pw-icon pw-icon--add" />
        </button>
      </nav>
      <span className="pw-spacer" />
      <div className="wb-controls">
        <button type="button" className="pw-btn pw-btn--ghost pw-btn--sm" title="Layouts" onClick={(e) => openMenu(...below(e, true), layoutMenuItems)}>
          <span className="pw-icon pw-icon--grid" />
          <span>{layoutName}</span>
          {dirty ? <span className="wb-dirty" title="Unsaved changes" /> : null}
          <span className="pw-icon pw-icon--chevron-down" />
        </button>
        <button
          type="button"
          className="pw-btn pw-btn--ghost pw-btn--sm"
          title="Add panel (P)"
          onClick={() => openPicker({ kind: "tab", tab: useWB.getState().activeTab })}
        >
          <span className="pw-icon pw-icon--add" />
          <span>Add panel</span>
        </button>
        <span className="wb-controls__sep" />
        <button type="button" className="pw-btn pw-btn--ghost pw-btn--sm pw-btn--icon" aria-label="Open recording" title="Open recording" onClick={(e) => openMenu(...below(e, true), () => openItems(router.push))}>
          <span className="pw-icon pw-icon--document" />
        </button>
        <button
          type="button"
          className="pw-btn pw-btn--ghost pw-btn--sm pw-btn--icon"
          aria-label="Toggle theme"
          title={`${theme === "dark" ? "Light" : "Dark"} theme (\\)`}
          onClick={() => window.dispatchEvent(new CustomEvent("wb:theme", { detail: theme === "dark" ? "light" : "dark" }))}
        >
          <span className={`pw-icon pw-icon--${theme === "dark" ? "light" : "asleep"}`} />
        </button>
        <button type="button" className="pw-btn pw-btn--ghost pw-btn--sm pw-btn--icon" aria-label="Settings" title="Settings" onClick={(e) => openMenu(...below(e, true), settingsItems)}>
          <span className="pw-icon pw-icon--settings" />
        </button>
      </div>
    </header>
  );
}
